import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

// This route proxies the presentation's AI chat to the locally-running OpenClaw
// gateway, using a dedicated "bluecatfish" agent that has the Professor Marine
// skill installed. This is the adaptive-tutoring integration described in
// Baradziej and Pal (2026), "Exploring OpenClaw's potential for adaptive,
// self-hosted educational AI" (Frontiers in Education 11:1859178).

export const runtime = 'nodejs';
export const maxDuration = 60;

// Absolute path so the route works even if the dev server's PATH lacks homebrew.
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw';
// Production (Vercel can't spawn the CLI): an HTTP bridge that wraps `openclaw agent`.
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const AGENT_ID = 'bluecatfish';
const DEFAULT_SESSION = 'bluecatfish-web';

interface AgentJsonResult {
  status?: string;
  summary?: string;
  result?: {
    payloads?: { text: string; mediaUrl?: string | null }[];
  };
}

function payloadText(json: AgentJsonResult): string {
  const payloads = json.result?.payloads ?? [];
  return payloads.map((p) => p.text).filter(Boolean).join('\n').trim();
}

// Same contract as the CLI, over HTTP: POST { message, agent, thinking, sessionId },
// answer is { reply } or the `openclaw --json` shape.
async function runViaGateway(message: string, sessionId: string): Promise<string> {
  const url = GATEWAY_URL!.startsWith('http') ? GATEWAY_URL! : `https://${GATEWAY_URL}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(GATEWAY_TOKEN ? { Authorization: `Bearer ${GATEWAY_TOKEN}` } : {}),
    },
    body: JSON.stringify({ message, agent: AGENT_ID, thinking: 'off', sessionId }),
    signal: AbortSignal.timeout(55000),
  });
  if (!res.ok) throw new Error(`OpenClaw gateway returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as AgentJsonResult & { reply?: string };
  if (json.status && json.status !== 'ok') throw new Error(`agent status ${json.status}`);
  const text = (json.reply ?? payloadText(json)).trim();
  if (!text) throw new Error('Gateway returned no text');
  return text;
}

async function runOpenClawAgent(message: string, sessionId: string): Promise<string> {
  if (GATEWAY_URL) return runViaGateway(message, sessionId);
  return new Promise((resolve, reject) => {
    const args = [
      'agent',
      '--agent', AGENT_ID,
      '--session-id', sessionId,
      '--thinking', 'off',
      '--json',
      '-m', message,
    ];
    const proc = spawn(OPENCLAW_BIN, args, { env: process.env });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => reject(new Error(`Failed to spawn openclaw: ${err.message}`)));
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('OpenClaw agent timed out after 60s'));
    }, 55000);
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`openclaw exited ${code}. stderr: ${stderr.slice(0, 500)}`));
      }
      try {
        const json: AgentJsonResult = JSON.parse(stdout);
        if (json.status && json.status !== 'ok') {
          return reject(new Error(`agent status ${json.status}`));
        }
        const text = payloadText(json);
        if (!text) {
          return reject(new Error('Agent returned no text payload'));
        }
        resolve(text);
      } catch (e) {
        reject(new Error(`Failed to parse agent JSON: ${(e as Error).message}. stdout head: ${stdout.slice(0, 300)}`));
      }
    });
  });
}

export async function POST(req: NextRequest) {
  let body: { message?: string; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const message = (body.message ?? '').toString().trim();
  if (!message) {
    return NextResponse.json({ ok: false, error: 'Message is required' }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ ok: false, error: 'Message too long (max 2000 chars)' }, { status: 400 });
  }

  const sessionId = (body.sessionId && body.sessionId.trim()) || DEFAULT_SESSION;

  try {
    const reply = await runOpenClawAgent(message, sessionId);
    return NextResponse.json({ ok: true, reply, sessionId });
  } catch (e) {
    const error = (e as Error).message;
    return NextResponse.json(
      { ok: false, error, fallback: "I'm having trouble reaching my lab notes right now. Please try again in a moment." },
      { status: 502 },
    );
  }
}
