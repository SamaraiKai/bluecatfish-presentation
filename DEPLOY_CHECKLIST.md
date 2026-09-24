# Vercel Deployment Checklist — blue-catfish.org

**Status:** `main` (commit `1178302`) is verified-ready — animations embedded, adaptive voice mode in,
build green (18/18 pages). The only missing link is Vercel's Git integration.

## What's on main now

| Feature | Where |
|---|---|
| 6 Manim topic animations in the slide image stage | PR #4 (merged) |
| Voice interruption during the lesson (🎙 Interrupt toggle) | PR #5 (merged) |
| Tutor decision pipeline (repeat / simplify / advance, quiz-gated) | PR #5 (merged) |
| Learner-state enrichment (repeat counts + quiz misses) | PR #5 (merged) |
| Prompt chips | REMOVED per review — voice is the only interrupt path |

## For the co-developer: getting it live

### 1. Re-link Vercel ↔ GitHub (the current blocker)

Both PRs and all pushes since ~Sep 9 show **zero deployments** — Vercel's Git integration
is not picking up this repo.

1. Log into **vercel.com** → open the project that serves blue-catfish.org
2. **Settings → Git** → confirm "Connected Git Repository" is `berylm1/bluecatfish-presentation`
   (branch: `main`)
3. If missing/broken: **Disconnect**, then **Connect GitHub Repo** → select `berylm1/bluecatfish-presentation`
4. Verify **Settings → Domains**: blue-catfish.org assigned to this project's production builds
5. Trigger a deployment: **Deployments tab → latest → Redeploy** (or just push any commit)

### 2. Environment variables (Settings → Environment Variables)

Production needs these set (they exist in Vercel if the site is currently serving):

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side; slidesv2, audio, ingest)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (middleware auth)
- `OPENAI_API_KEY` (embeddings until Phase 4)
- `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN` (tutor LLM → Minisforum bridge)
- `REDIS_URL` (slides cache; optional — cache degrades gracefully if unreachable)

### 3. Post-deploy verification checklist

- [ ] `/presentationv2` loads the six sections
- [ ] Section images play the Manim animations (video, looping)
- [ ] Start lesson → narration auto-advances through steps
- [ ] Header shows the 🎙 Interrupt toggle — enable it
- [ ] Speak over the narration → it stops, mic opens, question transcribed
- [ ] Tutor answers, deck resumes at the interrupted step
- [ ] Saying "explain that again" replays; "simpler please" jumps to the simple variant
- [ ] Quiz still gates section progress (say "skip ahead" during a quiz → no bypass)

### 4. Known items (not blockers)

- 19 TypeScript errors exist on baseline (pre-existing; build still passes — Next skips type-check
  errors at build with this config, verified repeatedly)
- `/textIngest` and `/imageIngest` are public — lock behind auth before any real pilot
- Redis: if not configured in prod, the deck regenerates per request (slower first load; still works)

## Local dev for the co-developer

```bash
git clone https://github.com/berylm1/bluecatfish-presentation
cd bluecatfish-presentation
cp .env.example .env.local   # fill real values (ask repo owner)
npm install
npm run dev                  # http://localhost:3000/presentationv2
```

Voice interruption needs the OpenClaw bluecatfish agent locally (see INTEGRATION.md)
or `OPENCLAW_GATEWAY_URL` pointed at the homelab bridge.