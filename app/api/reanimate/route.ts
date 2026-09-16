import { NextResponse } from "next/server";
import { getValue } from "@/src/redisClient";
import { SECTIONS_CACHE_KEY } from "@/src/cacheVersion";

export async function POST() {
  console.log('render url:', process.env.MANIM_RENDER_URL);
  const cacheKey = SECTIONS_CACHE_KEY
  const cachedRaw = await getValue(cacheKey);
  if (!cachedRaw) return NextResponse.json({ error: "no cached sections" }, { status: 404 });

  const sections = JSON.parse(cachedRaw);

  const sections = JSON.parse(cachedRaw);

  const rawUrl = process.env.MANIM_RENDER_URL || '';
  const renderUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;

  fetch(`${renderUrl}/animate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: process.env.MANIM_RENDER_TOKEN,
      cache_key: cacheKey,
      sections,
    }),
  }).catch((e) => console.warn("reanimate failed to start:", e));

  return NextResponse.json({ started: true, cacheKey, sectionCount: sections.length });
}
