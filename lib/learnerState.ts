// Learner-state rollup shared by the browser (lib/signals.ts) and the
// /api/signals/state route. The browser keeps the running counters for its
// own session and sends the whole row each time, so the server never has to
// read-modify-write and concurrent updates can't lose increments.

export type LearnerMood = 'neutral' | 'confused' | 'frustrated' | 'bored' | 'engaged';
export type SelfCheckRating = 'got' | 'kind' | 'lost';

export interface SectionCounters {
  visits: number;             // times the learner entered this section
  repeats: number;            // "explain that again"
  simplify_requests: number;  // "simpler please"
  confusion_marks: number;    // "I'm confused / lost" said to the tutor
  skips: number;              // "skip ahead" / "next topic" while in this section
  jumps: number;              // "go to <part>" landing in this section
  questions: number;          // free-form questions to the tutor
  barge_ins: number;          // talked over the narration
  quiz_misses: number;
  quiz_passed: boolean | null;
  self_check: SelfCheckRating | null;
  dwell_ms_total: number;
}

export interface SectionState extends SectionCounters {
  last_state: LearnerMood;
}

export const EMPTY_COUNTERS: SectionCounters = {
  visits: 0, repeats: 0, simplify_requests: 0, confusion_marks: 0, skips: 0, jumps: 0,
  questions: 0, barge_ins: 0, quiz_misses: 0, quiz_passed: null, self_check: null, dwell_ms_total: 0,
};

/**
 * One rule for what the counters mean, used everywhere. Confusion signals
 * outrank everything else: a learner who skips a lot but also misses the
 * quiz is struggling, not bored.
 */
export function deriveMood(c: SectionCounters): LearnerMood {
  const selfCheck = c.self_check === 'lost' ? 2 : c.self_check === 'kind' ? 1 : 0;
  const struggle = c.repeats + c.simplify_requests + c.confusion_marks + 2 * c.quiz_misses + selfCheck;

  if (struggle >= 5 || (c.quiz_misses > 0 && c.repeats + c.simplify_requests >= 2)) return 'frustrated';
  if (struggle >= 2 || c.quiz_misses > 0 || c.self_check === 'lost') return 'confused';
  if (c.skips >= 2 && struggle === 0) return 'bored';
  if (c.quiz_passed === true || c.self_check === 'got' || c.questions >= 1 || c.jumps >= 1) return 'engaged';
  return 'neutral';
}

/** A one-line brief for the tutor's system prompt, or '' when there's nothing to say. */
export function describeForTutor(s: SectionState | null): string {
  if (!s || s.last_state === 'neutral') return '';
  const bits: string[] = [];
  if (s.repeats) bits.push(`asked to repeat ${s.repeats}x`);
  if (s.simplify_requests) bits.push(`asked for simpler ${s.simplify_requests}x`);
  if (s.quiz_misses) bits.push(`missed ${s.quiz_misses} quiz question${s.quiz_misses > 1 ? 's' : ''}`);
  if (s.self_check) bits.push(`rated this section "${s.self_check}"`);
  if (s.skips) bits.push(`skipped ${s.skips}x`);
  const how: Record<LearnerMood, string> = {
    neutral: '',
    confused: 'Use shorter sentences and one concrete everyday comparison.',
    frustrated: 'Be extra encouraging, use the simplest words you can, and keep it to two sentences.',
    bored: 'Lead with the most surprising fact and keep it brisk.',
    engaged: 'They are keen — you can add one extra interesting detail.',
  };
  return ` The learner currently seems ${s.last_state} in this section${bits.length ? ` (${bits.join(', ')})` : ''}. ${how[s.last_state]}`;
}
