import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deriveMood, EMPTY_COUNTERS, type SectionCounters } from '@/lib/learnerState';

// Learner-state rollup write — service role (server-only).
// The browser owns its session's counters and sends the whole row with an
// increasing `seq`; put_learner_state (migration 003) ignores stale writes.
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

const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

function readCounters(body: Record<string, unknown>): SectionCounters {
  const c = { ...EMPTY_COUNTERS };
  for (const key of Object.keys(EMPTY_COUNTERS) as (keyof SectionCounters)[]) {
    if (key === 'quiz_passed') c.quiz_passed = typeof body.quiz_passed === 'boolean' ? body.quiz_passed : null;
    else if (key === 'self_check') c.self_check = ['got', 'kind', 'lost'].includes(body.self_check as string) ? (body.self_check as SectionCounters['self_check']) : null;
    else (c[key] as number) = int(body[key]);
  }
  return c;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const sessionId = body.session_id;
    const section = body.section;
    if (typeof sessionId !== 'string' || !sessionId || typeof section !== 'number' || !Number.isInteger(section) || section < 0 || section > 9) {
      return NextResponse.json({ error: 'session_id and section (0-9) required' }, { status: 400 });
    }

    const c = readCounters(body);
    // Derived on the server too, so a stale or tampered client can't store a mood that doesn't match its counters
    const lastState = deriveMood(c);
    const supabase = getSupabase() as any;

    const { data: written, error } = await supabase.rpc('put_learner_state', {
      p_session_id: sessionId,
      p_section: section,
      p_seq: int(body.seq),
      p_visits: c.visits,
      p_repeats: c.repeats,
      p_simplify_requests: c.simplify_requests,
      p_confusion_marks: c.confusion_marks,
      p_skips: c.skips,
      p_jumps: c.jumps,
      p_questions: c.questions,
      p_barge_ins: c.barge_ins,
      p_quiz_misses: c.quiz_misses,
      p_quiz_passed: c.quiz_passed,
      p_self_check: c.self_check,
      p_dwell_ms_total: c.dwell_ms_total,
      p_last_state: lastState,
    });

    if (error) {
      // Migration 003 not applied yet: keep writing the original columns
      if (/put_learner_state|function|schema cache/i.test(error.message)) {
        const { error: legacyError } = await supabase.from('learner_state').upsert({
          session_id: sessionId,
          section,
          repeats: c.repeats + c.simplify_requests,
          quiz_misses: c.quiz_misses,
          confusion_marks: c.confusion_marks,
          dwell_ms_total: c.dwell_ms_total,
          last_state: lastState,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'session_id,section' });
        if (legacyError) throw new Error(legacyError.message);
        return NextResponse.json({ ok: true, last_state: lastState, legacy: true });
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true, last_state: lastState, written: written !== false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('signals/state error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
