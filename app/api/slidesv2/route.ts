import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getValue, setValue } from "@/src/redisClient";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // server-only, bypasses RLS
);

async function embed(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  const data = await res.json();
  return data.data[0].embedding;
}

async function getRagContext(topic: string, matchCount = 7): Promise<string> {
  const queryEmbedding = await embed(topic);
  const { data, error } = await supabase.rpc("match_documents3", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
  });
  if (error) throw new Error(`RAG lookup failed: ${error.message}`);
  return (data ?? []).map((row: any) => row.content).join("\n\n");
}

async function getMatchingImages(query: string, count: number): Promise<string[]> {
  const queryEmbedding = await embed(query);
  const { data, error } = await supabase.rpc("match_images", {
    query_embedding: queryEmbedding,
    match_count: count,
  });
  if (error) throw new Error(`Image lookup failed: ${error.message}`);
  return (data ?? []).map((row: any) => row.url);
}

async function generateSingleSection(
  ragContext: string,
  sectionTopic: string,
  sectionNum: number,
  attempt = 1
): Promise<any> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an educational assistant creating one section of a slide-based lesson on Blue Catfish invasion in the Chesapeake Bay.
Base every fact strictly on the SOURCE CONTENT below — do not invent facts.

SOURCE CONTENT:
"""${ragContext}"""

STRICT RULES YOU MUST FOLLOW:
1. "steps" is an ordered array of teaching steps for this section. YOU decide how many steps and which types, based on what this specific content actually needs. Use between 2 and 5 steps.
2. The FIRST step must always be type "overview" — it introduces the section. Its "text" is 2 short sentences. It may optionally include "stats": 1-2 short quantitative facts as {value, label} pairs (e.g. {"value": "100+ Million", "label": "Estimated population in Bay"}). Omit "stats" entirely if the source content has no meaningful numbers for this topic — do not invent them.
3. Available step types after the overview: "simple" (a plainer re-explanation for a confused learner, 2 short sentences, different wording than the overview), "keyTerms" (1-4 terms with short plain-language definitions), "example" (an analogy to something unrelated and familiar, 1-2 sentences).
4. Include a step type ONLY if it genuinely helps for THIS content. Skip "simple" if the overview is already plain enough. Skip "example" if no honest analogy fits — a forced analogy is worse than none. Include only as many key terms as the content actually warrants; 1 good term beats 3 padded ones. Do not include the same type twice.
5. Every step's content must be grounded strictly in the SOURCE CONTENT — never invent facts to fill out a step.
6. "quiz" must contain EXACTLY 2 multiple-choice questions testing THIS section's content. Each has exactly 4 "options", a "correctAnswer" index (0-3), and an "explanation" (1 short sentence stating the specific fact that makes the answer correct). Base questions only on facts appearing in your generated steps, since those are what the learner sees and hears.
7. "icon" must be a single emoji representing this section's topic.

Output ONLY a JSON object with key "section":

{
  "section": {
    "title": "String",
    "icon": "emoji",
    "image": "",
    "steps": [
      { "type": "overview", "text": "...", "stats": [{"value": "...", "label": "..."}] },
      { "type": "simple", "text": "..." },
      { "type": "keyTerms", "terms": [{"term": "...", "definition": "..."}] },
      { "type": "example", "text": "..." }
    ],
    "quiz": [
      { "question": "...", "options": ["...","...","...","..."], "correctAnswer": 0, "explanation": "..." },
      { "question": "...", "options": ["...","...","...","..."], "correctAnswer": 0, "explanation": "..." }
    ]
  }
}`,
        },
        {
          role: "user",
          content: `Generate section ${sectionNum} about: ${sectionTopic}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 3200,
    }),
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content from AI (section)");

  const parsed = JSON.parse(content);
  const section = parsed.section ?? parsed;

  const steps = section.steps;
  const validSteps =
    Array.isArray(steps) &&
    steps.length >= 2 && steps.length <= 5 &&
    steps[0]?.type === 'overview' &&
    new Set(steps.map((s: any) => s.type)).size === steps.length &&
    steps.every((s: any) => {
      if (s.type === 'keyTerms') return Array.isArray(s.terms) && s.terms.length >= 1 && s.terms.length <= 4;
      return typeof s.text === 'string' && s.text.trim().length > 0;
    });

  const validQuiz = section.quiz?.length === 2 &&
    section.quiz.every((q: any) => q.options?.length === 4 && typeof q.explanation === 'string');

  if ((!validSteps || !validQuiz) && attempt < 3) {
    console.warn(`Section ${sectionNum} malformed (steps/quiz), retrying...`);
    return generateSingleSection(ragContext, sectionTopic, sectionNum, attempt + 1);
  }
  
  section.image = "";
  return section;
}

async function assignUniqueImages(sections: any[], sectionTopics: string[]) {
  const usedUrls = new Set<string>();
  const CANDIDATE_COUNT = 8; 
 
  for (let i = 0; i < sections.length; i++) {
    const query = sections[i].steps?.[0]?.text || sectionTopics[i];
    const candidates = await getMatchingImages(query, CANDIDATE_COUNT);
 
    const firstUnused = candidates.find((url) => !usedUrls.has(url));
 
    if (firstUnused) {
      sections[i].image = firstUnused;
      usedUrls.add(firstUnused);
    } else {

      console.warn(`Section ${i + 1}: all ${CANDIDATE_COUNT} candidate images already used, reusing top match.`);
      sections[i].image = candidates[0] ?? "";
    }
  }
 
  return sections;
}

export async function POST(req: Request) {
  try {
    const cacheKey = `bluecatfish_sections_ai_v10.2`;

    const cachedRaw = await getValue(cacheKey);
    if (cachedRaw) {
      return NextResponse.json({ sections: JSON.parse(cachedRaw), source: "cache" });
    }

    const sectionTopics: [string, string][] = [
      ["What Are Blue Catfish?", "blue catfish Ictalurus furcatus largest catfish species North America size characteristics"],
      ["Why Are They Invasive?", "why blue catfish are invasive Chesapeake Bay introduction non-native spread"],
      ["Impact on the Bay Ecosystem", "blue catfish negative impacts native species Chesapeake Bay ecosystem population concerns"],
      ["Mitigation Efforts", "what is being done to mitigate blue catfish invasion management harvest programs"],
      ["How You Can Help", "how can you help blue catfish invasion consumer action buying blue catfish products forms available"],
      ["Nutrition and Safety", "blue catfish fillet nutrition protein fat cholesterol contaminants safe to eat commercially harvested"]
    ];

    const ragContexts = await Promise.all(
      sectionTopics.map(([, query]) => getRagContext(query, 4))
    );

    const sections = await Promise.all(
      sectionTopics.map(([name], i) =>
        generateSingleSection(ragContexts[i], name, i + 1)
      )
    );

    await assignUniqueImages(sections, sectionTopics.map(([, query]) => query;
    
    await setValue(cacheKey, JSON.stringify(sections));
    return NextResponse.json({ sections, source: "generated" });

  } catch (err: any) {
    console.error("Section generation error:", err);
    return NextResponse.json({ error: err.message || "Failed to get sections" }, { status: 500 });
  }
}
