'use client';

import { CACHE_VERSION } from '@/src/cacheVersion';

/**
 * Learner signal tracking — Phase A of the adaptive loop.
 * Every meaningful interaction becomes a row in Supabase `events`,
 * and the per-session/section rollup in `learner_state` is kept in step.
 * Fire-and-forget: tracking failures never break the lesson.
 */

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const EVENTS_URL = `${SUPA_URL}/rest/v1/events`;

export type EventType =
  | 'section_start' | 'step_start' | 'step_complete'
  | 'confusion_click' | 'repeat_request' | 'simplify_request' | 'advance_request'
  | 'quiz_submitted' | 'quiz_wrong' | 'quiz_passed'
  | 'tutor_question' | 'tutor_decision' | 'barge_in' | 'hand_raise'
  | 'presence_away' | 'presence_back'
  | 'dwell' | 'lesson_complete' | 'self_check';   // self_check must match the SQL list

interface QueuedEvent {
  session_id: string;
  learner_ref?: string;
  section?: number;
  step?: number;
  event_type: EventType;
  value?: Record<string, unknown>;
  dwell_ms?: number;
  created_at: string;
}

class SignalTracker {
  private sessionId: string;
  private queue: QueuedEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stepEnteredAt: Map<string, number> = new Map();

  constructor() {
    this.sessionId = this.getOrCreateSessionId();
  }

  // Fresh ID every time — no localStorage, so kiosk visitors don't share one session.
  private getOrCreateSessionId(): string {
    return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /** Start a new session — call on Start Lesson and Restart. */
  newSession(): void {
    this.flush();
    this.stepEnteredAt.clear();
    this.sessionId = this.getOrCreateSessionId();
  }

  /** Record an event. Safe to call anywhere; flushes in small batches. */
  track(
    event_type: EventType,
    opts: { section?: number; step?: number; value?: Record<string, unknown>; dwell_ms?: number } = {}
  ): void {
    if (typeof window === 'undefined' || !SUPA_URL) return;
    this.queue.push({
      session_id: this.sessionId,
      section: opts.section,
      step: opts.step,
      event_type,
      value: { v: CACHE_VERSION, ...(opts.value ?? {}) },   // tag with lesson version
      dwell_ms: opts.dwell_ms,
      created_at: new Date().toISOString(),
    });
    this.scheduleFlush();
  }

  /** Dwell bookkeeping: call on step enter. Logs step_start itself. */
  stepEnter(section: number, step: number): void {
    this.stepEnteredAt.set(`${section}:${step}`, Date.now());
    this.track('step_start', { section, step });
  }

  /** Emits a dwell event for the step we just left (if any). */
  stepExit(): void {
    const lastKey = [...this.stepEnteredAt.keys()].pop();
    if (!lastKey) return;
    const enteredAt = this.stepEnteredAt.get(lastKey) ?? 0;
    this.stepEnteredAt.delete(lastKey);
    const [section, step] = lastKey.split(':').map(Number);
    this.track('dwell', { section, step, dwell_ms: Date.now() - enteredAt });
  }

  /** Upsert the per-section rollup via the server route (best effort). */
  async upsertState(section: number, patch: {
    repeats?: number; quiz_misses?: number; confusion_marks?: number;
    dwell_ms_total?: number; last_state?: string;
  }): Promise<void> {
    try {
      await fetch('/api/signals/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: this.sessionId, section, ...patch }),
      });
    } catch { /* tracking never blocks the lesson */ }
  }

  private scheduleFlush(): void {
    if (this.queue.length >= 5) { this.flush(); return; }
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 3000);
  }

  private flush(): void {
    // reset the timer so the next event can schedule a new one
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    fetch(EVENTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(batch),
      keepalive: true,
    }).catch(() => { /* never block */ });
  }

  /** Flush pending events on page hide. */
  installUnloadFlush(): () => void {
    const onHide = () => this.flush();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }
}

export const signals = new SignalTracker();
