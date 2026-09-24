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

const STOP = new Set(['the', 'a', 'an', 'are', 'is', 'they', 'them', 'why', 'what', 'how', 'do', 'does', 'of', 'to', 'and', 'in', 'on', 'blue', 'catfish', 'fish']);
const words = (t: string) =>
  new Set((t.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 6)));

// "Why Are They Invasive?" vs "Why They're Invasive": share at least one real word
function sameTopic(concept: string, title: string): boolean {
  const a = words(concept ?? '');
  for (const w of words(title)) if (a.has(w)) return true;
  return false;
}

export async function GET(request: NextRequest) {
  try {
    const params = new URL(request.url).searchParams;
    const section = Number(params.get('section'));
    const state = (params.get('state') ?? 'confused').toLowerCase();
    const title = params.get('title') ?? '';

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

    // Section numbers come from the AI planner and can shift when the lesson is
    // regenerated, so a variant must also be about this section's topic.
    const rows = (data ?? []).filter((row: any) => !title || sameTopic(row.concept, title));

    // pick the highest-preference variant that exists
    let chosen = null;
    for (const v of preferences) {
      chosen = rows.find((row: any) => row.variant === v);
      if (chosen) break;
    }

    return NextResponse.json({ ok: true, variant: chosen ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('tutor/variant error:', message);
    return NextResponse.json({ ok: false, error: message, variant: null }, { status: 500 });
  }
}
