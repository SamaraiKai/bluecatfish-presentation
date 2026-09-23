import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Variant slide lookup — the "replace the current slide" mechanic.
 *
 * GET /api/tutor/variant?section=1&state=confused
 *   → the best matching reviewed variant slide for this section + learner state.
 *
 * The client then shows the variant (title/body), narrates it (audio_url if
 * pre-rendered, else the tutor speaks the narration text), and returns to the
 * main sequence at the marked step (client-side invariant, unchanged).
 *
 * No live generation: every row is pre-authored and reviewed (thesis Phase B).
 */
let client: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return client;
}

const STATE_VARIANT_PREFERENCE: Record<string, string[]> = {
  confused: ['analogy', 'remedial', 'visual'],
  frustrated: ['remedial', 'analogy', 'visual'],
  bored: ['visual', 'analogy'],
  neutral: ['visual', 'analogy', 'remedial'],
};

export async function GET(request: NextRequest) {
  try {
    const section = Number(new URL(request.url).searchParams.get('section'));
    const state = (new URL(request.url).searchParams.get('state') ?? 'confused').toLowerCase();

    if (!Number.isInteger(section) || section < 0 || section > 5) {
      return NextResponse.json({ error: 'section must be 0-5' }, { status: 400 });
    }
    const preferences = STATE_VARIANT_PREFERENCE[state] ?? STATE_VARIANT_PREFERENCE.confused;

    const { data, error } = await getSupabase()
      .from('slide_templates')
      .select('*')
      .eq('section', section)
      .in('variant', preferences)
      .order('sort_order', { ascending: true });

    if (error) throw new Error(error.message);

    // pick the highest-preference variant that exists
    let chosen = null;
    for (const v of preferences) {
      chosen = (data ?? []).find((row: any) => row.variant === v);
      if (chosen) break;
    }

    return NextResponse.json({ ok: true, variant: chosen ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('tutor/variant error:', message);
    return NextResponse.json({ ok: false, error: message, variant: null }, { status: 500 });
  }
}
