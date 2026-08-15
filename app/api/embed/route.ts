export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import mammoth from 'mammoth';
import extract from 'pdf-extraction';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function chunkText(text: string, maxChunkSize: number = 200, overlap: number = 40): string[] {
  const words = text.split(' ');
  const chunks: string[] = [];
  
  let current: string[] = [];
  for (const word of words) {
    current.push(word)
    const currentText = current.join(' ');
    
    if (currentText.length >= maxChunkSize) {
      chunks.push(currentText);

      let overlapWords: string[] = [];
      let overlapChars = 0;

      for (let i = current.length - 1; i >= 0 && overlapChars < overlap; i--) {
        overlapWords.unshift(current[i]);
        overlapChars += current[i].length + 1; // +1 for the space
      }
      
      current = overlapWords;
    } 
  }
  
  if (current.length) {
   chunks.push(current.join(' '));
  }
  return chunks;
}

async function getEmbedding(text: string): Promise<number[]> {
  console.log("CALLING EMBEDDING API");
  console.log("🔥 /api/embed HIT");
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  });

  const raw = await response.text();
  console.log("embedding raw response:", raw);

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error("Embedding API returned non-JSON: " + raw);
  }

  if (!data.data?.[0]?.embedding) {
    throw new Error("Missing embedding in response: " + raw);
  }
  
  return data.data[0].embedding;
}

export async function POST(request: NextRequest) {
  try {
    console.log("🔥 API START");
    const body = await request.json()
    console.log("BODY RECEIVED");

    const textInput = body.text;
    const fileBase64 = body.file;
    const fileType = body.fileType;
    const fileName = body.fileName;

    let text: string = textInput ?? '';

    if (fileBase64) {
      const buffer = Buffer.from(fileBase64, 'base64');

      if (fileType === 'pdf') {
        const data = await extract(buffer);
        text = data.text;
      }

      else if (fileType === 'docx') {
        const result: any = await mammoth.extractRawText({ buffer });
        text = result.value;
      }

      else if (fileType === 'txt') {
        text = buffer.toString('utf-8');
      }
    }

    if (!text) {
      return NextResponse.json(
        { error: 'No text or file provided' },
        { status: 400 }
      );
    }

    text = text
      .replace(/\s+/g, ' ')
      .replace(/\n/g, ' ')
      .trim();

    const chunks = chunkText(text, 200, 40);
    const results = [];

    for (const chunk of chunks) {
      const embedding = await getEmbedding(chunk);
      console.log("embedding length:", embedding.length);
      const { data, error } = await supabase
        .from('documents3')
        .insert({ content: chunk, embedding, source: fileName || 'manual-input'})
        .select();
      console.log("insert result:", { data, error });
      if (error) {
        console.error("SUPABASE INSERT FAILED:", error);
        throw error;
      }
     results.push(chunk);
      }
  return NextResponse.json({ 
    success: true, 
    chunks: results.length 
  });
  } catch (error) {
    console.error("FULL EMBED ERROR:", JSON.stringify(error, null, 2));
    console.error("TYPE:", typeof error);
    console.error("STACK:", (error as any)?.stack);
    
    return NextResponse.json(
      { error: 'Failed to embed' }, 
      { status: 500 }
    );
  }
}
