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

// Words a learner wraps around a command: "um, can you please skip ahead?"
const LEAD = String.raw`^(?:(?:um+|uh+|ok(?:ay)?|so|hey|professor|marine|finley|please|can you|could you|can we|could we|let'?s|i want to|i wanna|i'd like to|just)[\s,]+)*`;
const TAIL = String.raw`(?:[\s,]+(?:please|now|then|thanks|thank you))*[\s.!?]*$`;

const cmd = (body: string) => new RegExp(`${LEAD}(?:${body})${TAIL}`, 'i');

const NEXT_TOPIC = cmd(String.raw`(?:go (?:on )?to |skip (?:ahead )?to |move (?:on )?to |jump (?:ahead )?to )?(?:the )?next (?:topic|section|chapter)|skip (?:this |the )?(?:topic|section|chapter)|new topic|change (?:the )?topic|different topic`);
const NEXT_SLIDE = cmd(String.raw`skip(?: ahead| forward| it| this(?: slide| part)?)?|(?:go (?:on )?to |skip to |move (?:on )?to )?(?:the )?next(?: slide| part| one| page| step)?|move on|keep going|go on|continue|forward|next please`);
const PREV_SLIDE = cmd(String.raw`go back(?: a slide| one)?|back(?: up)?|(?:go to )?(?:the )?previous(?: slide| part| one| page| step)?`);
const REPEAT = cmd(String.raw`(?:explain|say|do) (?:that|it|this) again|again|repeat(?: that| it| this)?|one more time|say that one more time|what did you say|come again|pardon|i didn'?t (?:get|catch|hear) that`);
const SIMPLIFY = cmd(String.raw`(?:explain (?:that|it|this) )?(?:more )?simpl(?:er|y)|make (?:it|that) simpler|easier|in (?:plain|simple|easier) (?:words|english)|dumb it down|eli5|explain (?:that|it|this) (?:more )?simply`);
const GO_TO = new RegExp(
  `${LEAD}(go to|goto|take me to|bring me to|jump to|skip to|show me|go back to|return to|find|where(?:'s| is)|let'?s (?:talk|learn) about|tell me about|teach me about)\\s+(?:the\\s+)?(?:(?:part|slide|section|topic|bit|page)s?\\s+(?:about|on|with|where|that|for)\\s+)?(.+?)${TAIL}`,
  'i',
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
  cmd_lastTopic: "That was the last topic. Here's the topic list.",
  cmd_atStart: 'This is the start of the lesson.',
} as const;

export type AckKey = keyof typeof COMMAND_ACK_TEXT;

/** Returns a command when the whole utterance is a command, otherwise null. */
export function parseDeckCommand(raw: string): DeckCommand | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text || text.length > 120) return null;

  // Order matters: "next topic" before "next", "go back" before "go to".
  if (NEXT_TOPIC.test(text)) return { kind: 'nextTopic' };
  if (PREV_SLIDE.test(text)) return { kind: 'prevSlide' };
  if (NEXT_SLIDE.test(text)) return { kind: 'nextSlide' };
  if (REPEAT.test(text)) return { kind: 'repeat' };
  if (SIMPLIFY.test(text)) return { kind: 'simplify' };

  const m = text.match(GO_TO);
  if (m) {
    const verb = m[1].toLowerCase();
    const query = m[2].trim();
    // a long "tell me about ..." is a question for the tutor, not a jump
    if (query && query.split(' ').length <= 8) {
      return { kind: 'goTo', query, soft: /about$/.test(verb) };
    }
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
      for (const key of ['text', 'context', 'value', 'label', 'question', 'answer', 'statement', 'feedback']) {
        const v = step[key];
        if (typeof v === 'string') parts.push(v);
      }
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
