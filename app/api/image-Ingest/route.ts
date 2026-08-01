import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function embed(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  const data = await res.json();
  return data.data[0].embedding;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const description = formData.get("description") as string;

    if (!file || !description) {
      return NextResponse.json(
        { error: "Missing file or description" },
        { status: 400 }
      );
    }

    // 1. Upload image to Supabase Storage
    const fileName = `${Date.now()}_${file.name}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from("slide-images")
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    // 2. Get public URL
    const { data: urlData } = supabase.storage
      .from("slide-images")
      .getPublicUrl(fileName);

    const url = urlData.publicUrl;

    // 3. Embed the description
    const embedding = await embed(description);

    // 4. Insert into images table
    const { error: insertError } = await supabase
      .from("images")
      .insert({ url, description, embedding });

    if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

    return NextResponse.json({ success: true, url });
  } catch (err: any) {
    console.error("Image ingestion error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to ingest image" },
      { status: 500 }
    );
  }
}
