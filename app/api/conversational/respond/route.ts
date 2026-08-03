import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY is not set.' }, { status: 500 });
    }

    // Build a professor-style system prompt if none provided from utils.ts
    const effectiveSystemPrompt = systemPrompt ||
      `You are "Professor Marine", a university professor specializing in Marine Biology and Conservation, teaching a 12-16 year old student about "${topic || 'this topic'}" in a live one-on-one voice session. ` +
      `You are a warm, expert professor teaching a 12-16 year old student about "${topic || 'this topic'}" in a live one-on-one voice session. ` +
      `You LEAD the lesson — you don't wait for questions, you teach proactively. ` +
      `Present one concept, give a real example, then ask the student ONE focused question to check understanding. ` +
      `When the student responds, acknowledge their answer specifically and build the next concept on top of it. ` +
      `Use the Socratic method. Speak in 2-3 natural sentences only — no formatting, no bullets, pure spoken language. ` +
      `If student goes off-topic, redirect warmly: "Let's come back to ${topic || 'our topic'} — right where we left off..."` +
      `Style: ${style || 'warm, authoritative, and genuinely enthusiastic about the subject'}.`;

    const queryEmbedding = await getEmbedding(userText);

    const { data: docs, error } = await supabase.rpc('match_documents2', {
        query_embedding: queryEmbedding,
        match_count: 4,
      }
    );
    if (error) {
      console.error('Supabase RPC error:', error);
    }
    
    const context = docs 
      ? docs.map((doc) => doc.content).join('\n\n')
      : '';
    
    const messages = [
      {
        role: 'system',
        content: effectiveSystemPrompt + ` 

      You MUST follow the knowledge base below.
      If the knowledge base contains an answer, you MUST use it exactly and do not modify it.
      Do NOT rephrase.
      If multiple answers exist, choose the most relevant one.
    ${context}
    `,
      },
      // Keep last 10 turns max to avoid context bloat
      ...conversation.slice(-10).map((message) => ({
        role: message.role,
        content: message.content,
      })),
      {
        role: 'user',
        content: userText,
      },
    ];

    
    if (error) {
      console.error(error);
    }
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: 160,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: 'OpenAI request failed.', details: errorText },
        { status: response.status }
      );
    }

    // Non-streaming path — unchanged, so existing callers keep working
    if (!stream) {
      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content?.trim();

      if (!reply) {
        return NextResponse.json({ error: 'OpenAI returned an empty reply.' }, { status: 500 });
      }

    return NextResponse.json({ reply });
  }

  // Streaming path — unwrap OpenAI's SSE format into plain text chunks
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const readable = new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;

            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') {
              controller.close();
              return;
            }

            try {
              const json = JSON.parse(payload);
              const token = json.choices?.[0]?.delta?.content;
              console.log("token:", JSON.stringify(token));
              if (token) controller.enqueue(encoder.encode(token));
            } catch {
              // partial JSON across chunk boundary — skip it
              console.log("parse failed on:", payload.slice(0, 120));
            }
          }
        }
        controller.close();
      } catch (e) {
        console.error('Stream error:', e);
        controller.error(e);
      }
    },
  });
    
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Error generating conversational reply:', error);
    return NextResponse.json({ error: 'Failed to generate response.' }, { status: 500 });
  }
}
