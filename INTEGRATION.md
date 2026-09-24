# OpenClaw Integration

This presentation is wired to a locally-running [OpenClaw](https://docs.openclaw.ai) gateway so Professor Marine is a real adaptive tutor with persistent memory, not a stateless chatbot.

This implements the adaptive-tutoring module from Baradziej, S. and Pal, R. (2026), "Exploring OpenClaw's potential for adaptive, self-hosted educational AI," *Frontiers in Education* 11:1859178, doi:10.3389/feduc.2026.1859178.

## Architecture

```
Browser (app/presentation/page.tsx)
        |  POST /api/chat { message, sessionId }
        v
Next.js API route (app/api/chat/route.ts)
        |  spawns: openclaw agent --agent bluecatfish --session-id <sessionId> --json
        v
OpenClaw gateway (127.0.0.1:18789)
        |  routes to model
        v
Local model on the DGX Spark (deepseek-v4-flash) over Tailscale
```

The `bluecatfish` skill (`openclaw/bluecatfish/SKILL.md`) is the curriculum engine: it holds the Professor Marine persona, the five lecture topics with their facts, and the pedagogical strategy (Socratic for conceptual questions, four-level breakdowns for confused learners). OpenClaw's persistent memory gives the longitudinal learner model: each browser tab gets its own `sessionId` so the tutor remembers that student's confusion across turns.

## Requirements

- OpenClaw installed and its gateway running on `127.0.0.1:18789`. The `openclaw` binary must be at `/opt/homebrew/bin/openclaw` (or change `OPENCLAW_BIN` in `app/api/chat/route.ts`).
- A `bluecatfish` agent registered in OpenClaw with the `bluecatfish` skill installed and a working model provider.
- Node.js 18+ and `npm install` done in this repo.

## One-time OpenClaw setup (already done on this Mac)

```bash
# Create the agent
openclaw agents add bluecatfish \
  --workspace ~/.openclaw/workspaces/bluecatfish \
  --model spark-v4flash/deepseek-v4-flash --non-interactive

# Install the skill from this repo
openclaw skills install ./openclaw/bluecatfish --agent bluecatfish --as bluecatfish --force

# Smoke test
openclaw agent --agent bluecatfish -m "What do blue catfish eat?" --thinking off
```

## Run

```bash
npm run dev
# open http://localhost:3000/presentation
```

Open the AI chat on a slide and ask Professor Marine a question. Say "I'm confused" to get the multi-level explanation.

## Phases

- **Phase 1 (this commit):** chat routed through OpenClaw; persona and content in the skill; per-student memory via sessionId.
- **Phase 2 (next):** persist the "I'm Confused" button state into OpenClaw memory as structured learner entries, and generate the per-slide breakdowns adaptively instead of from pre-written text.
- **Phase 3 (thesis contribution):** add the IRT skill (py-irt / mirt-Python / EduCDM) for psychometric difficulty adjustment, as specified in Section 4.1 of the paper.
- **Phase 4:** self-hosted Whisper ASR + Coqui/Piper TTS for the accessibility module and data sovereignty.
- **Phase 5:** adapt the paper's CONSORT pilot to a blue catfish education context for thesis validation.
