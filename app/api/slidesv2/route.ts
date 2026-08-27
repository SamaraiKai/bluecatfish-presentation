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
  return (data ?? []).map((row: any) => ({ url: row.url, description: row.description ?? '' });
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
2. The FIRST step must always be type "overview" — it introduces the section. Its "text" is 2 short sentences. It may optionally include "stats": 1-2 short quantitative facts as {value, label} pairs. Prefer surprising magnitudes over plain dates. Omit "stats" entirely if the source content has no meaningful numbers for this topic — do not invent them or pad with trivia.
3. Available step types after the overview: "simple" (a plainer re-explanation for a confused learner, 2 short sentences, different wording than the overview), "keyTerms" (1-4 terms with short plain-language definitions), "example" (an analogy to something unrelated and familiar, 1-2 sentences), "numberSpotlight" is for a single STRIKING quantity that makes a learner react — a surprising scale, magnitude, or proportion. "100+ million fish" or "8-9% of body weight daily" are good. Plain dates ("2011", "September 2019"), small counts, or routine figures are NOT — they're facts, not attention-grabbers. If this section has no genuinely surprising number, omit the numberSpotlight step entirely, "label" as a 3-6 word caption, and "context" as 1-2 sentences explaining why this number matters), "predictThen" (a question inviting the learner to guess a fact before it's revealed — provide "question" (1 sentence), "answer" (the short factual answer), and "reveal" (1-2 sentences expanding on it)), "checkYourself" (a single quick true/false comprehension check — provide "statement", "isTrue" (boolean), and "feedback" (1 sentence explaining why)).
4. Include a step type ONLY if it genuinely helps for THIS content. Skip "simple" if the overview is already plain enough. Skip "example" if no honest analogy fits. Only use "numberSpotlight" if this section contains a genuinely surprising number — omit the step entirely if it doesn't; never settle for a date or a routine figure just to include one. Only use "predictThen" for facts a learner could plausibly guess at. Do not include the same type twice.
5. Every step's content must be grounded strictly in the SOURCE CONTENT — never invent facts to fill out a step.
6. Every section SHOULD include at least one interactive step ("predictThen" or "checkYourself") unless the content genuinely doesn't support one.
7. "quiz" must contain EXACTLY 1 multiple-choice questions testing THIS section's content. Each has exactly 4 "options", a "correctAnswer" index (0-3), and an "explanation" (1 short sentence stating the specific fact that makes the answer correct). Base questions only on facts appearing in your generated steps, since those are what the learner sees and hears. IMPORTANT: vary your step composition across sections rather than defaulting to the same pattern every time. "checkYourself" and "example" are just as valid as "keyTerms" — use them wherever the content supports them, and do not treat "keyTerms" as a default.
8. "keyTerms" (1-3 terms) is for vocabulary a learner genuinely NEEDS defined to follow the lesson — technical or domain-specific words they likely don't already know. "Invasive species" is a good key term; "predatory behavior," "ecosystem," or "population" are not, because a general audience already understands them from context. If a term's meaning is obvious from the sentence it appears in, leave it out. Use FEWER terms rather than padding to reach three, and skip the keyTerms step entirely if this section has no genuinely unfamiliar vocabulary.
9. "icon" must be a single emoji representing this section's topic.
10. "recap" must be ONE sentence (12-20 words) summarizing this section's single most important takeaway, written to be read aloud as part of an end-of-lesson recap. Start it naturally so it flows in a list (e.g. "Blue Catfish were introduced in the 1970s for sport fishing." not "In this section we learned that...").

Output ONLY a JSON object with key "section":

{
  "section": {
    "title": "String",
    "icon": "emoji",
    "image": "",
    "recap": "one sentence takeaway",
    "steps": [
      { "type": "overview", "text": "...", "stats": [{"value": "...", "label": "..."}] },
      { "type": "simple", "text": "..." },
      { "type": "keyTerms", "terms": [{"term": "...", "definition": "..."}] },
      { "type": "example", "text": "..." },
      { "type": "numberSpotlight", "value": "...", "label": "...", "context": "..." },
      { "type": "predictThen", "question": "...", "answer": "...", "reveal": "..." },
      { "type": "checkYourself", "statement": "...", "isTrue": true, "feedback": "..." }
    ],
    "quiz": [
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
      if (s.type === 'numberSpotlight') return typeof s.value === 'string' && typeof s.label === 'string' && typeof s.context === 'string';
      if (s.type === 'predictThen') return typeof s.question === 'string' && typeof s.answer === 'string' && typeof s.reveal === 'string';
      if (s.type === 'checkYourself') return typeof s.statement === 'string' && typeof s.isTrue === 'boolean' && typeof s.feedback === 'string';
      return typeof s.text === 'string' && s.text.trim().length > 0;
    });

  const validQuiz = section.quiz?.length === 1 &&
    section.quiz.every((q: any) => q.options?.length === 4 && typeof q.explanation === 'string');

  const validRecap = typeof section.recap === 'string' && section.recap.trim().length > 0;
  
   if ((!validSteps || !validQuiz || !validRecap) && attempt < 3) {
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
      sections[i].imageDescription = firstUnused.description;
      usedUrls.add(firstUnused);
    } else {
      console.warn(`Section ${i + 1}: all ${CANDIDATE_COUNT} candidate images already used, reusing top match.`);
      sections[i].image = candidates[0] ?? "";
      sections[i].imageDescription = candidates[0]?.description ?? "";
    }
  }
 
  return sections;
}

function normalizeTerm(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/\b(species|behavior|behaviour|process|status|effect|effects)\b/g, '') // drop generic qualifier words
    .replace(/(ies|ing|ory|ive|s)\b/g, '')  // crude stemming: predatory/predators/predation → predat
    .replace(/[^a-z]/g, '')
    .trim();
}

function dedupeKeyTerms(sections: any[]) {
  const seen: string[] = [];
  for (const section of sections) {
    for (const step of section.steps) {
      if (step.type !== 'keyTerms') continue;
      step.terms = step.terms.filter((t: any) => {
        const norm = normalizeTerm(t.term);
        if (!norm) return true;

        // reject if it matches, contains, or is contained by anything already used
        const dupe = seen.some((s) => s === norm || s.includes(norm) || norm.includes(s));
        if (dupe) return false;
        seen.push(norm);
        return true;
      });
    }
    // a keyTerms step with nothing left shouldn't render at all
    section.steps = section.steps.filter(
      (s: any) => s.type !== 'keyTerms' || s.terms.length > 0
    );
  }
  return sections;
}

async function addImageSteps(sections: any[]) {
  for (const section of sections) {
    if (!section.imageDescription) continue;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
            content: `Write a short spoken line directing a learner's attention to an image on screen, then explaining what it shows and why it matters for this lesson section. 2-3 sentences total. Start by pointing at the image naturally ("Take a look at the image on screen..." / "Notice in the picture..."). Base it ONLY on the provided image description — never invent visual details. Output JSON: { "text": "..." }`,
          },
          {
            role: "user",
            content: `Section: "${section.title}"\nImage description: "${section.imageDescription}"`,
          },
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
    });

    try {
      const data = await res.json();
      const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
      if (parsed.text) {
        // insert right after the overview so the image is introduced early
        section.steps.splice(1, 0, { type: 'imageFocus', text: parsed.text });
      }
    } catch (e) {
      console.warn(`Image step failed for "${section.title}":`, e);
    }
  }
  return sections;
}

export async function POST(req: Request) {
  try {
    const cacheKey = `bluecatfish_sections_ai_vPilot1`;

    const cachedRaw = await getValue(cacheKey);
    if (cachedRaw) {
      return NextResponse.json({ sections: JSON.parse(cachedRaw), source: "cache" });
    }

    const sectionTopics: [string, string][] = [
      ["What Are Blue Catfish?", "blue catfish Ictalurus furcatus largest catfish species North America size characteristics"],
      ["Why Are They Invasive?", "why blue catfish are invasive Chesapeake Bay introduction non-native spread"],
      ["Impact on the Bay Ecosystem", "blue catfish negative impacts native species Chesapeake Bay ecosystem population concerns"],
      ["Mitigation Efforts", "what is being done to mitigate blue catfish invasion management harvest programs"],
      ["How You Can Help", "how can you help blue catfish invasion consumer action buying blue catfish products forms available, food and eating them"],
      ["Nutrition and Safety", "blue catfish fillet nutrition protein fat cholesterol contaminants safe to eat commercially harvested, food and eating them"]
    ];

    const ragContexts = await Promise.all(
      sectionTopics.map(([, query]) => getRagContext(query, 4))
    );

    const sections = await Promise.all(
      sectionTopics.map(([name], i) =>
        generateSingleSection(ragContexts[i], name, i + 1)
      )
    );

    await assignUniqueImages(sections, sectionTopics.map(([, query]) => query));
    dedupeKeyTerms(sections);
    await addImageSteps(sections);
    
    await setValue(cacheKey, JSON.stringify(sections));
    return NextResponse.json({ sections, source: "generated" });

  } catch (err: any) {
    console.error("Section generation error:", err);
    return NextResponse.json({ error: err.message || "Failed to get sections" }, { status: 500 });
  }
}
