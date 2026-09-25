// Finds facts that show up in more than one section of a generated lesson
// (the "same point taught 2-3 times" problem). Used after generation for
// logging and on /lessonReview so a person can see exactly what repeats.

export interface LessonFact {
  section: number;
  step: number;
  text: string;
}

export interface Repeat {
  a: LessonFact;
  b: LessonFact;
  why: string;
}

const STOP = new Set(
  ('a an the of to in on at for and or but is are was were be been it its this that these those they them their there ' +
   'what which who how why when where do does did can could would should will with from by as into than then so ' +
   'blue catfish fish bay chesapeake one more most some any very really just also even about up out all')
    .split(' '),
);

function stem(w: string): string {
  return w.replace(/(?:ing|ed|es|s)$/, '');
}

function words(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z]+/g) ?? [])
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stem),
  );
}

// "100", "1970s", "8-9" — the same number in two sections is usually the same fact
function numbers(text: string): Set<string> {
  return new Set((text.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]+$/, '').replace(/,/g, '')).filter((n) => n.length > 0 && n !== '1' && n !== '2'));
}

/** The short, on-screen facts of every slide: bullets, stats, number spotlights, headings. */
export function lessonFacts(sections: { steps?: any[] }[]): LessonFact[] {
  const facts: LessonFact[] = [];
  sections.forEach((sec, section) => {
    (sec.steps ?? []).forEach((st: any, step: number) => {
      const add = (text: unknown) => {
        if (typeof text === 'string' && text.trim()) facts.push({ section, step, text: text.trim() });
      };
      (st.bullets ?? []).forEach(add);
      (st.left ?? []).forEach(add);
      (st.right ?? []).forEach(add);
      (st.stats ?? []).forEach((s: any) => add(`${s.value} ${s.label}`));
      if (st.type === 'numberSpotlight') add(`${st.value} ${st.label}`);
      if (st.type === 'predictThen') add(st.answer);
      if (!st.bullets && typeof st.text === 'string') add(st.text);   // lessons made before bullets
    });
  });
  return facts;
}

/**
 * Pairs of facts from DIFFERENT sections that say the same thing: they share
 * a number plus a word, or most of their words.
 */
export function findCrossSectionRepeats(sections: { steps?: any[] }[]): Repeat[] {
  const facts = lessonFacts(sections).map((f) => ({ f, w: words(f.text), n: numbers(f.text) }));
  const repeats: Repeat[] = [];
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const x = facts[i], y = facts[j];
      if (x.f.section === y.f.section) continue;
      const shared = [...x.w].filter((w) => y.w.has(w));
      const sharedNums = [...x.n].filter((n) => y.n.has(n));
      const overlap = shared.length / Math.max(1, Math.min(x.w.size, y.w.size));
      if (sharedNums.length && shared.length >= 1) {
        repeats.push({ a: x.f, b: y.f, why: `same number ${sharedNums.join(', ')}` });
      } else if (shared.length >= 2 && overlap >= 0.6) {
        repeats.push({ a: x.f, b: y.f, why: `same words: ${shared.join(', ')}` });
      }
    }
  }
  return repeats;
}
