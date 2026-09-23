import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Learner-state rollup upsert — service role (server-only).
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

interface Body {
  session_id?: string;
  section?: number;
  repeats?: number;
  quiz_misses?: number;
  confusion_marks?: number;
  dwell_ms_total?: number;
  last_state?: 'neutral' | 'confused' | 'frustrated' | 'bored' | 'engaged';
  absolute?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    if (!body.session_id || typeof body.section !== 'number') {
      return NextResponse.json({ error: 'session_id and section required' }, { status: 400 });
    }
    const supabase = getSupabase();

    interface StateRow {
      repeats: number; quiz_misses: number; confusion_marks: number;
      dwell_ms_total: number; last_state: string;
    }
    const { data } = await supabase
      .from('learner_state')
      .select('*')
      .eq('session_id', body.session_id)
      .eq('section', body.section)
      .maybeSingle();
    const existing = (data ?? null) as StateRow | null;

    const delta = (v: number | undefined, current: number, isAbs: boolean) =>
      isAbs ? (v ?? current ?? 0) : (current ?? 0) + (v ?? 0);

    const row = {
      session_id: body.session_id,
      section: body.section,
      repeats: delta(body.repeats, existing?.repeats ?? 0, body.repeats !== undefined && body.absolute === true),
      quiz_misses: delta(body.quiz_misses, existing?.quiz_misses ?? 0, body.absolute === true),
      confusion_marks: delta(body.confusion_marks, existing?.confusion_marks ?? 0, body.absolute === true),
      dwell_ms_total: delta(body.dwell_ms_total, Number(existing?.dwell_ms_total ?? 0), false),
      last_state: body.last_state ?? existing?.last_state ?? 'neutral',
      updated_at: new Date().toISOString(),
    };

    const { error } = await (supabase as any)
      .from('learner_state')
      .upsert(row, { onConflict: 'session_id,section' });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('signals/state error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
