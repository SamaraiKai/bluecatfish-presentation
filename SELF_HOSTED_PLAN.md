# Self-Hosted Stack Plan

Goal: take the Blue Catfish voice tutor fully self-hosted, per Baradziej and Pal (2026), "Exploring OpenClaw's potential for adaptive, self-hosted educational AI" (Frontiers in Education 11:1859178). The paper's thesis is that an educational AI that runs inside the institution's network keeps student data under institutional control (FERPA, GDPR) and lets instructors make pedagogical decisions a vendor would not allow.

## Current state after the LLM swap

The voice loop is: camera presence (`useFacePresence`) and hand-raise (`useHandRaise`) on the `presentationv2` page, voice input (`useVoiceInput`) posts audio to `/api/transcribe`, the transcript goes to `/api/conversational/respond`, and the reply goes to `/api/tts` for playback.

The `respond` route does RAG: it embeds the student text, retrieves the top factsheet chunks from Supabase pgvector (`match_documents3`), then calls the LLM.

| Service | Before | After Phase 1 (now) | Final self-hosted |
|---|---|---|---|
| Tutor LLM (reasoning) | OpenAI gpt-4o-mini | Local OpenClaw `bluecatfish` agent on the DGX Spark (deepseek-v4-flash) | same (done) |
| Embeddings (RAG query + corpus) | OpenAI text-embedding-3-small | OpenAI text-embedding-3-small | Local bge-m3 on the Minisforum SIE |
| Speech-to-text | OpenAI whisper-1 | OpenAI whisper-1 | Local Whisper (OpenClaw `openai-whisper` skill) |
| Text-to-speech | OpenAI audio/speech | OpenAI audio/speech | Local Coqui or Piper |
| Vector store | Supabase pgvector | Supabase pgvector | Supabase pgvector (stays) |

## Vercel deployment shape (decided)

The app is hosted on Vercel. Vercel is a cloud platform, so the app server itself is not self-hosted. The self-hosting applies to the AI services, which run on the homelab (Minisforum plus DGX Spark) and are reached from Vercel over authenticated tunnels. The LLM call is env-gated so one codebase serves both environments:

- **Local dev (Mac):** `OPENCLAW_GATEWAY_URL` unset. The `respond` route spawns the local `openclaw agent --agent bluecatfish` CLI. Works because openclaw and the bluecatfish agent live on the Mac.
- **Vercel production:** `OPENCLAW_GATEWAY_URL` set to a tiny HTTP bridge on the Minisforum that wraps `openclaw agent` locally and returns `{ reply }`. Exposed via cloudflared (same pattern as `llama.newfire.app` and `claw.newfire.app`), with `OPENCLAW_GATEWAY_TOKEN` for server-to-server auth. Vercel cannot spawn the CLI or speak the OpenClaw WebSocket RPC, so the HTTP bridge is required.

This means the OpenClaw agent framework and the `bluecatfish` agent must also be installed on the Minisforum (always-on), not only on the Mac. The Mac setup stays for local development.

The LLM swap is done: `app/api/conversational/respond/route.ts` keeps the Supabase pgvector retrieval and the Professor Marine prompt, but calls the local OpenClaw `bluecatfish` agent instead of OpenAI. The agent's skill (`openclaw/bluecatfish/SKILL.md`) supplies the persona and pedagogy; the retrieved factsheet chunks are passed in as context.

## Remaining phases

### Phase 2: Local embeddings (bge-m3)

Replace OpenAI `text-embedding-3-small` with `bge-m3` served by the SIE on the Minisforum (the SIE already runs bge-m3 plus bge-reranker-v2-m3 per the homelab notes). Two parts:

1. Query embedding in `getEmbedding()`: POST to the local bge-m3 endpoint instead of OpenAI.
2. Corpus re-embedding: re-embed every factsheet chunk in Supabase with bge-m3, and update the `match_documents3` RPC to compare against the bge-m3 vector dimension (1024) instead of text-embedding-3-small (1536). The ingest flow (`/api/embed` and `app/textIngest`) must use bge-m3 too, so query and corpus vectors share the same model.

This is the step that makes the RAG itself self-hosted, not just the LLM.

### Phase 3: Local speech-to-text (Whisper)

Replace `/api/transcribe` (OpenAI whisper-1) with a local Whisper server. OpenClaw already has the `openai-whisper` skill; alternatively run a small whisper.cpp or faster-whisper endpoint on the Minisforum. The route keeps the same contract: accept an audio file, return `{ text }`.

### Phase 4: Local text-to-speech (Coqui or Piper)

Replace `/api/tts` (OpenAI audio/speech) with a local Coqui-TTS or Piper endpoint. This is the paper's accessibility module. Keep the existing Voicebox / Web Speech fallback in `presentationv2` so the page still works if the local TTS is down.

### Phase 5: Data-sovereignty hardening

Once all four services are local, no student audio, text, or embeddings leave the Mac plus Minisforum plus DGX Spark (all on Tailscale). Confirm by watching network egress during a voice session. At that point the deployment meets the FERPA-grade isolation the paper describes.

## Local service endpoints (from the homelab)

- OpenClaw gateway: `127.0.0.1:18789` on the Mac (the `bluecatfish` agent, Ghana model).
- Ghana model (LLM): `http://100.88.112.5:8000/v1` on the DGX Spark, deepseek-v4-flash.
- SIE embeddings: bge-m3 plus bge-reranker-v2-m3 on the Minisforum (confirm the host port with the homelab notes).

## Psychometric module (thesis contribution, parallel track)

Section 4.1 of the paper proposes an IRT skill: seed an item bank of LLM-generated blue catfish questions, bootstrap item parameters with AutoIRT, refine with py-irt on accumulated learner responses, and select the next item by maximizing Fisher information at the current ability estimate. This is the research-novel piece for the thesis and runs alongside the self-hosting work. It would live in OpenClaw as a `bluecatfish-irt` skill and write calibration results back to the Supabase store.
