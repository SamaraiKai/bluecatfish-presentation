import { NextResponse } from "next/server";
import { getValue } from "@/src/redisClient";

export async function POST() {
  const cacheKey = `bluecatfish_sections_ai_vAfterPilotv5`; // match your current key
  const cachedRaw = await getValue(cacheKey);
  if (!cachedRaw) return NextResponse.json({ error: "no cached sections" }, { status: 404 });

  const sections = JSON.parse(cachedRaw);

  fetch(`${process.env.MANIM_RENDER_URL}/animate`, {
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
