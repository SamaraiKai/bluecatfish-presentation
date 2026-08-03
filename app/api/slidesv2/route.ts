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

async function getRagContext(topic: string, matchCount = 5): Promise<string> {
  const queryEmbedding = await embed(topic);
  const { data, error } = await supabase.rpc("match_documents2", {
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
1. "content" must be exactly 1 medium sentences — an informative on-screen paragraph summarizing this section's core idea.
2. "stats" must contain EXACTLY 2 items, each a short quantitative or date-based fact from the source content, styled like:
   { "value": "100+ Million", "label": "Estimated population in Bay" }
   { "value": "1970s-80s", "label": "When they were introduced" }
   "value" is the short number/date/quantity. "label" is a small caption explaining what it refers to (3-6 words).
3. "icon" must be a single emoji character that visually represents this section's topic.
4. "breakdown.simple" must be exactly 1 sentences, explaining the topic in the SIMPLEST possible terms for a confused learner — must use DIFFERENT wording and framing than "content", not just a shorter version of it.
5. "breakdown.keyTerms" must contain EXACTLY 3 items, each a key word or phrase from this section paired with a plain-language definition:
   { "term": "...", "definition": "..." }
6. "breakdown.realWorldExample" must explain the concept via an analogy to something unrelated and familiar (e.g. comparing an ecological concept to delivery logistics, sports, cooking, etc.) — NOT another catfish/fish fact. 1-2 sentences.
7. "quiz" must contain EXACTLY 2 multiple-choice questions testing understanding of THIS section's specific content (not other sections). Each question must have exactly 4 "options" and a "correctAnswer" index (0-3) pointing to the correct option. Base both questions strictly on facts present in the "content", "stats", "breakdown.simple", or the key term definitions — all of these are read aloud to the learner during the lesson. Each question must also include an "explanation" field: 1 short sentence stating the specific fact that makes the correct answer correct, written so a learner who got it wrong immediately understands why — this should directly quote or closely paraphrase the exact source sentence/fact it came from.
Output ONLY a JSON object with key "section" structured EXACTLY like this:
8. "quiz" must be a top-level key on the section object, a sibling of "breakdown" — never nested inside "breakdown".

{
  "section": {
    "title": "String",
    "icon": "emoji",
    "image": "",
    "content": "1 medium sentences",
    "stats": [
      { "value": "...", "label": "..." },
      { "value": "...", "label": "..." }
    ],
    "breakdown": {
      "simple": "1 short sentences, different angle than content",
      "keyTerms": [
        { "term": "...", "definition": "..." },
        { "term": "...", "definition": "..." },
        { "term": "...", "definition": "..." }
      ],
      "realWorldExample": "analogy to something unrelated, 1-2 sentences"
    },
    "quiz": [
      { "question": "...", "options": ["...", "...", "...", "..."], "correctAnswer": 0, "explanation": "..." },
      { "question": "...", "options": ["...", "...", "...", "..."], "correctAnswer": 0, "explanation": "..." }
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

  // GPT sometimes nests quiz inside breakdown — pull it back out
  if (!Array.isArray(section.quiz) && Array.isArray(section.breakdown?.quiz)) {
    section.quiz = section.breakdown.quiz;
    delete section.breakdown.quiz;
  }

  if ((!section.quiz || section.quiz.length !== 2) && attempt < 2) {
    console.warn(`Section ${sectionNum} had ${section.quiz?.length} quiz questions, retrying...`);
    return generateSingleSection(/* ...same args... */, attempt + 1);
  }
  
  const validKeyTerms = section.breakdown?.keyTerms?.length === 3;
  const validStats = section.stats?.length === 2;
  const validQuiz = section.quiz?.length === 2 && section.quiz.every((q: any) => q.options?.length === 4 && typeof q.explanation === 'string');

  if ((!validKeyTerms || !validStats) && attempt < 3) {
    console.warn(`Section ${sectionNum} malformed (keyTerms/stats), retrying...`);
    return generateSingleSection(ragContext, sectionTopic, sectionNum, attempt + 1);
  }

  section.image = "";
  
  return section;
}

async function assignUniqueImages(sections: any[], sectionTopics: string[]) {
  const usedUrls = new Set<string>();
  const CANDIDATE_COUNT = 6; 
 
  for (let i = 0; i < sections.length; i++) {
    const query = sections[i].content || sectionTopics[i];
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
    const cacheKey = `bluecatfish_sections_ai_v10`;

    const cachedRaw = await getValue(cacheKey);
    if (cachedRaw) {
      return NextResponse.json({ sections: JSON.parse(cachedRaw), source: "cache" });
    }

    const sectionTopics = [
      "A New Predator Arrives",
      "Explosive Growth",
      "Eating Everything",
      "No Natural Enemies",
      "A Delicious Solution",
    ];

    const ragContexts = await Promise.all(
      sectionTopics.map((t) => getRagContext(t, 4))
    );

    const sections = await Promise.all(
      sectionTopics.map((t, i) =>
        generateSingleSection(ragContexts[i], t, i + 1)
      )
    );

    await assignUniqueImages(sections, sectionTopics);
    
    await setValue(cacheKey, JSON.stringify(sections));
    return NextResponse.json({ sections, source: "generated" });

  } catch (err: any) {
    console.error("Section generation error:", err);
    return NextResponse.json({ error: err.message || "Failed to get sections" }, { status: 500 });
  }
}
