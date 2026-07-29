import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET = "slide-audio";
const FOLDER = "sections_v9";

const IMBETWEEN_PHRASES = [
  "This means...",
  "In other words...",
  "Put simply...",
];

const LAYOUT_DESCRIPTIONS = {
  classic: "As we go through the lesson, you'll see the image on your left and the content on your right.",
  split: "As we go through the lesson, you'll see the content on your left and the image on your right.",
};

const TRANSITION_PHRASES = [
  "A good analogy is...",
  "Think of it this way...",
  "Here's a way to picture it...",
];

const transition_lines = ["First.", "Next.", "Finally."];

const WRAP_UP_TEXT = "When you're ready, answer the quiz to head to the next section.";

const FAIL_TEXT = "It seems you didn't answer everything correctly. Let's head to review to cement what you know.";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

async function generateAndUpload(text: string, fileName: string): Promise<string> {
  // Skip regenerating if it already exists in Storage
  const { data: existing } = await supabase.storage
    .from(BUCKET)
    .list(FOLDER, { search: fileName.split("/").pop() });

  if (existing && existing.length > 0) {
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
    return urlData.publicUrl;
  }

  const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
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
  return urlData.publicUrl;
}

export async function POST(req: Request) {
  try {
    const { sections, intro, conclusion } = await req.json();
    if (!sections) throw new Error("Missing sections data");
    if (!process.env.OPENAI_API_KEY) throw new Error("Missing OpenAI API key");

    const audioUrls: Record<string, string> = {};

    // Intro narration
    if (intro) {
      const firstTopicSlug = slugify(sections?.[0]?.title || 'default');
      audioUrls["intro"] = await generateAndUpload(
        intro,
        `${FOLDER}/intro-${firstTopicSlug}.mp3`
        );
    }

    // Conclusion narration
    if (conclusion) {
      audioUrls["conclusion"] = await generateAndUpload(conclusion, `${FOLDER}/conclusion.mp3`);
    }

    for (const [template, text] of Object.entries(LAYOUT_DESCRIPTIONS)) {
      audioUrls[`layout_${template}`] = await generateAndUpload(text, `${FOLDER}/layout-${template}.mp3`);
    }
    
    for (let t = 0; t < IMBETWEEN_PHRASES.length; t++) {
      audioUrls[`imbetween${t}`] = await generateAndUpload(
        IMBETWEEN_PHRASES[t],
        `${FOLDER}/imbetween-${t}.mp3`
      );
    }
    
    for (let t = 0; t < TRANSITION_PHRASES.length; t++) {
      audioUrls[`transition${t}`] = await generateAndUpload(TRANSITION_PHRASES[t], `${FOLDER}/transition-${t}.mp3`
      );
    }

    for (let q = 0; q < sections.length; q++) {
      const quiz = sections[i].quiz ?? [];
      for (let q = 0; q < quiz.length; q++) {
        const correct = quiz[q].options[quiz[q].correctAnswer];
        audioUrls[`section${i}_review_q${q}`] = await generateAndUpload(
          `The correct answer is ${correct}. ${quiz[q].explanation ?? ""}`,
          `${FOLDER}/section${i + 1}_review_q${q + 1}.mp3`
        );
      }
    }

    audioUrls["review_intro_one"] = await generateAndUpload(
      "Almost perfect. Let's look at the one you missed.",
      `${FOLDER}/review_intro_one.mp3`
    );
    audioUrls["review_intro_some"] = await generateAndUpload(
      "Let's go back over the ones you missed.",
      `${FOLDER}/review_intro_some.mp3`
    );
    audioUrls["review_outro"] = await generateAndUpload(
      "That's the review. Ready to keep going?",
      `${FOLDER}/review_outro.mp3`
    );
    
    audioUrls['wrapup'] = await generateAndUpload(WRAP_UP_TEXT, `${FOLDER}/wrapup.mp3`);
    audioUrls['quizFail'] = await generateAndUpload(FAIL_TEXT, `${FOLDER}/quiz-fail.mp3`);
    // Per-section narration + breakdown audio
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];

      const nextTitle = sections[i + 1]?.title;
      const successText = nextTitle
        ? `Great job! You're really learning about Blue Catfish. Let's head to the next section: ${nextTitle}.`
        : `Great job! You've completed all the sections. Let's wrap things up.`;

      audioUrls[`section${i}_quizsuccess`] = await generateAndUpload(
        successText,
        `${FOLDER}/section${i + 1}_quizsuccess.mp3`
      );
      
      if (section.content) {
        audioUrls[`section${i}_overview`] = await generateAndUpload(
          section.content,
          `${FOLDER}/section${i + 1}_overview.mp3`
        );
      }

      for (let idx = 0; idx < transition_lines.length; idx++) {
        audioUrls[`ordinal${idx}`] = await generateAndUpload(
          transition_lines[idx],
          `${FOLDER}/ordinal${idx}.mp3`
        );
      }
      
      // and the intro line, also once
      audioUrls["keytermIntro"] = await generateAndUpload(
        "Let's go over some key terms.",
        `${FOLDER}/keyterm_intro.mp3`
      );
      
      if (section.stats?.length === 2) {
        const fact1Text = `One fun fact is ${section.stats[0].value}: ${section.stats[0].label}.`;
        const fact2Text = `Another fact is ${section.stats[1].value}: ${section.stats[1].label}.`;
      
        audioUrls[`section${i}_fact1`] = await generateAndUpload(
          fact1Text,
          `${FOLDER}/section${i + 1}_fact1.mp3`
        );
        audioUrls[`section${i}_fact2`] = await generateAndUpload(
          fact2Text,
          `${FOLDER}/section${i + 1}_fact2.mp3`
        );
      }
      
      if (section.breakdown?.simple) {
        audioUrls[`section${i}_simple`] = await generateAndUpload(
          section.breakdown.simple,
          `${FOLDER}/section${i + 1}_simple.mp3`
        );
      }
      if (section.breakdown?.keyTerms?.length === 3) {
        const kt = section.breakdown.keyTerms;

        for (let t = 0; t < 3; t++) {
          audioUrls[`section${i}_keyterm${t}`] = await generateAndUpload(
            `${kt[t].term}: ${kt[t].definition}.`,
            `${FOLDER}/section${i + 1}_keyterm${t + 1}.mp3`
          );
        }
      }
      if (section.breakdown?.realWorldExample) {
        audioUrls[`section${i}_example`] = await generateAndUpload(
          section.breakdown.realWorldExample,
          `${FOLDER}/section${i + 1}_example.mp3`
        );
      }
    }

    return NextResponse.json({ success: true, audioUrls });
  } catch (err: any) {
    console.error("Audio generation error:", err);
    return NextResponse.json({ error: err.message || "Failed to generate audio" }, { status: 500 });
  }
}
