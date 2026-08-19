import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';

// Lazy Supabase client so the module loads even before env is configured.
// Without this, createClient(undefined, undefined) throws at import time and
// every request to this route (and the middleware) 500s.
let supabaseClient: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase env is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  supabaseClient = createClient(url, key);
  return supabaseClient;
}

type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(
    'https://api.openai.com/v1/embeddings',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    }
  );

  const data = await response.json();
  return data.data[0].embedding;
}

// Resolve the Professor Marine reply. In production (Vercel) set
// OPENCLAW_GATEWAY_URL to the homelab OpenClaw HTTP bridge (exposed from the
// Minisforum via cloudflared). In local dev, leave it unset and the route
// spawns the local openclaw CLI on the Mac. The agent's skill supplies the
// persona and pedagogy; we pass the retrieved factsheet context and conversation
// so the reply is grounded in the Supabase knowledge base. This makes the LLM
// self-hosted (model on the DGX Spark) while keeping the Supabase pgvector RAG.
// See Baradziej and Pal (2026), Section 4.
async function runOpenClawBluecatfish(message: string): Promise<string> {
  if (process.env.OPENCLAW_GATEWAY_URL) {
    return callOpenClawGatewayHttp(message);
  }
  return runOpenClawLocal(message);
}

// Production path: HTTP to the Minisforum OpenClaw bridge. Contract:
// POST { message, agent, thinking } -> { reply } | openclaw --json shape.
async function callOpenClawGatewayHttp(message: string): Promise<string> {
  const url = process.env.OPENCLAW_GATEWAY_URL as string;
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, agent: 'bluecatfish', thinking: 'off' }),
  });
  if (!res.ok) {
    throw new Error(`OpenClaw gateway HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    reply?: string;
    result?: { payloads?: { text?: string }[] };
  };
  if (data.reply && data.reply.trim()) return data.reply.trim();
  if (data.result?.payloads) {
    const text = data.result.payloads
      .map((p) => p.text ?? '')
      .filter(Boolean)
      .join('\n')
      .trim();
    if (text) return text;
  }
  throw new Error('OpenClaw gateway returned no reply payload');
}

// Local dev path: spawn the openclaw CLI on the Mac.
async function runOpenClawLocal(message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('/opt/homebrew/bin/openclaw', [
      'agent',
      '--agent', 'bluecatfish',
      '--thinking', 'off',
      '--json',
      '-m', message,
    ], { env: process.env });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('error', (err: Error) => reject(new Error(`Failed to spawn openclaw: ${err.message}`)));
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('OpenClaw agent timed out after 55s'));
    }, 55000);
    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`openclaw exited ${code}. stderr: ${stderr.slice(0, 400)}`));
      }
      try {
        const json = JSON.parse(stdout) as {
          status?: string;
          result?: { payloads?: { text?: string }[] };
        };
        const text = (json.result?.payloads ?? [])
          .map((p) => p.text ?? '')
          .filter(Boolean)
          .join('\n')
          .trim();
        if (!text) {
          return reject(new Error('OpenClaw agent returned no text payload'));
        }
        resolve(text);
      } catch (e) {
        reject(new Error(`Failed to parse openclaw JSON: ${(e as Error).message}. stdout head: ${stdout.slice(0, 300)}`));
      }
    });
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const systemPrompt = body.systemPrompt as string | undefined;
    const conversation = (body.conversation as ConversationMessage[] | undefined) ?? [];
    const userText = (body.userText as string | undefined)?.trim();
    const topic = body.topic as string | undefined;
    const style = body.style as string | undefined;
    const stream = body.stream === true;

    if (!userText) {
      return NextResponse.json({ error: 'Missing user text.' }, { status: 400 });
    }

    // OpenAI key is still needed for embeddings (text-embedding-3-small) until
    // the embeddings move to a local model (bge-m3) in a later phase.
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is not set (needed for embeddings until Phase 4).' },
        { status: 500 }
      );
    }

    // Build a professor-style system prompt if none provided from utils.ts
    const effectiveSystemPrompt = systemPrompt ||
      `You are "Professor Marine", a university professor specializing in Marine Biology and Conservation, teaching a 12-16 year old student about "${topic || 'this topic'}" in a live one-on-one voice session. ` +
      `You LEAD the lesson. You do not wait for questions; you teach proactively. ` +
      `Present one concept, give a real example, then ask the student ONE focused question to check understanding. ` +
      `When the student responds, acknowledge their answer specifically and build the next concept on top of it. ` +
      `Use the Socratic method. Speak in 2-3 natural sentences only, with no formatting, no bullets, pure spoken language. ` +
      `If student goes off-topic, redirect warmly: "Let's come back to ${topic || 'our topic'}, right where we left off..."` +
      `Style: ${style || 'warm, authoritative, and genuinely enthusiastic about the subject'}.`;

    // RAG: embed the student's text and retrieve the top factsheet chunks from Supabase pgvector.
    const queryEmbedding = await getEmbedding(userText);

    const { data: docs, error } = await getSupabase().rpc('match_documents3', {
        query_embedding: queryEmbedding,
        match_count: 4,
      }
    );

    if (error) {
      console.error('Supabase RPC error:', error);
    }

    const context = docs
      ? docs.map((doc: any) => doc.content).join('\n\n')
      : '';

    const conversationLines = conversation
      .slice(-10)
      .map((m) => `${m.role === 'user' ? 'Student' : 'Professor'}: ${m.content}`)
      .join('\n');

    const prompt =
      `${effectiveSystemPrompt}\n\n` +
      `Relevant facts retrieved from the knowledge base (ground your answer in these; do not contradict them):\n${context || '(none retrieved)'}\n\n` +
      (conversationLines ? `Conversation so far:\n${conversationLines}\n\n` : '') +
      `Student now says: ${userText}\n\n` +
      `Respond as Professor Marine, in 2-3 natural spoken sentences, no formatting.`;

    const reply = await runOpenClawBluecatfish(prompt);

    // Non-streaming callers (e.g. the TTS voice loop) get JSON.
    if (!stream) {
      return NextResponse.json({ reply });
    }

    // Streaming callers get the full reply as a single text chunk so the
    // existing SSE-expecting client keeps working without OpenAI streaming.
    return new Response(reply, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error generating conversational reply:', message);
    return NextResponse.json({ error: 'Failed to generate response.', detail: message }, { status: 500 });
  }
}
