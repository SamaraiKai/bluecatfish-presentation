import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getValue, setValue } from "@/src/redisClient";
import { SECTIONS_CACHE_KEY } from "@/src/cacheVersion";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // server-only, bypasses RLS
);

async function planSections(): Promise<{ title: string; query: string }[]> {
  // Pull a broad, cheap survey of what's actually in the knowledge base
  const surveyQueries = [
    "blue catfish biology appearance behavior",
    "blue catfish invasive spread chesapeake bay",
    "blue catfish impact native species ecosystem",
    "blue catfish management harvest programs",
    "blue catfish eating nutrition safety consumer",
  ];
  const samples = await Promise.all(surveyQueries.map((q) => getRagContext(q, 10)));
  const survey = samples.join("\n\n---\n\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-6-luna",
      reasoning_effort: "low", 
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are planning the structure of a short educational lesson for young visitors at a science fair, based on the source material provided.

Decide how many sections the lesson should have (between 4 and 7) and what each should cover. Base this ONLY on what the source material actually supports — do not propose a section the material can't fill.

Order them as a guided path: start with the basics (what this animal is), move through the problem and its causes, and end with what a visitor can personally do about it.

For each section provide:
- "title": a short, engaging heading a young person would want to click (under 5 words)
- "query": a search phrase packed with the specific nouns and concepts that would retrieve this section's material from the source documents. This is used for semantic search, so favor concrete terms over natural phrasing.

Output JSON: { "sections": [ { "title": "...", "query": "..." } ] }`,
        },
        {
          role: "user",
          content: `Source material survey:\n\n${survey}`,
        },
      ],
      max_completion_tokens: 5000,
    }),
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(`Planning API error: ${data.error.message}`);
  }
  if (data.choices?.[0]?.finish_reason === 'length') {
    throw new Error('Planning ran out of tokens — raise max_completion_tokens');
  }
  console.log('PLAN RAW:', data.choices?.[0]?.message?.content?.slice(0, 1500));
  
  const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
  const planned = parsed.sections;

  if (!Array.isArray(planned) || planned.length < 4 || planned.length > 7) {
    throw new Error("Section planning returned an invalid structure");
  }
  return planned;
}

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

async function getRagContext(topic: string, matchCount = 13): Promise<string> {
  const queryEmbedding = await embed(topic);
  const { data, error } = await supabase.rpc("match_documents3", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
  });
  if (error) throw new Error(`RAG lookup failed: ${error.message}`);
  return (data ?? []).map((row: any) => row.content).join("\n\n");
}

async function getMatchingImages(query: string, count: number): Promise<{ url: string; description: string }[]> {
  const queryEmbedding = await embed(query);
  const { data, error } = await supabase.rpc("match_images2", {
    query_embedding: queryEmbedding,
    match_count: count,
  });
  if (error) throw new Error(`Image lookup failed: ${error.message}`);
  return (data ?? []).map((row: any) => ({ url: row.url, description: row.description ?? '' }));
}

const isNarration = (v: unknown) => typeof v === 'string' && v.trim().split(/\s+/).length >= 15;
const isBulletList = (v: unknown) =>
  Array.isArray(v) && v.length >= 1 && v.length <= 3 &&
  v.every((b) => typeof b === 'string' && b.trim().length > 0 && b.trim().split(/\s+/).length <= 12);

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
      model: "gpt-6-luna",
      reasoning_effort: "medium", 
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
2. The FIRST step must always be type "overview" — it introduces the section. Give it "bullets" and "narration" (see rule 13). It may optionally include "stats": 1-2 short quantitative facts as {value, label} pairs. Prefer surprising magnitudes over plain dates. Omit "stats" entirely if the source content has no meaningful numbers for this topic — do not invent them or pad with trivia.
3. Available step types after the overview: "example" (an analogy to something unrelated and familiar; give it "bullets" (1-2) and "narration" that tells the analogy out loud), "numberSpotlight" (a single STRIKING quantity that makes a learner react — a surprising scale, magnitude, or proportion. Provide "value" as the short number/quantity, "label" as a 3-6 word caption, "context" as ONE short on-screen line (under 12 words) that reacts to the number, and "narration" (see rule 13) explaining why this number matters. "100+ million fish" or "8-9% of body weight daily" are good; plain dates ("2011", "September 2019"), small counts, or routine figures are NOT — they're facts, not attention-grabbers), "predictThen" (invites the learner to guess a surprising number or fact BEFORE it's revealed. Provide "question" (1 sentence), "options" (exactly 4 short guesses — one correct, three plausible but wrong, spread far enough apart that the right one isn't obvious), "correctIndex" (0-3, and vary its position rather than always using the same slot), and "answer" (the short factual answer, read aloud after they guess). Only use this for a number or specific fact someone could reasonably guess at.), "checkYourself" (a single quick true/false comprehension check — provide "statement", "isTrue" (boolean), and "feedback" (1 sentence explaining why)).
4. Include a step type ONLY if it genuinely helps for THIS content. Skip "example" if no honest analogy fits. Only use "numberSpotlight" if this section contains a genuinely surprising number — omit the step entirely if it doesn't; never settle for a date or a routine figure just to include one. Only use "predictThen" for facts a learner could plausibly guess at. Do not include the same type twice.
5. Every step's content must be grounded strictly in the SOURCE CONTENT — never invent facts to fill out a step.
6. Every section SHOULD include at least one interactive step ("predictThen" or "checkYourself") unless the content genuinely doesn't support one.
7. "quiz" must contain EXACTLY 1 multiple-choice question testing THIS section's specific content. It must have exactly 4 "options", a "correctAnswer" index (0-3), and an "explanation" (1 short sentence stating the specific fact that makes the answer correct). CRITICAL — write the options so the correct answer is not identifiable by format alone: - All 4 options must be similar in length (within a few words of each other). The correct answer must NOT be the longest or most detailed option — that is the single most common giveaway. - All 4 options must be similar in specificity. Do not pair one precise, qualified answer against three vague ones. - Wrong options must be plausible to someone who didn't pay attention — draw them from real-sounding facts about Blue Catfish, not obviously absurd choices. - Vary which index is correct across sections; do not default to the same position. The question must be answerable ONLY by someone who paid attention to THIS section. Do not ask about general Blue Catfish knowledge that other sections also cover — anchor it to a specific fact, number, or claim unique to this section's content.
8. "recap" must be ONE sentence (12-20 words) summarizing this section's single most important takeaway, written to be read aloud as part of an end-of-lesson recap. Start it naturally so it flows in a list (e.g. "Blue Catfish were introduced in the 1970s for sport fishing." not "In this section we learned that...").
9. "value" must be a STRING, even when it is purely numeric (write "19", not 19). Every stat's "value" and "label" must state a fact exactly as it appears in the source content. Do not combine numbers from one fact with the subject of another.
10. "remediation" must be 2-3 short sentences that re-explain this section's single most important idea in the simplest possible way, for a learner who said they were lost. Use a different angle than the overview — a concrete everyday comparison works well. Do not introduce any new facts.
11. AUDIENCE AND VOICE: the learner is 10-14 years old and every line is read aloud by a text-to-speech voice. Use short, everyday words and sentences under 20 words. Write numbers and units the way you'd say them ("about 100 pounds", "8 to 9 percent"), never symbols or abbreviations like "~", "%", "lbs", "e.g.", or parentheses.
12. EVERY STEP MUST STAND ON ITS OWN: learners can jump straight to any step by voice ("go to the part about mercury"), so never open a narration with "They", "This", "It", or "As we saw". Name the subject ("Blue catfish...") and the step's key idea in its first sentence, so it makes sense heard on its own and can be found by its topic.
13. SCREEN TEXT vs. SPOKEN TEXT — the learner SEES "bullets" and HEARS "narration". They must not be the same words; the professor must never sound like they are reading the slide.
   - "bullets": 2-3 key points (1-2 for "example"), each UNDER 8 words. Fragments, not sentences. No filler ("It is important to note", "In fact", "This means that"). No two bullets say the same thing. Each bullet is one fact from the SOURCE CONTENT, and a bullet may have a quick joke in it.
   - "narration": 3-5 spoken sentences (about 45-80 words) that EXPLAIN and BRANCH OUT from the bullets: the why or how behind them, a vivid example, or one extra detail from the SOURCE CONTENT that the bullets leave out. Cover the bullets' points in order so they can appear on screen as they are mentioned, but in fresh words; never read a bullet out word for word. Every added detail must still come from the SOURCE CONTENT.
14. TONE — funny, goofy, a little sarcastic, like a favorite science teacher who thinks this fish is ridiculous. Examples of the voice: "Blue catfish: basically a vacuum cleaner with fins." / "Nothing in the Bay eats them. Rude." / "Spoiler: the crabs are not thrilled." Rules for the humor:
   - Aim the sarcasm at the fish, the situation, or the problem, NEVER at the learner, a group of people, or anyone's answer.
   - At most one joke per bullet list and one or two per narration; the facts come first and must stay exactly right.
   - Keep it kind and classroom-safe for ages 10-14. No insults, no pop-culture references that will date.
   - Quiz questions, quiz options, and "explanation" stay plain and clear (no jokes there); "feedback", "answer", "recap" and "remediation" can be warm and lightly playful.

Output ONLY a JSON object with key "section":

{
  "section": {
    "title": "String",
    "icon": "emoji",
    "image": "",
    "recap": "one sentence takeaway",
    "remediation": "2-3 simple sentences",
    "steps": [
      { "type": "overview", "bullets": ["...", "..."], "narration": "...", "stats": [{"value": "...", "label": "..."}] },
      { "type": "example", "bullets": ["..."], "narration": "..." },
      { "type": "numberSpotlight", "value": "...", "label": "...", "context": "...", "narration": "..." },
      { "type": "predictThen", "question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 2, "answer": "..." },
      { "type": "checkYourself", "statement": "...", "isTrue": true, "feedback": "..." }
    ],
    "quiz": [
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
      // bullets + narration roughly doubles the output, so give it more room
      max_completion_tokens: 5000,
    }),
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  // A cut-off or empty reply (reasoning used up the token budget, or a bad
  // JSON string) used to throw and fail the whole lesson; retry it instead.
  let parsed: any = null;
  try {
    parsed = content ? JSON.parse(content) : null;
  } catch {
    parsed = null;
  }
  if (!parsed) {
    const why = data.error?.message ?? data.choices?.[0]?.finish_reason ?? 'empty reply';
    if (attempt < 3) {
      console.warn(`Section ${sectionNum} unreadable (${why}), retrying...`);
      return generateSingleSection(ragContext, sectionTopic, sectionNum, attempt + 1);
    }
    throw new Error(`No usable content from AI for section ${sectionNum} (${why})`);
  }
  const section = parsed.section ?? parsed;
  
  const steps = section.steps;
  const validSteps =
    Array.isArray(steps) &&
    steps.length >= 2 && steps.length <= 5 &&
    steps[0]?.type === 'overview' &&
    new Set(steps.map((s: any) => s.type)).size === steps.length &&
    steps.every((s: any) => {
      if (s.type === 'numberSpotlight') return typeof s.value === 'string' && typeof s.label === 'string' && typeof s.context === 'string' && isNarration(s.narration);
      if (s.type === 'checkYourself') return typeof s.statement === 'string' && typeof s.isTrue === 'boolean' && typeof s.feedback === 'string';
      if (s.type === 'predictThen') return typeof s.question === 'string' && Array.isArray(s.options) && s.options.length === 4 && Number.isInteger(s.correctIndex) && s.correctIndex >= 0 && s.correctIndex < 4 && typeof s.answer === 'string';
      // overview / example: short bullets on screen, a longer narration spoken
      return isBulletList(s.bullets) && isNarration(s.narration);
    });

  const validQuiz = section.quiz?.length === 1 &&
    section.quiz.every((q: any) => q.options?.length === 4 && typeof q.explanation === 'string');

  const validRecap = typeof section.recap === 'string' && section.recap.trim().length > 0;
  const validRemediation = typeof section.remediation === 'string' && section.remediation.trim().length > 0;
  
   if ((!validSteps || !validQuiz || !validRecap || !validRemediation) && attempt < 3) {
    console.warn(`Section ${sectionNum} malformed (steps/quiz), retrying...`);
    return generateSingleSection(ragContext, sectionTopic, sectionNum, attempt + 1);
  }
    
  section.image = "";
  return section;
}

async function assignUniqueImages(sections: any[], sectionTopics: string[]) {
  const usedUrls = new Set<string>();
  const CANDIDATE_COUNT = 20; 
 
  for (let i = 0; i < sections.length; i++) {
    const first = sections[i].steps?.[0];
    const query = first?.narration || first?.text || sectionTopics[i];
    const candidates = await getMatchingImages(query, CANDIDATE_COUNT);
 
    const unused = candidates.filter((c) => !usedUrls.has(c.url));

    const main = unused[0] ?? candidates[0];
    if (main) {
      sections[i].image = main.url;
      sections[i].imageDescription = main.description;
      usedUrls.add(main.url);
    } else {
      console.warn(`Section ${i + 1}: all ${CANDIDATE_COUNT} candidate images already used, reusing top match.`);
      sections[i].image = "";
      sections[i].imageDescription = "";
    }

    const hub = unused.find((c) => c.url !== main?.url && !usedUrls.has(c.url)) ?? candidates[1] ?? main;
    if (hub) {
      sections[i].hubImage = hub.url;
      usedUrls.add(hub.url);
    } else {
      sections[i].hubImage = sections[i].image;
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

function dedupeStats(sections: any[]) {
  const seen = new Set<string>();

  const norm = (v: string) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const section of sections) {
    for (const step of section.steps) {
      if (step.type === 'numberSpotlight') {
        const key = norm(step.value);
        if (seen.has(key)) {
          step._drop = true;
        } else {
          seen.add(key);
        }
      }
      if (step.type === 'overview' && Array.isArray(step.stats)) {
        step.stats = step.stats.filter((s: any) => {
          const key = norm(s.value);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (step.stats.length === 0) delete step.stats;
      }
    }
    section.steps = section.steps.filter((s: any) => !s._drop);
  }

  return sections;
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
        model: "gpt-6-luna",
        reasoning_effort: "low", 
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Write a short spoken line directing a learner's attention to an image on screen, then explaining what it shows and why it matters for this lesson section. 1-2 sentences total (20ish words). Start by pointing at the image naturally ("Take a look at the image on screen..." / "Notice in the picture..."). Use the lesson's voice: funny, goofy, a little sarcastic about the fish, kind to the learner, ages 10-14. Base it ONLY on the provided image description — never invent visual details. Output JSON: { "text": "..." }`,
          },
          {
            role: "user",
            content: `Section: "${section.title}"\nImage description: "${section.imageDescription}"`,
          },
        ],
        max_completion_tokens: 1500,
      }),
    });

    try {
      const data = await res.json();
      const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
      if (parsed.text) {
        // insert right after the overview so the image is introduced early
        section.steps.splice(1, 0, { type: 'imageFocus', text: parsed.text, narration: parsed.text });
      }
    } catch (e) {
      console.warn(`Image step failed for "${section.title}":`, e);
    }
  }
  return sections;
}

export async function POST(req: Request) {
  try {
    const cacheKey = SECTIONS_CACHE_KEY;

    const cachedRaw = await getValue(cacheKey);
    if (cachedRaw) {
      return NextResponse.json({ sections: JSON.parse(cachedRaw), source: "cache", cacheKey });
    }

    const plan = await planSections();
    console.log('PLANNED SECTIONS:', plan);
  
    const ragContexts = await Promise.all(
      plan.map((p) => getRagContext(p.query, 13))
    );

    const sections = await Promise.all(
      plan.map((p, i) =>
        generateSingleSection(ragContexts[i], p.title, i + 1)
      )
    );

    dedupeStats(sections);
    await assignUniqueImages(sections, plan.map((p) => p.query));
    await addImageSteps(sections);

    await setValue(cacheKey, JSON.stringify(sections));

    const rawUrl = process.env.MANIM_RENDER_URL || '';
    const renderUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    
    try {
      await fetch(`${renderUrl}/animate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: process.env.MANIM_RENDER_TOKEN,
          cache_key: cacheKey,
          sections,
        }),
        signal: AbortSignal.timeout(15000),
      });
      console.log('animation pass requested');
    } catch (e) {
      console.warn("Could not start animation pass:", e);
    }

    return NextResponse.json({ sections, source: "generated", cacheKey });
    
  } catch (err: any) {
    console.error("Section generation error:", err);
    return NextResponse.json({ error: err.message || "Failed to get sections" }, { status: 500 });
  }
}
