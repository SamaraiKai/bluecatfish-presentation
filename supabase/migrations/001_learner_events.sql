-- ====================================================================
-- Blue Catfish — learner signal events schema (Phase A)
-- Every adaptive action traces back to a row in this table.
-- Run in the Supabase SQL editor. Safe to rerun.
--
-- Fixes vs. the original draft:
--   * learner_state key is (session_id, section) — the upsert's onConflict
--     needs that pair to be unique, otherwise every rollup write fails
--   * 'self_check' added to the allowed event types
--   * section_stats: explicit ::int casts (count/sum return bigint) and
--     repeats_total counts 'repeat_request' events
-- ====================================================================

-- 1. Events table: the append-only interaction log
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  learner_ref text,
  section     int,
  step        int,
  event_type  text not null check (event_type in
    ('section_start', 'step_start', 'step_complete',
     'confusion_click', 'repeat_request', 'simplify_request', 'advance_request',
     'quiz_submitted', 'quiz_wrong', 'quiz_passed',
     'tutor_question', 'tutor_decision', 'barge_in', 'hand_raise',
     'presence_away', 'presence_back',
     'dwell', 'lesson_complete', 'self_check')),
  value       jsonb default '{}'::jsonb,
  dwell_ms    int,
  created_at  timestamptz not null default now()
);

create index if not exists events_session_idx on public.events (session_id, created_at);
create index if not exists events_section_type_idx on public.events (section, event_type);
create index if not exists events_created_idx on public.events (created_at);

-- 2. Learner-state rollup: one row per session per section
create table if not exists public.learner_state (
  session_id      text not null,
  learner_ref     text,
  section         int not null,
  repeats         int not null default 0,
  quiz_misses     int not null default 0,
  confusion_marks int not null default 0,
  dwell_ms_total  bigint not null default 0,
  last_state      text not null default 'neutral'
    check (last_state in ('neutral','confused','frustrated','bored','engaged')),
  updated_at      timestamptz not null default now(),
  primary key (session_id, section)
);

-- 3. RLS: anon can insert events, never read; learner_state is service-role only
alter table public.events enable row level security;
alter table public.learner_state enable row level security;

drop policy if exists "anon can insert events" on public.events;
create policy "anon can insert events" on public.events
  for insert to anon with check (true);

-- 4. Aggregation helper (created last, after the table it reads)
create or replace function public.section_stats(p_section int)
returns table (
  sessions int,
  avg_dwell_ms numeric,
  confusion_rate numeric,
  quiz_wrong_total int,
  repeats_total int
) language sql stable as $$
  select
    count(distinct session_id)::int                                              as sessions,
    coalesce(avg(dwell_ms), 0)                                                    as avg_dwell_ms,
    coalesce(count(*) filter (where event_type='confusion_click')::numeric
             / greatest(count(distinct session_id), 1), 0)                        as confusion_rate,
    coalesce(sum((value->>'wrong')::int) filter (where event_type='quiz_submitted'), 0)::int as quiz_wrong_total,
    count(*) filter (where event_type='repeat_request')::int                     as repeats_total
  from public.events
  where section = p_section;
$$;
