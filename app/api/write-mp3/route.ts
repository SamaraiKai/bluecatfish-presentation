import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET = "slide-audio";

export async function POST(req: Request) {
  try {
    const { slides, textPref, audioPref, visualPref } = await req.json();
    if (!slides) throw new Error("Missing slides data");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OpenAI API key");

    const prefTag = `t-${textPref}_a-${audioPref}_v-${visualPref}`;
    const audioUrls: Record<string, string> = {};

    for (let slideIndex = 0; slideIndex < slides.length; slideIndex++) {
      const bullets = slides[slideIndex].bullets;
      for (let pointIndex = 0; pointIndex < bullets.length; pointIndex++) {
        const bullet = bullets[pointIndex];
        const narrationText = bullet.audio || bullet.detail; // fallback if no separate audio field

        const fileName = `${prefTag}/slide${slideIndex + 1}_point${pointIndex + 1}.mp3`;

        // Skip regenerating if it already exists in Storage
        const { data: existing } = await supabase.storage
          .from(BUCKET)
          .list(prefTag, { search: `slide${slideIndex + 1}_point${pointIndex + 1}.mp3` });

        if (existing && existing.length > 0) {
          const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
          audioUrls[`${slideIndex}_${pointIndex}`] = urlData.publicUrl;
          continue;
        }

        const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini-tts",
            voice: "alloy",
            input: narrationText,
          }),
        });

        if (!ttsResponse.ok) {
          const errText = await ttsResponse.text();
          throw new Error(`TTS failed: ${errText}`);
        }

        const arrayBuffer = await ttsResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(fileName, buffer, {
            contentType: "audio/mpeg",
            upsert: true,
          });

        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
        audioUrls[`${slideIndex}_${pointIndex}`] = urlData.publicUrl;
      }
    }

    return NextResponse.json({ success: true, audioUrls });
  } catch (err: any) {
    console.error("Audio generation error:", err);
    return NextResponse.json({ error: err.message || "Failed to generate audio" }, { status: 500 });
  }
}
