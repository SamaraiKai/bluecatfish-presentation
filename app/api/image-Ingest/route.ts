import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function describeImage(imageUrl: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Describe this image for a lesson about the Blue Catfish invasion in the Chesapeake Bay. State factually what is visible — subject, setting, notable details, scale, activity. Then, in the same description, state plainly how this image most likely relates to the lesson's themes: the fish itself, its size or biology, the native species it preys on, its ecosystem impact, commercial harvesting, cooking and eating it, or human response. Use the vocabulary someone would search for when looking for an image about that theme. 3-4 sentences. Describe only what you can see; when stating the likely relevance, keep it to the obvious connection, not speculation about specifics you cannot verify.`,
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 350,
    }),
  });

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

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
    const manualDescription = (formData.get("description") as string | null)?.trim() || null;

    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    // 1. Upload image to Supabase Storage
    const fileName = `${Date.now()}_${file.name}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from("slide-imagesv2")
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    // 2. Get public URL
    const { data: urlData } = supabase.storage
      .from("slide-imagesv2")
      .getPublicUrl(fileName);

    const url = urlData.publicUrl;

    
    // 3. Get and Embed the description
    const description = manualDescription ?? await describeImage(url);
    if (!description) throw new Error("Could not generate a description for this image");
    
    const embedding = await embed(description);

    // 4. Insert into images table
    const { error: insertError } = await supabase
      .from("images2")
      .insert({ url, description, embedding });

    if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

    return NextResponse.json({ success: true, url, description });
  } catch (err: any) {
    console.error("Image ingestion error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to ingest image" },
      { status: 500 }
    );
  }
}
