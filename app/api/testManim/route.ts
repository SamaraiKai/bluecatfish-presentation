import { NextResponse } from "next/server";

const MANIM_SYSTEM_PROMPT = `You write Manim Community Edition code for short educational animations.

STRICT CONSTRAINTS — code that violates these will fail:
- The scene class MUST be named exactly "GeneratedScene" and extend Scene.
- Start the file with: from manim import *
- Use ONLY these objects: Text, Circle, Square, Rectangle, Dot, Line, Arrow, VGroup, NumberLine, Axes
- Use ONLY these animations: Write, FadeIn, FadeOut, Create, Transform, ReplacementTransform, GrowArrow, Indicate
- NEVER use MathTex, Tex, or anything requiring LaTeX — LaTeX is not installed.
- NEVER use SVGMobject, ImageMobject, or any external asset.
- Keep the total animation under 15 seconds.
- Keep all objects inside the frame: x roughly -6 to 6, y roughly -3.5 to 3.5.
- Use .scale(), .shift(), .next_to(), .to_edge() for positioning.
- End with self.wait(1).

Output ONLY the Python code. No markdown fences, no explanation.`;

async function generateManimCode(description: string, previousError?: string, previousCode?: string): Promise<string> {
  const messages: any[] = [
    { role: "system", content: MANIM_SYSTEM_PROMPT },
    { role: "user", content: `Animate this: ${description}` },
  ];

  if (previousError && previousCode) {
    messages.push({ role: "assistant", content: previousCode });
    messages.push({
      role: "user",
      content: `That code failed to render with this error:\n\n${previousError}\n\nFix it and output the corrected code only.`,
    });
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: "gpt-4o", messages, temperature: 0.3, max_tokens: 1200 }),
  });

  const data = await res.json();
  let code = data.choices?.[0]?.message?.content?.trim() ?? '';
  code = code.replace(/^```(?:python)?\n?/, '').replace(/\n?```$/, '');
  return code;
}

export async function GET() {
  const description = "a bar chart showing blue catfish making up three quarters of the fish in a river";
  const attempts: any[] = [];

  let code = await generateManimCode(description);
  let lastError = '';

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${process.env.MANIM_RENDER_URL}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: process.env.MANIM_RENDER_TOKEN,
        scene_name: "GeneratedScene",
        code,
      }),
    });

    if (res.ok) {
      const buf = await res.arrayBuffer();
      return NextResponse.json({
        success: true,
        attempt,
        bytes: buf.byteLength,
        code,
        attempts,
      });
    }

    lastError = (await res.text()).slice(-1500);
    attempts.push({ attempt, error: lastError.slice(0, 500), code });

    if (attempt < 3) {
      code = await generateManimCode(description, lastError, code);
    }
  }

  return NextResponse.json({ success: false, attempts });
}
