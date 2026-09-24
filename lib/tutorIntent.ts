// Deterministic intent classification for deck-control decisions.
// Keyword rules only — no LLM call, testable, same behavior every time.
export type TutorAction = 'repeat' | 'simplify' | 'advance' | 'none';

export function classifyIntent(userText: string): {
  action: TutorAction;
  matched: string | null;
} {
  const t = userText.toLowerCase();
  // Same idea as the client's deck commands (lib/deckCommands.ts): being lost
  // or confused asks for a plainer version, not the same words again.
  if (/\b(simpl\w*|dumb it down|explain (it )?like|eas(y|ier)|plain(er)?|eli5|confus\w*|lost|complicated|too hard|don'?t (understand|get it)|didn'?t (get|follow|understand)|break it down)\b/.test(t)) {
    return { action: 'simplify', matched: 'simplify-cue' };
  }
  if (/\b(again|repeat|repeat that|one more time|slower|say that again)\b/.test(t)) {
    return { action: 'repeat', matched: 'repeat-cue' };
  }
  if (/\b(skip|skip ahead|next (section|slide|topic)|move on|bore[dn]\b|boring|hurry)\b/.test(t)) {
    return { action: 'advance', matched: 'advance-cue' };
  }
  return { action: 'none', matched: null };
}
