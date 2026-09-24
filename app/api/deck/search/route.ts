import { NextRequest, NextResponse } from 'next/server';

// Semantic fallback for "go to <part>" when the client's keyword search isn't
// sure. Embeds the query plus every slide in one call and returns the closest
// slide, or found:false when nothing in the lesson is close enough.
// Slide vectors are cached per warm instance, so repeat lookups only embed the query.

export const runtime = 'nodejs';

// text-embedding-3-small cosine similarity. On-topic query/slide pairs land
// around 0.35-0.6; unrelated asks within the same subject sit near 0.2-0.3.
const MIN_SIMILARITY = 0.36;

const cache = new Map<string, number[]>();

interface Doc { section: number; step: number; title: string; text: string }

async function embedMany(inputs: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: inputs }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Embedding failed (${res.status})`);
  const data = await res.json();
  return (data.data as { index: number; embedding: number[] }[])
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = String(body.query ?? '').trim().slice(0, 200);
    const docs = (Array.isArray(body.docs) ? body.docs : []).slice(0, 80) as Doc[];
    if (!query || docs.length === 0) {
      return NextResponse.json({ error: 'query and docs required' }, { status: 400 });
    }

    const texts = docs.map((d) => `${d.title}. ${d.text}`.slice(0, 2000));
    if (cache.size > 1000) cache.clear();   // new lesson version; drop old slides
    const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
    const vectors = await embedMany([query, ...missing]);
    missing.forEach((t, i) => cache.set(t, vectors[i + 1]));
    const q = vectors[0];

    let best = { i: -1, score: -1 };
    texts.forEach((t, i) => {
      const score = cosine(q, cache.get(t)!);
      if (score > best.score) best = { i, score };
    });

    const hit = docs[best.i];
    if (!hit || best.score < MIN_SIMILARITY) {
      return NextResponse.json({ found: false, score: best.score });
    }
    return NextResponse.json({
      found: true,
      section: hit.section,
      step: Math.max(0, hit.step),
      score: best.score,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('deck/search error:', message);
    return NextResponse.json({ found: false, error: message }, { status: 500 });
  }
}
