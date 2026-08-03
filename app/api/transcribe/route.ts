import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const incoming = await req.formData();
    const file = incoming.get("file") as File;
    if (!file) throw new Error("Missing audio file");

    const formData = new FormData();
    formData.append("file", file, "recording.webm");
    formData.append("model", "whisper-1");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Transcription failed: ${errText}`);
    }

    const data = await res.json();
    return NextResponse.json({ text: data.text });
  } catch (err: any) {
    console.error("Transcription error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to transcribe" },
      { status: 500 }
    );
  }
}
