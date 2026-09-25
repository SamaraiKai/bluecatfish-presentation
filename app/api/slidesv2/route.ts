import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getValue, setValue } from "@/src/redisClient";
import { SECTIONS_CACHE_KEY } from "@/src/cacheVersion";
import { findCrossSectionRepeats } from "@/lib/lessonOverlap";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // server-only, bypasses RLS
);

type PlannedSection = { title: string; query: string; covers: string[] };

async function planSections(): Promise<PlannedSection[]> {
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
- "covers": 3-5 specific points this section teaches (short phrases naming the fact or idea, e.g. "grow over 100 pounds", "introduced to Virginia rivers in the 1970s").

NO REPEATS: every fact, number and example belongs to exactly ONE section. Split the material so no point appears in two sections' "covers". Only the first section explains what a blue catfish is; later sections build on it without re-introducing the fish.

Output JSON: { "sections": [ { "title": "...", "query": "...", "covers": ["...", "..."] } ] }`,
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
  return planned.map((p: any) => ({
    title: String(p.title ?? ''),
    query: String(p.query ?? p.title ?? ''),
    covers: Array.isArray(p.covers) ? p.covers.map(String).slice(0, 6) : [],
  }));
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

async function getRagChunks(topic: string, matchCount = 13): Promise<string[]> {
  const queryEmbedding = await embed(topic);
  const { data, error } = await supabase.rpc("match_documents3", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
  });
  if (error) throw new Error(`RAG lookup failed: ${error.message}`);
  return (data ?? []).map((row: any) => String(row.content ?? '')).filter(Boolean);
}

async function getRagContext(topic: string, matchCount = 13): Promise<string> {
  return (await getRagChunks(topic, matchCount)).join("\n\n");
}

const CHUNKS_PER_SECTION = 20;
const MIN_CHUNKS_PER_SECTION = 8;

/**
 * Each section searches the knowledge base on its own, and the searches
 * overlap — the same passage used to land in 3-4 sections, so each one taught
 * it again. Give every passage to the ONE section it matched best (earliest
 * rank); a section left with too few passages borrows its top shared ones back.
 */
async function getSectionContexts(plan: PlannedSection[]): Promise<string[]> {
  const results = await Promise.all(plan.map((p) => getRagChunks(p.query, CHUNKS_PER_SECTION + 10)));

  const owner = new Map<string, { section: number; rank: number }>();
  results.forEach((chunks, section) => {
    chunks.forEach((chunk, rank) => {
      const key = chunk.trim();
      const cur = owner.get(key);
      if (!cur || rank < cur.rank) owner.set(key, { section, rank });
    });
  });

  return results.map((chunks, section) => {
    const own = chunks.filter((c) => owner.get(c.trim())?.section === section);
    let picked = own.slice(0, CHUNKS_PER_SECTION);
    if (picked.length < MIN_CHUNKS_PER_SECTION) {
      const borrowed = chunks.filter((c) => !picked.includes(c)).slice(0, MIN_CHUNKS_PER_SECTION - picked.length);
      picked = [...picked, ...borrowed];
    }
    const shared = chunks.length - own.length;
    console.log(`Section ${section + 1}: ${picked.length} source passages (${shared} given to other sections)`);
    return picked.join("\n\n");
  });
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

// True/false "checkYourself" steps are switched off for now (advisor's call).
// Set to true to bring them back — the prompt text, validation, audio and
// slide rendering for them are all still in place.
const TRUE_FALSE_ENABLED = false;
// "Take a guess" 4-option slides (predictThen) and "Side by side" slides
// (compare): also switched off for now, the same way.
const GUESS_ENABLED = false;
const COMPARE_ENABLED = false;
// "Your turn": one open question per topic that the learner answers out loud
// (or types); the tutor responds to what they actually said.
const ASK_ALOUD_ENABLED = false;   // switched off for now
// Separate "fun fact" stat boxes on the overview (each read out as "One fun
// fact is..."): off — numbers go in the normal bullet list instead.
const STATS_ENABLED = false;

const DISABLED_STEP_TYPES = [
  ...(ASK_ALOUD_ENABLED ? [] : ['askAloud']),
  ...(TRUE_FALSE_ENABLED ? [] : ['checkYourself']),
  ...(GUESS_ENABLED ? [] : ['predictThen']),
  ...(COMPARE_ENABLED ? [] : ['compare']),
];

// Longer lessons: more slides per topic (each one idea, short bullets, longer
// narration) rather than longer individual slides.
const MIN_STEPS = 4;
const MAX_STEPS = 7;
// "detail" is the main way to add depth; with the guess/compare slides off it
// also has to make room for up to MAX_STEPS
const MAX_DETAIL = 4;

const isNarration = (v: unknown) => typeof v === 'string' && v.trim().split(/\s+/).length >= 15;
const isShortList = (v: unknown) =>
  Array.isArray(v) && v.length >= 1 && v.length <= 4 && v.every((b) => typeof b === 'string' && b.trim().length > 0);
const isBulletList = (v: unknown) =>
  Array.isArray(v) && v.length >= 1 && v.length <= 3 &&
  v.every((b) => typeof b === 'string' && b.trim().length > 0 && b.trim().split(/\s+/).length <= 12);

type SectionScope = { covers: string[]; others: { title: string; covers: string[] }[] };

function scopeText(scope: SectionScope | undefined, sectionNum: number): string {
  if (!scope) return '';
  const mine = scope.covers.length ? scope.covers.map((c) => `- ${c}`).join('\n') : '- (the section title)';
  const others = scope.others
    .map((o) => `- "${o.title}": ${o.covers.join('; ') || 'its title topic'}`)
    .join('\n');
  return `
THIS SECTION'S SCOPE — teach these points, in depth:
${mine}

OTHER SECTIONS OF THE SAME LESSON — the learner hears these separately. Do NOT teach, explain or repeat their facts, numbers or examples, even if they appear in the SOURCE CONTENT. If one is needed for context, mention it in a few words at most ("as you'll hear later", "remember those no-predator days?") and move on:
${others}
${sectionNum > 1 ? `
This is section ${sectionNum}: do not re-introduce what a blue catfish is — earlier sections already did.` : ''}
`;
}

async function generateSingleSection(
  ragContext: string,
  sectionTopic: string,
  sectionNum: number,
  attempt = 1,
  scope?: SectionScope,
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
${scopeText(scope, sectionNum)}
STRICT RULES YOU MUST FOLLOW:
1. "steps" is an ordered array of teaching steps for this section. Use between ${MIN_STEPS} and ${MAX_STEPS} steps. This lesson should feel full and informative: cover what the SOURCE CONTENT says about this topic in real depth (causes, numbers, examples, consequences, what people are doing about it), one idea per step, in an order that builds up. Use the whole SOURCE CONTENT, not just the first facts in it.
2. The FIRST step must always be type "overview" — it introduces the section. Give it "bullets" and "narration" (see rule 13). ${STATS_ENABLED ? `It may optionally include "stats": 1-2 short quantitative facts as {value, label} pairs. Prefer surprising magnitudes over plain dates. Omit "stats" entirely if the source content has no meaningful numbers for this topic — do not invent them or pad with trivia.` : `If the topic has a striking number, put it straight into one of the bullets (e.g. "Can top 100 pounds"); do not add a separate "stats" field.`}
3. Available step types after the overview: "detail" (one more idea about this topic, going deeper: a cause, a consequence, how something works, a real example from the source. Give it a short "heading" (2-5 words, may be playful), "bullets" and "narration". "detail" may be used up to ${MAX_DETAIL} times per section, each on a DIFFERENT idea — this is the main way to add depth)${COMPARE_ENABLED ? `, "compare" (two things side by side, e.g. blue catfish vs native catfish, before vs after, the problem vs the solution. Give "leftTitle" and "rightTitle" (1-3 words each), "left" and "right" (2-3 short points each, under 6 words, lined up so point 1 on the left pairs with point 1 on the right), and "narration" walking through the differences. Only use it when the SOURCE CONTENT really supports both sides)` : ''}, "example" (an analogy to something unrelated and familiar; give it "bullets" (1-2) and "narration" that tells the analogy out loud), "numberSpotlight" (a single STRIKING quantity that makes a learner react — a surprising scale, magnitude, or proportion. Provide "value" as the short number/quantity, "label" as a 3-6 word caption, "context" as ONE short on-screen line (under 12 words) that reacts to the number, and "narration" (see rule 13) explaining why this number matters. "100+ million fish" or "8-9% of body weight daily" are good; plain dates ("2011", "September 2019"), small counts, or routine figures are NOT — they're facts, not attention-grabbers)${GUESS_ENABLED ? `, "predictThen" (invites the learner to guess a surprising number or fact BEFORE it's revealed. Provide "question" (1 sentence), "options" (exactly 4 short guesses — one correct, three plausible but wrong, spread far enough apart that the right one isn't obvious), "correctIndex" (0-3, and vary its position rather than always using the same slot), and "answer" (the short factual answer, read aloud after they guess). Only use this for a number or specific fact someone could reasonably guess at.)` : ''}${TRUE_FALSE_ENABLED ? `, "checkYourself" (a single quick true/false comprehension check — provide "statement", "isTrue" (boolean), and "feedback" (1 sentence explaining why))` : ''}.
4. Include a step type ONLY if it genuinely helps for THIS content. Skip "example" if no honest analogy fits. Only use "numberSpotlight" if this section contains a genuinely surprising number — omit the step entirely if it doesn't; never settle for a date or a routine figure just to include one.${GUESS_ENABLED ? ` Only use "predictThen" for facts a learner could plausibly guess at.` : ''} Do not include the same type twice, except "detail" (up to ${MAX_DETAIL}).
5. Every step's content must be grounded strictly in the SOURCE CONTENT — never invent facts to fill out a step.
${ASK_ALOUD_ENABLED ? `5b. "askAloud" — EXACTLY ONE per section, placed after the teaching steps (second to last or last): an open question the learner answers OUT LOUD, that makes them think with what this section just taught — predict what happens, explain why, or apply it to something ("What do you think happens to the crabs when there are millions more catfish?"). Not a number to recall, not yes/no, not a quiz. Provide "question" (1 sentence, under 20 words, in the lesson voice), "lookFor" (1-3 short key ideas a good answer would include, from the SOURCE CONTENT), "answer" (2-3 spoken sentences: the professor's own answer, in the lesson voice, from the SOURCE CONTENT) and "simple" (the same question asked more plainly).
` : ''}6. ${TRUE_FALSE_ENABLED ? `Every section SHOULD include at least one interactive step ("predictThen" or "checkYourself") unless the content genuinely doesn't support one.` : GUESS_ENABLED ? `Include one "predictThen" step when the section has a number or fact worth guessing; otherwise skip it. Do NOT write true/false ("checkYourself") steps.` : `Only use the step types listed in rule 3. Do NOT write "predictThen", "checkYourself" or "compare" steps; teach with "overview", "detail", "example" and "numberSpotlight"${ASK_ALOUD_ENABLED ? `, plus the one "askAloud" question` : ''}.`}
7. "quiz" must contain EXACTLY 1 multiple-choice question testing THIS section's specific content. It must have exactly 4 "options", a "correctAnswer" index (0-3), and an "explanation" (1 short sentence stating the specific fact that makes the answer correct). CRITICAL — write the options so the correct answer is not identifiable by format alone: - All 4 options must be similar in length (within a few words of each other). The correct answer must NOT be the longest or most detailed option — that is the single most common giveaway. - All 4 options must be similar in specificity. Do not pair one precise, qualified answer against three vague ones. - Wrong options must be plausible to someone who didn't pay attention — draw them from real-sounding facts about Blue Catfish, not obviously absurd choices. - Vary which index is correct across sections; do not default to the same position. The question must be answerable ONLY by someone who paid attention to THIS section. Do not ask about general Blue Catfish knowledge that other sections also cover — anchor it to a specific fact, number, or claim unique to this section's content.
8. "recap" must be ONE sentence (12-20 words) summarizing this section's single most important takeaway, written to be read aloud as part of an end-of-lesson recap. Start it naturally so it flows in a list (e.g. "Blue Catfish were introduced in the 1970s for sport fishing." not "In this section we learned that...").
9. "value" must be a STRING, even when it is purely numeric (write "19", not 19). Every stat's "value" and "label" must state a fact exactly as it appears in the source content. Do not combine numbers from one fact with the subject of another.
10. "remediation" must be 2-3 short sentences that re-explain this section's single most important idea in the simplest possible way, for a learner who said they were lost. Use a different angle than the overview — a concrete everyday comparison works well. Do not introduce any new facts.
11. AUDIENCE AND VOICE: the learner is 10-14 years old and every line is read aloud by a text-to-speech voice. Use short, everyday words and sentences under 20 words. Write numbers and units the way you'd say them ("about 100 pounds", "8 to 9 percent"), never symbols or abbreviations like "~", "%", "lbs", "e.g.", or parentheses.
12. EVERY STEP MUST STAND ON ITS OWN: learners can jump straight to any step by voice ("go to the part about mercury"), so never open a narration with "They", "This", "It", or "As we saw". Name the subject ("Blue catfish...") and the step's key idea in its first sentence, so it makes sense heard on its own and can be found by its topic.
13. SCREEN TEXT vs. SPOKEN TEXT — the learner SEES "bullets" and HEARS "narration". They must not be the same words; the professor must never sound like they are reading the slide.
   - "bullets": 2-3 key points (1-2 for "example"${COMPARE_ENABLED ? `; "compare" uses "left"/"right" instead` : ''}), each UNDER 8 words. Fragments, not sentences. No filler ("It is important to note", "In fact", "This means that"). No two bullets say the same thing. Each bullet is one fact from the SOURCE CONTENT, and a bullet may have a quick joke in it.
   - "narration": 4-6 spoken sentences (about 60-100 words) that EXPLAIN and BRANCH OUT from the bullets: the why or how behind them, a vivid example, or one extra detail from the SOURCE CONTENT that the bullets leave out. Cover the bullets' points in order so they can appear on screen as they are mentioned, but in fresh words; never read a bullet out word for word. Every added detail must still come from the SOURCE CONTENT.
14. TONE — funny, goofy, a little sarcastic, like a favorite science teacher who thinks this fish is ridiculous. Examples of the voice: "Blue catfish: basically a vacuum cleaner with fins." / "Nothing in the Bay eats them. Rude." / "Spoiler: the crabs are not thrilled." Rules for the humor:
   - Aim the sarcasm at the fish, the situation, or the problem, NEVER at the learner, a group of people, or anyone's answer.
   - At most one joke per bullet list and one or two per narration; the facts come first and must stay exactly right.
   - Keep it kind and classroom-safe for ages 10-14. No insults, no pop-culture references that will date.
   - Quiz questions, quiz options, and "explanation" stay plain and clear (no jokes there); "feedback", "answer", "recap" and "remediation" can be warm and lightly playful.
15. "simple" — EVERY step also gets a "simple" string: the SAME step said as plainly as possible, for a learner who just said "simpler please". Use 1-2 short sentences (under 25 words total) of everyday words a 9 year old knows. No jokes, no sarcasm, no new facts, no numbers the step doesn't already have.
   - "overview" / "detail" / ${COMPARE_ENABLED ? `"compare" / ` : ''}"example" / "numberSpotlight": plainly say what the information IS (e.g. "Blue catfish get very big. Some weigh more than 100 pounds.").
${GUESS_ENABLED ? `   - "predictThen": ask the SAME question more plainly (the options and the correct answer stay the same).
` : ''}${TRUE_FALSE_ENABLED ? `   - "checkYourself": say the SAME statement more plainly, so its true/false answer does not change. Do not start it with "True or false".
` : ''}
Output ONLY a JSON object with key "section":

{
  "section": {
    "title": "String",
    "icon": "emoji",
    "image": "",
    "recap": "one sentence takeaway",
    "remediation": "2-3 simple sentences",
    "steps": [
      { "type": "overview", "bullets": ["...", "..."], "narration": "...", "simple": "..."${STATS_ENABLED ? `, "stats": [{"value": "...", "label": "..."}]` : ''} },
      { "type": "detail", "heading": "...", "bullets": ["...", "..."], "narration": "...", "simple": "..." },
${COMPARE_ENABLED ? `      { "type": "compare", "leftTitle": "...", "left": ["...", "..."], "rightTitle": "...", "right": ["...", "..."], "narration": "...", "simple": "..." },
` : ''}      { "type": "example", "bullets": ["..."], "narration": "...", "simple": "..." },
      { "type": "numberSpotlight", "value": "...", "label": "...", "context": "...", "narration": "...", "simple": "..." }${ASK_ALOUD_ENABLED ? `,
      { "type": "askAloud", "question": "...", "lookFor": ["...", "..."], "answer": "...", "simple": "..." }` : ''}${GUESS_ENABLED ? `,
      { "type": "predictThen", "question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 2, "answer": "...", "simple": "..." }` : ''}${TRUE_FALSE_ENABLED ? `,
      { "type": "checkYourself", "statement": "...", "isTrue": true, "feedback": "...", "simple": "..." }` : ''}
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
      // more, longer steps: give it room (a cut-off reply is retried, but costs time)
      max_completion_tokens: 9000,
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
      return generateSingleSection(ragContext, sectionTopic, sectionNum, attempt + 1, scope);
    }
    throw new Error(`No usable content from AI for section ${sectionNum} (${why})`);
  }
  const section = parsed.section ?? parsed;
  
  const steps = section.steps;
  const validSteps =
    Array.isArray(steps) &&
    steps.length >= MIN_STEPS && steps.length <= MAX_STEPS &&
    steps[0]?.type === 'overview' &&
    // one of each type, except "detail" (up to MAX_DETAIL)
    new Set(steps.filter((s: any) => s.type !== 'detail').map((s: any) => s.type)).size === steps.filter((s: any) => s.type !== 'detail').length &&
    steps.filter((s: any) => s.type === 'detail').length <= MAX_DETAIL &&
    steps.every((s: any) => !DISABLED_STEP_TYPES.includes(s.type)) &&
    (!ASK_ALOUD_ENABLED || steps.filter((s: any) => s.type === 'askAloud').length === 1) &&
    steps.every((s: any) => {
      if (typeof s.simple !== 'string' || !s.simple.trim()) return false;   // every step needs its plain version
      if (s.type === 'numberSpotlight') return typeof s.value === 'string' && typeof s.label === 'string' && typeof s.context === 'string' && isNarration(s.narration);
      if (s.type === 'askAloud') return typeof s.question === 'string' && s.question.trim().length > 0 && isShortList(s.lookFor) && typeof s.answer === 'string' && s.answer.trim().length > 0;
      if (s.type === 'compare') return typeof s.leftTitle === 'string' && typeof s.rightTitle === 'string' && isShortList(s.left) && isShortList(s.right) && isNarration(s.narration);
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
    return generateSingleSection(ragContext, sectionTopic, sectionNum, attempt + 1, scope);
  }
    
  // Last line of defence for switched-off step types (the model can ignore the prompt)
  if (Array.isArray(section.steps)) {
    section.steps = section.steps.filter((st: any) => !DISABLED_STEP_TYPES.includes(st?.type));
    // stats off: any the model still wrote become ordinary bullets
    if (!STATS_ENABLED) {
      for (const st of section.steps) {
        if (Array.isArray(st?.stats) && st.stats.length) {
          st.bullets = [...(st.bullets ?? []), ...st.stats.map((x: any) => `${x.value} ${x.label}`)].slice(0, 4);
        }
        if (st) delete st.stats;
      }
    }
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
            content: `Write a short spoken line directing a learner's attention to an image on screen, then explaining what it shows and why it matters for this lesson section. 1-2 sentences total (20ish words). Start by pointing at the image naturally ("Take a look at the image on screen..." / "Notice in the picture..."). Use the lesson's voice: funny, goofy, a little sarcastic about the fish, kind to the learner, ages 10-14. Base it ONLY on the provided image description — never invent visual details. Also write "simple": one plain, short sentence (everyday words, no jokes) saying what the picture shows, for a learner who asked for it simpler. Output JSON: { "text": "...", "simple": "..." }`,
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
        section.steps.splice(1, 0, {
          type: 'imageFocus',
          text: parsed.text,
          narration: parsed.text,
          simple: typeof parsed.simple === 'string' ? parsed.simple : undefined,
        });
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
  
    // More source per topic (20 passages), but each passage goes to one topic only
    const ragContexts = await getSectionContexts(plan);

    const sections = await Promise.all(
      plan.map((p, i) =>
        generateSingleSection(ragContexts[i], p.title, i + 1, 1, {
          covers: p.covers,
          others: plan.filter((_, j) => j !== i).map((o) => ({ title: o.title, covers: o.covers })),
        })
      )
    );

    dedupeStats(sections);
    // Anything that still repeats across topics shows up on /lessonReview; log it here too
    const repeats = findCrossSectionRepeats(sections);
    if (repeats.length) console.warn(`Cross-section repeats (${repeats.length}):`, repeats.slice(0, 10));
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
