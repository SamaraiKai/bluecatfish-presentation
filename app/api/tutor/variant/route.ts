import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Variant slide lookup — returns the best reviewed variant for a section + learner state.
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
  bored: ['visual', 'deep-dive', 'analogy'],
  engaged: ['deep-dive', 'visual'],
  neutral: ['visual', 'analogy', 'remedial'],
};

export async function GET(request: NextRequest) {
  try {
    const params = new URL(request.url).searchParams;
    const section = Number(params.get('section'));
    const state = (params.get('state') ?? 'confused').toLowerCase();

    // was `section > 5` — the planner can make up to 7 sections
    if (!Number.isInteger(section) || section < 0 || section > 9) {
      return NextResponse.json({ error: 'section must be 0-9' }, { status: 400 });
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
