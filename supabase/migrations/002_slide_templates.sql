-- ====================================================================
-- Blue Catfish — slide knowledge base (Phase B)
-- Pre-authored, REVIEWED variant slides per concept. The tutor's decision
-- layer swaps these in when the learner signals difficulty, then the deck
-- returns to the main sequence. Nothing here is live-generated.
-- Run in Supabase SQL editor. Idempotent.
-- ====================================================================

create table if not exists public.slide_templates (
  id            uuid primary key default gen_random_uuid(),
  concept       text not null,      -- matches a section title or key idea, e.g. 'Why Are They Invasive?'
  section       int not null,       -- 0-5 deck order for quick lookup
  variant       text not null check (variant in ('analogy','deep-dive','visual','remedial')),
  target_state  text not null default 'confused'
                check (target_state in ('confused','frustrated','bored','neutral')),
  title         text not null,
  body          text not null,      -- the slide text shown to the learner
  narration     text not null,      -- exactly what the professor says (grounded in factsheet)
  source_quote  text,               -- optional: the factsheet passage backing this variant
  audio_url     text,               -- pre-rendered narration MP3 (Supabase storage); null = TTS on the fly / silent
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  unique (section, variant, title)
);

create index if not exists slide_templates_lookup_idx
  on public.slide_templates (section, variant, target_state);

-- Read access for the anon client (pilot learners); writes are service-role only.
alter table public.slide_templates enable row level security;
drop policy if exists "anyone can read variants" on public.slide_templates;
create policy "anyone can read variants" on public.slide_templates
  for select to anon, authenticated using (true);

-- Seed: two variants for Section 2 (Why Are They Invasive?) as the pilot pair
insert into public.slide_templates (concept, section, variant, target_state, title, body, narration, source_quote, sort_order)
values
  ('Why Are They Invasive?', 1, 'analogy', 'confused',
   'Think of a garden without deer',
   'Imagine planting a prize garden where nothing eats the plants. That is the Chesapeake Bay for blue catfish: plenty of food, no natural check on their numbers.',
   'Let me put it this way. Picture a garden with no deer, no rabbits, nothing eating your plants. Everything you plant just takes over. That is the Chesapeake Bay for the blue catfish: plenty to eat, and nothing big enough to eat them back.',
   'Blue catfish are voracious, opportunistic predators with a broad prey base and few natural predators as adults.',
   0),
  ('Why Are They Invasive?', 1, 'visual', 'bored',
   'One fish. Millions of mouths.',
   'A single large blue catfish can weigh as much as a fourth-grader — and it does not stop eating. Now multiply that by one hundred million.',
   'Here is a way to picture it. One big blue catfish can weigh as much as a fourth grader, and it eats up to nine percent of its body weight every single day. Now imagine one hundred million of them. That is why they are so hard on the Bay.',
   'Adult blue catfish can exceed 100 pounds and consume a significant portion of their body weight daily.',
   1)
on conflict (section, variant, title) do nothing;
