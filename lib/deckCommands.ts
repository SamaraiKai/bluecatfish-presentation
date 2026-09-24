// Deck-control voice/text commands, resolved on the client with no LLM call.
// A command gets a short pre-recorded acknowledgement ("Skipping ahead.") and
// then the deck moves, so navigation feels instant instead of waiting on a
// chat round-trip. Anything that is not clearly a command goes to the tutor.

export type DeckCommand =
  | { kind: 'nextSlide' }
  | { kind: 'prevSlide' }
  | { kind: 'nextTopic' }
  | { kind: 'repeat' }
  | { kind: 'simplify' }
  // soft = "tell me about X": if X isn't on a slide, let the tutor answer instead
  | { kind: 'goTo'; query: string; soft: boolean };

/* ============================================================================
 * RECOGNISING COMMANDS
 * Each command has "cues": phrases that can appear anywhere in what the
 * learner says ("explain that simpler for me", "ugh this is so confusing").
 * Misspellings and speech-to-text slips are corrected first ("simpelr").
 * If, after removing the cue and filler words, the message still has real
 * content words left, it's a question for the tutor, not a command
 * ("why are blue catfish simpler to catch?").
 * ========================================================================== */

// Filler that can surround any command without changing its meaning
const FILLER = new Set((
  'um umm uh uhh er ok okay so hey hi professor marine finley please pls plz can could would will you ' +
  'u we us let lets let\'s i im i\'m me my myself just maybe like really actually kinda sort of a an the ' +
  'this that it its it\'s these those there here now then thanks thank bit little lot way ' +
  'for to do does did be is are was were am it\'ll that\'s what\'s want wanna need gonna go going ' +
  'again more much some very too so and or but on in with about at up out all one ' +
  'explain say said tell talk put make give show try slide part page step thing stuff things ' +
  'please sir miss teacher dude bro yeah yes no nah oh well hmm ' +
  // feelings wrapped around a command: "skip the slide, I don't care anymore"
  'don\'t dont care anymore any whatever honestly seriously literally ugh man bruh omg lol ' +
  'already bored tired sick done enough over'
).split(' '));

type CueKind = 'nextTopic' | 'prevSlide' | 'nextSlide' | 'repeat' | 'simplify';

// Checked in this order; the first match wins. "simplify" is before "repeat"
// so "explain that again but simpler" simplifies.
const CUES: [CueKind, RegExp][] = [
  ['nextTopic', /\b(?:next|new|another|different|other|following) (?:topic|section|chapter|subject|lesson)\b|\bskip (?:this |the |that )?(?:whole )?(?:topic|section|chapter|subject)\b|\bchange (?:the )?(?:topic|subject)\b|\bsomething else\b/],
  ['prevSlide', /\bgo(?:ing)? back\b(?! to\b)|\bback ?up\b|\bprevious\b|\blast (?:slide|one|part|page|step)\b|\brewind\b|\bone back\b|\bslide before\b/],
  ['simplify', /\bsimpl\w*|\beas(?:y|ier|iest)\b|\bplain(?:er)?\b|\bless (?:confusing|complicated|hard|difficult|technical|fancy)\b|\bconfus\w*|\bcomplicated\b|\bdon'?t (?:understand|get it|get that|get this|follow)\b|\bdo not (?:understand|get)\b|\bdidn'?t (?:understand|follow)\b|\b(?:too|so|really|very) (?:hard|difficult|complicated|confusing|fast|much)\b|\bi'?m lost\b|\blost me\b|\bdumb (?:it|that) down\b|\beli5\b|\blike i'?m (?:5|five|a kid|a baby|little)\b|\bbreak (?:it|that|this) down\b|\bbasic(?:ally)?\b|\bkid words\b|\bnormal words\b|\bwhat does (?:that|this|it) (?:even )?mean\b|\bhuh+\b/],
  ['repeat', /\bagain\b|\brepeat\w*|\breplay\b|\bone more time\b|\bwhat did you (?:just )?say\b|\bdidn'?t (?:hear|catch|get) (?:that|it|you)\b|\bmissed (?:that|it)\b|\bcome again\b|\bpardon\b|\bsay (?:that|it) over\b|\bstart (?:the |this )?(?:slide )?over\b/],
  ['nextSlide', /\bskip\w*|\bnext\b|\bmove (?:on|along|ahead|forward)\b|\bkeep going\b|\bgo on\b|\bgo ahead\b|\bcarry on\b|\bcontinue\b|\bforward\b|\bahead\b|\bhurry\b|\bfaster\b|\bboring\b|\bbored\b|\balready know\b|\bi know (?:this|that|it)\b|\bget on with\b|\b(?:don'?t|do not) care\b|\bwho cares\b|\bnot interested\b|\bidc\b|\bwhatever\b|\b(?:i'?m )?(?:so )?(?:done|over it|tired of this|sick of this)\b/],
];

// Every word the cues are built from — used to fix misspellings before matching
const VOCAB = [
  'simpler', 'simple', 'simply', 'simplify', 'easier', 'easy', 'plain', 'confusing', 'confused',
  'complicated', 'understand', 'difficult', 'explain', 'again', 'repeat', 'replay', 'previous',
  'rewind', 'skip', 'next', 'continue', 'forward', 'ahead', 'topic', 'section', 'chapter',
  'subject', 'different', 'another', 'boring', 'already', 'basically', 'pardon', 'missed',
];

// Damerau-Levenshtein distance (a swap of two letters counts as one edit)
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Text-speak and short forms too short for typo matching
const ALIASES: Record<string, string> = {
  nxt: 'next', nex: 'next', agn: 'again', rpt: 'repeat', ez: 'easy', ezy: 'easy', ezier: 'easier',
  prev: 'previous', abt: 'about', smpl: 'simple', u: 'you', r: 'are', pls: 'please', plz: 'please',
};

function fixTypo(word: string): string {
  if (ALIASES[word]) return ALIASES[word];
  if (word.length < 4 || VOCAB.includes(word)) return word;
  const allowed = word.length >= 7 ? 2 : 1;
  let best = word;
  let bestDist = allowed + 1;
  for (const v of VOCAB) {
    if (Math.abs(v.length - word.length) > allowed) continue;
    const dist = editDistance(word, v);
    if (dist < bestDist) { best = v; bestDist = dist; }
  }
  return best;
}

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'?\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(fixTypo)
    .join(' ');
}

// Words left once cues and filler are removed. More than a couple means the
// learner is asking about something specific, which the tutor should answer.
function contentWords(text: string, cue: RegExp): string[] {
  const global = new RegExp(cue.source, 'g');
  return text
    .replace(global, ' ')
    .replace(/\?/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w));
}

const GO_TO = new RegExp(
  String.raw`^(?:(?:um+|uh+|ok(?:ay)?|so|hey|professor|please|can you|could you|can we|could we|let'?s|i want to|i wanna|i'?d like to|just)\s+)*` +
  String.raw`(go to|goto|go back to|take me to|bring me to|jump to|skip to|show me|return to|find|where'?s|where is|let'?s (?:talk|learn) about|tell me about|teach me about|what about)\s+` +
  String.raw`(?:the\s+)?(?:(?:part|slide|section|topic|bit|page)s?\s+(?:about|on|with|where|that|for)\s+)?(.+?)` +
  String.raw`(?:\s+(?:please|now|then|thanks|thank you))*\s*\??$`,
);

// Short acknowledgements, pre-recorded by /api/slidesv2/audio under these keys
// so the reply plays instantly, before the deck moves.
export const COMMAND_ACK_TEXT = {
  cmd_nextSlide: 'Skipping ahead.',
  cmd_prevSlide: 'Going back.',
  cmd_nextTopic: 'On to the next topic.',
  cmd_repeat: 'Sure, here it is again.',
  cmd_simplify: 'Let me put that more simply.',
  cmd_goto: "Here's that part.",
  cmd_notFound: "Hmm, I couldn't find that anywhere in this presentation.",
  cmd_quizFirst: "Let's finish this quiz first.",
  cmd_wrapUp: "That was the last topic. Let's wrap up.",
  cmd_atStart: 'This is the start of the lesson.',
} as const;

export type AckKey = keyof typeof COMMAND_ACK_TEXT;

/** Returns a command when the message is a deck command, otherwise null (it goes to the tutor). */
export function parseDeckCommand(raw: string): DeckCommand | null {
  const text = normalize(raw);
  if (!text || text.split(' ').length > 16) return null;

  // "go to <part>" first, unless the part is itself a slide/topic move ("go to the next topic")
  const m = text.match(GO_TO);
  if (m) {
    const verb = m[1];
    const query = m[2].replace(/\?/g, '').trim();
    const isMove =
      /^(?:next|previous|last) (?:slide|part|one|page|step)$/.test(query) ||
      /^(?:next|new|another|different) (?:topic|section|chapter)$/.test(query);   // "last topic" is a real place
    if (query && !isMove && query.split(' ').length <= 8) {
      return { kind: 'goTo', query, soft: /about$/.test(verb) };
    }
  }

  // A bare "what?" means "huh, I didn't get that"
  if (/^what\??$/.test(text)) return { kind: 'simplify' };

  for (const [kind, cue] of CUES) {
    if (!cue.test(text)) continue;
    if (contentWords(text, cue).length > 2) return null;   // a real question, e.g. "why is it easier for them to spread?"
    return { kind };
  }
  return null;
}

/* ============================================================================
 * FINDING A PART OF THE PRESENTATION
 * ========================================================================== */

export interface SearchableSection {
  title: string;
  steps: Record<string, unknown>[];
  recap?: string;
  remediation?: string;
  quiz?: { question: string; explanation: string }[];
}

export interface SlideDoc {
  section: number;
  step: number;
  title: string;
  text: string;
}

export type DeckTarget = { section: number; step: number };

const STOP = new Set(
  'a an the of to in on at for and or but is are was were be been it its this that these those there their they them what which who how why when where do does did can could would should will about with from by as into than then so me my i you your we our us part slide section topic bit page one some any more most thing things stuff tell show talk learn go take bring jump skip find please blue catfish fish'.split(' '),
);

// Crude stemmer: good enough to line up "eating"/"eat", "invasive"/"invasion".
function stem(w: string): string {
  return w
    .replace(/(?:ational|ation|ations|ions?)$/, '')
    .replace(/(?:ing|ed|ly|ies|es|s|ive)$/, '')
    .replace(/(.)\1$/, '$1');
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => !STOP.has(w) && (w.length > 2 || /\d/.test(w)))
    .map(stem)
    .filter(Boolean);
}

// A few everyday words a young learner might use for what the slides call something else.
const SYNONYMS: Record<string, string[]> = {
  eat: ['food', 'nutrition', 'diet', 'cook', 'recipe', 'meal', 'dinner', 'menu', 'seafood'],
  food: ['eat', 'nutrition', 'diet', 'cook', 'meal', 'dinner'],
  cook: ['eat', 'recipe', 'food', 'dinner'],
  help: ['action', 'fish', 'harvest', 'catch', 'volunteer'],
  stop: ['control', 'manage', 'harvest', 'remove'],
  invasive: ['invader', 'invasion', 'spread', 'introduc'],
  problem: ['impact', 'threat', 'harm', 'damage'],
  harm: ['impact', 'threat', 'damage', 'prey'],
  size: ['big', 'weigh', 'pound', 'length', 'grow'],
  big: ['size', 'weigh', 'pound', 'grow', 'large'],
  catch: ['fish', 'harvest', 'angler', 'commercial'],
};

/** Flattens every slide into searchable text. Step -1 means "the section in general". */
export function buildSlideDocs(sections: SearchableSection[]): SlideDoc[] {
  const docs: SlideDoc[] = [];
  sections.forEach((sec, i) => {
    sec.steps.forEach((step, s) => {
      const parts: string[] = [];
      for (const key of ['text', 'narration', 'simple', 'context', 'value', 'label', 'question', 'answer', 'statement', 'feedback']) {
        const v = step[key];
        if (typeof v === 'string') parts.push(v);
      }
      if (Array.isArray(step.bullets)) parts.push(...(step.bullets as unknown[]).filter((b): b is string => typeof b === 'string'));
      if (Array.isArray(step.options)) parts.push(...(step.options as unknown[]).filter((o): o is string => typeof o === 'string'));
      if (Array.isArray(step.stats)) {
        for (const st of step.stats as { value?: string; label?: string }[]) parts.push(`${st.value ?? ''} ${st.label ?? ''}`);
      }
      docs.push({ section: i, step: s, title: sec.title, text: parts.join(' ') });
    });
    const extra = [sec.recap, sec.remediation, ...(sec.quiz ?? []).flatMap((q) => [q.question, q.explanation])]
      .filter(Boolean)
      .join(' ');
    if (extra) docs.push({ section: i, step: -1, title: sec.title, text: extra });
  });
  return docs;
}

const ORDINALS: Record<string, number> = {
  first: 1, one: 1, '1st': 1, second: 2, two: 2, '2nd': 2, third: 3, three: 3, '3rd': 3,
  fourth: 4, four: 4, '4th': 4, fifth: 5, five: 5, '5th': 5, sixth: 6, six: 6, '6th': 6,
  seventh: 7, seven: 7, '7th': 7,
};

/**
 * Structural targets: "topic 3", "the second section", "the last topic",
 * "the beginning". Returns null when the query isn't about position.
 */
function findByPosition(query: string, sections: SearchableSection[]): DeckTarget | null {
  const q = query.toLowerCase();
  if (/^(?:the )?(?:beginning|start)(?: of (?:the |this )?(?:topic|section))?$/.test(q)) return { section: -1, step: 0 };
  if (/^(?:the )?(?:last|final) (?:topic|section|chapter)$/.test(q)) return { section: sections.length - 1, step: 0 };
  if (/^(?:the )?(?:first) (?:topic|section|chapter)$/.test(q)) return { section: 0, step: 0 };

  const m =
    q.match(/^(?:topic|section|chapter)\s+(?:number\s+)?(\w+)$/) ??
    q.match(/^(?:the )?(\w+) (?:topic|section|chapter)$/);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : ORDINALS[m[1]];
    if (n && n >= 1 && n <= sections.length) return { section: n - 1, step: 0 };
    if (n) return null;
  }
  const s = q.match(/^(?:slide|step|part)\s+(?:number\s+)?(\w+)$/) ?? q.match(/^(?:the )?(\w+) (?:slide|step|part)$/);
  if (s) {
    const n = /^\d+$/.test(s[1]) ? Number(s[1]) : ORDINALS[s[1]];
    if (n) return { section: -1, step: n - 1 };   // -1 = current section, resolved by the caller
  }
  return null;
}

/**
 * Keyword search over the slides. Title hits count double; the best single
 * slide wins. Returns null when too little of the query is covered, so the
 * caller can fall back to semantic search or say it isn't in the lesson.
 */
export function findInPresentation(
  query: string,
  sections: SearchableSection[],
  docs: SlideDoc[] = buildSlideDocs(sections),
): (DeckTarget & { confident: boolean }) | null {
  const pos = findByPosition(query, sections);
  if (pos) return { ...pos, confident: true };

  const qTokens = [...new Set(tokens(query))];
  if (qTokens.length === 0) return null;

  let best: { doc: SlideDoc; score: number; covered: number } | null = null;
  for (const doc of docs) {
    const body = new Set(tokens(doc.text));
    const title = new Set(tokens(doc.title));
    let score = 0;
    let covered = 0;
    for (const t of qTokens) {
      const syn = SYNONYMS[t] ?? [];
      const hit = (set: Set<string>) =>
        set.has(t) || syn.some((w) => set.has(stem(w))) ||
        // prefix match catches "invas" vs "invader" without a real stemmer
        (t.length >= 5 && [...set].some((w) => w.length >= 5 && (w.startsWith(t) || t.startsWith(w))));
      const inTitle = hit(title);
      const inBody = hit(body);
      if (inTitle || inBody) covered++;
      score += (inTitle ? 2 : 0) + (inBody ? 1 : 0);
    }
    // Prefer the specific slide over the section-level extras on a tie
    if (doc.step === -1) score -= 0.25;
    if (!best || score > best.score) best = { doc, score, covered };
  }

  if (!best || best.covered === 0) return null;
  const coverage = best.covered / qTokens.length;
  return {
    section: best.doc.section,
    step: Math.max(0, best.doc.step),
    confident: coverage >= 0.5,
  };
}
