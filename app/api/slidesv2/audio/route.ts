import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/* ============================================================================
 * CONFIG
 * ========================================================================== */
const BUCKET = "slide-audio";
const FOLDER = "sections_v23";

// How many TTS calls to run at once. Higher = faster, but risks rate limits.
const BATCH_SIZE = 8;

/* ============================================================================
 * STATIC SCRIPT TEXT
 * ========================================================================== */
const LAYOUT_DESCRIPTIONS = {
  classic: "As we go through the lesson, you'll see the image on your left and the content on your right.",
  split: "As we go through the lesson, you'll see the content on your left and the image on your right.",
};

// Played before a "simple explanation" step
const IMBETWEEN_PHRASES = [
  "This means...",
  "In other words...",
  "Put simply...",
];

// Played before a "real world example" step
const TRANSITION_PHRASES = [
  "A good analogy is...",
  "Think of it this way...",
  "Here's a way to picture it...",
];

// Played between individual key terms
const ORDINAL_LINES = ["First.", "Next.", "Then.", "Finally."];

const KEYTERM_INTRO_TEXT = "Let's go over some key terms.";

const WRAP_UP_TEXT = "When you're ready, answer the quiz to head to the next section.";

const FAIL_TEXT = "It seems you didn't answer everything correctly. Let's head to review to cement what you know.";

const REVIEW_INTRO_ONE_TEXT = "Almost perfect. Let's look at the one you missed.";
const REVIEW_INTRO_SOME_TEXT = "Let's go back over the ones you missed.";
const REVIEW_OUTRO_TEXT = "That's the review. Ready to keep going?";

const presence_away = "Take your time. I'll wait."
const presence_back = "Alright, picking up where we left off."

const HAND_RAISE_TEXT = "Do you have a question?";
/* ============================================================================
 * HELPERS
 * ========================================================================== */
type AudioJob = {
  key: string;      // the key used in audioUrls, e.g. "section0_overview"
  text: string;     // what gets spoken
  fileName: string; // full path within the bucket
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

function publicUrl(fileName: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

/**
 * Lists the folder once so we can skip regeneration without a network
 * round-trip per file.
 */
async function listExistingFiles(): Promise<Set<string>> {
  const { data, error } = await supabase.storage.from(BUCKET).list(FOLDER, {
    limit: 1000,
  });
  if (error) {
    console.warn("Could not list existing audio files:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((f) => f.name));
}

async function generateAndUpload(text: string, fileName: string): Promise<string> {
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

  return publicUrl(fileName);
}

/**
 * Runs every job, skipping any whose file already exists, in parallel batches.
 * A single failed clip is logged and skipped rather than aborting the run.
 */
async function runJobs(
  jobs: AudioJob[],
  existing: Set<string>
): Promise<Record<string, string>> {
  const audioUrls: Record<string, string> = {};
 
  // Already-uploaded files resolve immediately, no API call needed
  const pending: AudioJob[] = [];
  for (const job of jobs) {
    const baseName = job.fileName.split("/").pop()!;
    if (existing.has(baseName)) {
      audioUrls[job.key] = publicUrl(job.fileName);
    } else {
      pending.push(job);
    }
  }
 
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (job) => {
        try {
          return { key: job.key, url: await generateAndUpload(job.text, job.fileName) };
        } catch (e) {
          console.error(`Failed to generate "${job.key}":`, e);
          return null;
        }
      })
    );
    for (const r of results) {
      if (r) audioUrls[r.key] = r.url;
    }
  }
 
  return audioUrls;
}

/* ============================================================================
 * JOB BUILDERS
 * ========================================================================== */

/** Clips that never change — generated once and reused across every lesson. */
function buildSharedJobs(): AudioJob[] {
  const jobs: AudioJob[] = [];
 
  for (const [template, text] of Object.entries(LAYOUT_DESCRIPTIONS)) {
    jobs.push({
      key: `layout_${template}`,
      text,
      fileName: `${FOLDER}/layout-${template}.mp3`,
    });
  }
 
  IMBETWEEN_PHRASES.forEach((text, t) =>
    jobs.push({ key: `imbetween${t}`, text, fileName: `${FOLDER}/imbetween-${t}.mp3` })
  );
 
  TRANSITION_PHRASES.forEach((text, t) =>
    jobs.push({ key: `transition${t}`, text, fileName: `${FOLDER}/transition-${t}.mp3` })
  );
 
  ORDINAL_LINES.forEach((text, t) =>
    jobs.push({ key: `ordinal${t}`, text, fileName: `${FOLDER}/ordinal${t}.mp3` })
  );
 
  jobs.push({
    key: "keytermIntro",
    text: KEYTERM_INTRO_TEXT,
    fileName: `${FOLDER}/keyterm_intro.mp3`,
  });
 
  jobs.push({ key: "wrapup", text: WRAP_UP_TEXT, fileName: `${FOLDER}/wrapup.mp3` });
  jobs.push({ key: "quizFail", text: FAIL_TEXT, fileName: `${FOLDER}/quiz-fail.mp3` });
 
  jobs.push({
    key: "review_intro_one",
    text: REVIEW_INTRO_ONE_TEXT,
    fileName: `${FOLDER}/review_intro_one.mp3`,
  });
  jobs.push({
    key: "review_intro_some",
    text: REVIEW_INTRO_SOME_TEXT,
    fileName: `${FOLDER}/review_intro_some.mp3`,
  });
  jobs.push({
    key: "review_outro",
    text: REVIEW_OUTRO_TEXT,
    fileName: `${FOLDER}/review_outro.mp3`,
  });
  jobs.push({
  key: "presence_away",
  text: presence_away,
  fileName: `${FOLDER}/presence-away.mp3`,
  });
  jobs.push({
    key: "presence_back",
    text: presence_back,
    fileName: `${FOLDER}/presence-back.mp3`,
  });

  jobs.push({ 
    key: "handRaiseCue", 
    text: HAND_RAISE_TEXT, 
    fileName: `${FOLDER}/hand-raise-cue.mp3` 
  });
  
  return jobs;
}

/** Intro and conclusion narration, which depend on the generated lesson. */
function buildFramingJobs(
  sections: any[],
  intro?: string,
  conclusion?: string
): AudioJob[] {
  const jobs: AudioJob[] = [];
 
  if (intro) {
    const firstTopicSlug = slugify(sections?.[0]?.title || "default");
    jobs.push({
      key: "intro",
      text: intro,
      fileName: `${FOLDER}/intro-${firstTopicSlug}.mp3`,
    });
  }
 
  if (conclusion) {
    jobs.push({
      key: "conclusion",
      text: conclusion,
      fileName: `${FOLDER}/conclusion.mp3`,
    });
  }
 
  return jobs;
}

/** Everything tied to a specific section: narration, facts, key terms, quiz. */
function buildSectionJobs(sections: any[]): AudioJob[] {
  const jobs: AudioJob[] = [];
 
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    const nextTitle = sections[i + 1]?.title;
    const successText = nextTitle
      ? `Great job! You're really learning about Blue Catfish. Let's head to the next section: ${nextTitle}.`
      :  `Great job! You've completed all the sections. Let's wrap things up.`;
    jobs.push({
      key: `section${i}_quizsuccess`,
      text: successText, 
      fileName: `${FOLDER}/section${i + 1}_quizsuccess.mp3`
    });

    for (let s = 0; s < section.steps.length; s++) {
      const step = section.steps[s];

      if (step.type === 'numberSpotlight') {
        jobs.push({
          key: `section${i}_step${s}_value`,
          text: `${step.value}. ${step.label}.`,
          fileName: `${FOLDER}/section${i + 1}_step${s}_value.mp3`,
        });
        jobs.push({
          key: `section${i}_step${s}`,
          text: step.context,
          fileName: `${FOLDER}/section${i + 1}_step${s}.mp3`,
        });
      } else if (step.type === 'predictThen') {
        jobs.push({
          key: `section${i}_step${s}_question`,
          text: step.question,
          fileName: `${FOLDER}/section${i + 1}_step${s}_question.mp3`,
        });
        jobs.push({
          key: `section${i}_step${s}_answer`,
          text: `${step.answer}.`,
          fileName: `${FOLDER}/section${i + 1}_step${s}_answer.mp3`,
        });
        jobs.push({
          key: `section${i}_step${s}_reveal`,
          text: step.reveal,
          fileName: `${FOLDER}/section${i + 1}_step${s}_reveal.mp3`,
        });
      } else if (step.type === 'checkYourself') {
        jobs.push({
          key: `section${i}_step${s}_statement`,
          text: `True or false: ${step.statement}`,
          fileName: `${FOLDER}/section${i + 1}_step${s}_statement.mp3`,
        });
        jobs.push({
          key: `section${i}_step${s}_feedback`,
          text: step.feedback,
          fileName: `${FOLDER}/section${i + 1}_step${s}_feedback.mp3`,
        });
      } else if (step.type === 'keyTerms') {
        step.terms.forEach((t: any, termIdx: number) => {
          jobs.push({
            key: `section${i}_keyterm${termIdx}`,
            text: `${t.term}: ${t.definition}.`,
            fileName: `${FOLDER}/section${i + 1}_keyterm${termIdx}.mp3`,
          });
        });
      } else if (step.text) {
        jobs.push({
          key: `section${i}_step${s}`,
          text: step.text,
          fileName: `${FOLDER}/section${i + 1}_step${s}.mp3`,
        });
      }

      if (step.type === 'overview' && step.stats?.length) {
        step.stats.forEach((stat: any, f: number) => {
          const lead = f === 0 ? 'One fun fact is' : 'Another fact is';
          jobs.push({
            key: `section${i}_step${s}_fact${f}`,
            text: `${lead} ${stat.value}: ${stat.label}.`,
            fileName: `${FOLDER}/section${i + 1}_step${s}_fact${f}.mp3`,
          });
        });
      }
    }  
    
    if (section.quiz) {
      section.quiz.forEach((q: any, qIdx: number) => {
        jobs.push({
          key: `section${i}_review_q${qIdx}`,
          text: q.explanation,
          fileName: `${FOLDER}/section${i + 1}_review_q${qIdx}.mp3`,
        });
      });
    }
  }
  return jobs;
}
    

/* ============================================================================
 * ROUTE
 * ========================================================================== */
export async function POST(req: Request) {
  try {
    const { sections, intro, conclusion } = await req.json();
    if (!sections) throw new Error("Missing sections data");
    if (!process.env.OPENAI_API_KEY) throw new Error("Missing OpenAI API key");

    const jobs: AudioJob[] = [
      ...buildSharedJobs(),
      ...buildFramingJobs(sections, intro, conclusion),
      ...buildSectionJobs(sections),
    ];

    const existing = await listExistingFiles();
    const audioUrls = await runJobs(jobs, existing);

    return NextResponse.json({
      success: true,
      audioUrls,
      generated: Object.keys(audioUrls).length,
      requested: jobs.length,
    });
  } catch (err: any) {
    console.error("Audio generation error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to generate audio" },
      { status: 500 }
    );
  }
}
