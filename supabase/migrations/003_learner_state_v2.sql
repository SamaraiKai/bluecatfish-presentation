-- ====================================================================
-- Blue Catfish — learner_state v2
-- Run after 001. Safe to rerun.
--
-- What changes:
--   * learner_state gets the signals the adaptive loop actually uses:
--     skips, jumps, simplify requests, questions, barge-ins, visits,
--     self-check rating and quiz pass/fail
--   * a `seq` column: the browser sends its whole running row each time
--     with an increasing seq, and put_learner_state only applies a write
--     that is newer than what's stored. No read-modify-write, so two
--     requests in flight can no longer lose an increment or arrive out of
--     order and roll the row back.
--   * 'deck_command' event type for the skip / next topic / go to commands
-- ====================================================================

alter table public.learner_state
  add column if not exists visits            int not null default 0,
  add column if not exists simplify_requests int not null default 0,
  add column if not exists skips             int not null default 0,
  add column if not exists jumps             int not null default 0,
  add column if not exists questions         int not null default 0,
  add column if not exists barge_ins         int not null default 0,
  add column if not exists quiz_passed       boolean,
  add column if not exists self_check        text check (self_check in ('got','kind','lost')),
  add column if not exists seq               bigint not null default 0,
  add column if not exists created_at        timestamptz not null default now();

create index if not exists learner_state_updated_idx on public.learner_state (updated_at);

-- Allow the new event type (001 created this as an unnamed column check)
alter table public.events drop constraint if exists events_event_type_check;
alter table public.events add constraint events_event_type_check check (event_type in
  ('section_start', 'step_start', 'step_complete',
   'confusion_click', 'repeat_request', 'simplify_request', 'advance_request',
   'quiz_submitted', 'quiz_wrong', 'quiz_passed',
   'tutor_question', 'tutor_decision', 'barge_in', 'hand_raise',
   'presence_away', 'presence_back',
   'dwell', 'lesson_complete', 'self_check', 'deck_command'));

-- Ordered snapshot write. Returns true when the row was written, false when
-- a newer snapshot was already stored.
create or replace function public.put_learner_state(
  p_session_id        text,
  p_section           int,
  p_seq               bigint,
  p_visits            int,
  p_repeats           int,
  p_simplify_requests int,
  p_confusion_marks   int,
  p_skips             int,
  p_jumps             int,
  p_questions         int,
  p_barge_ins         int,
  p_quiz_misses       int,
  p_quiz_passed       boolean,
  p_self_check        text,
  p_dwell_ms_total    bigint,
  p_last_state        text
) returns boolean language plpgsql as $$
declare
  written int;
begin
  insert into public.learner_state as ls (
    session_id, section, seq, visits, repeats, simplify_requests, confusion_marks,
    skips, jumps, questions, barge_ins, quiz_misses, quiz_passed, self_check,
    dwell_ms_total, last_state, updated_at
  ) values (
    p_session_id, p_section, p_seq, p_visits, p_repeats, p_simplify_requests, p_confusion_marks,
    p_skips, p_jumps, p_questions, p_barge_ins, p_quiz_misses, p_quiz_passed, p_self_check,
    p_dwell_ms_total, p_last_state, now()
  )
  on conflict (session_id, section) do update set
    seq               = excluded.seq,
    visits            = excluded.visits,
    repeats           = excluded.repeats,
    simplify_requests = excluded.simplify_requests,
    confusion_marks   = excluded.confusion_marks,
    skips             = excluded.skips,
    jumps             = excluded.jumps,
    questions         = excluded.questions,
    barge_ins         = excluded.barge_ins,
    quiz_misses       = excluded.quiz_misses,
    quiz_passed       = excluded.quiz_passed,
    self_check        = excluded.self_check,
    dwell_ms_total    = excluded.dwell_ms_total,
    last_state        = excluded.last_state,
    updated_at        = now()
  where ls.seq < excluded.seq;

  get diagnostics written = row_count;
  return written > 0;
end;
$$;

-- Service role only, like the table itself
revoke all on function public.put_learner_state(text, int, bigint, int, int, int, int, int, int, int, int, int, boolean, text, bigint, text) from public, anon, authenticated;
grant execute on function public.put_learner_state(text, int, bigint, int, int, int, int, int, int, int, int, int, boolean, text, bigint, text) to service_role;

-- Per-section view for reviewing a pilot: where do learners struggle or skip?
create or replace view public.section_difficulty as
select
  section,
  count(*)                                                    as sessions,
  round(avg(dwell_ms_total) / 1000.0, 1)                      as avg_dwell_s,
  round(avg(repeats + simplify_requests + confusion_marks), 2) as avg_help_requests,
  round(avg(skips), 2)                                        as avg_skips,
  round(avg(quiz_misses), 2)                                  as avg_quiz_misses,
  count(*) filter (where last_state = 'confused')             as confused,
  count(*) filter (where last_state = 'frustrated')           as frustrated,
  count(*) filter (where last_state = 'bored')                as bored,
  count(*) filter (where last_state = 'engaged')              as engaged
from public.learner_state
group by section
order by section;

revoke all on public.section_difficulty from anon, authenticated;
grant select on public.section_difficulty to service_role;
