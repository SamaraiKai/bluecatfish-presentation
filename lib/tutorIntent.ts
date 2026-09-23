// Deterministic intent classification for deck-control decisions.
// Keyword rules only — no LLM call, testable, same behavior every time.
export type TutorAction = 'repeat' | 'simplify' | 'advance' | 'none';

export function classifyIntent(userText: string): {
  action: TutorAction;
  matched: string | null;
} {
  const t = userText.toLowerCase();
  if (/\b(again|repeat|repeat that|one more time|confus\w*|lost|slower|didn'?t (get|follow)|say that again)\b/.test(t)) {
    return { action: 'repeat', matched: 'repeat-cue' };
  }
  if (/\b(simpler|simply|dumb it down|explain (it )?like|easier|plain (english|words)|eli5)\b/.test(t)) {
    return { action: 'simplify', matched: 'simplify-cue' };
  }
  if (/\b(skip|skip ahead|next (section|slide|topic)|move on|bore[dn]\b|boring|hurry)\b/.test(t)) {
    return { action: 'advance', matched: 'advance-cue' };
  }
  return { action: 'none', matched: null };
}
