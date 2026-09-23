-- ====================================================================
-- Blue Catfish — learner signal events schema (thesis Phase A)
-- Every adaptive action traces back to a row in this table.
-- Run in Supabase SQL editor. Idempotent.
-- ====================================================================

-- 1. Events table: the append-only interaction log
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,                -- one browser session / lesson run
  learner_ref text,                          -- optional; anonymous during pilot
  section     int,                          -- 0-5
  step        int,                          -- micro-step index within section
  event_type  text not null check (event_type in
    ('section_start', 'step_start', 'step_complete',
     'confusion_click', 'repeat_request', 'simplify_request', 'advance_request',
     'quiz_submitted', 'quiz_wrong', 'quiz_passed',
     'tutor_question', 'tutor_decision', 'barge_in', 'hand_raise',
     'presence_away', 'presence_back',
     'dwell', 'lesson_complete')),
  value       jsonb default '{}'::jsonb,    -- flexible payload (see conventions)
  dwell_ms    int,                          -- for dwell events; null otherwise
  created_at  timestamptz not null default now()
);

create index if not exists events_session_idx on public.events (session_id, created_at);
create index if not exists events_section_type_idx on public.events (section, event_type);
create index if not exists events_created_idx on public.events (created_at);

-- 2. Learner-state rollup: one row per session per section (upserted)
create table if not exists public.learner_state (
  session_id      text primary key,
  learner_ref     text,
  section         int not null,
  repeats         int not null default 0,
  quiz_misses     int not null default 0,
  confusion_marks int not null default 0,
  dwell_ms_total  bigint not null default 0,
  last_state      text not null default 'neutral'
    check (last_state in ('neutral','confused','frustrated','bored','engaged')),
  updated_at      timestamptz not null default now()
);

-- 3. RLS: service role writes (server routes); anon can insert, never read
alter table public.events enable row level security;
alter table public.learner_state enable row level security;

-- anon may POST events from the client (least privilege: insert-only, no reads)
drop policy if exists "anon can insert events" on public.events;
create policy "anon can insert events" on public.events
  for insert to anon with check (true);

-- reads/writes of rollups go through the service role (server routes) only.
-- no policy on learner_state = anon sees/writes nothing.

-- 4. Aggregation helper: dashboard reads (service-role only caller)
create or replace function public.section_stats(p_section int)
returns table (
  sessions int,
  avg_dwell_ms numeric,
  confusion_rate numeric,
  quiz_wrong_total int,
  repeats_total int
) language sql stable as $$
  select
    count(distinct session_id)                                                    as sessions,
    coalesce(avg(dwell_ms), 0)                                                    as avg_dwell_ms,
    coalesce(count(*) filter (where event_type='confusion_click')::numeric
             / greatest(count(distinct session_id), 1), 0)                        as confusion_rate,
    coalesce(sum((value->>'wrong')::int) filter (where event_type='quiz_submitted'), 0) as quiz_wrong_total,
    coalesce(sum((value->>'count')::int) filter (where event_type='repeat'), 0)   as repeats_total
  from public.events
  where section = p_section;
$$;
