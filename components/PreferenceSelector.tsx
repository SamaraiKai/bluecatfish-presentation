"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type TextLevel = "low" | "medium" | "high" | "max";
type AudioLevel = "none" | "low" | "medium" | "high";
type VisualLevel = "low" | "medium" | "high";

type Category = "text" | "audio" | "visual";

const TEXT_LEVELS = ["low", "medium", "high", "max"];
const AUDIO_LEVELS = ["none", "low", "medium", "high"];
const VISUAL_LEVELS = ["low", "medium", "high"];

const CATEGORIES: { key: Category; label: string }[] = [
  { key: "text", label: "Text" },
  { key: "audio", label: "Audio" },
  { key: "visual", label: "Visual" },
];

const ITEM_HEIGHT = 56; // px per option row

// ---------- Single "slot machine" column for one category ----------
function SlotColumn({
  value,
  onChange,
  levels,
}: {
  value: Level;
  onChange: (v: Level) => void;
  levels: string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const idx = levels.indexOf(value);
    containerRef.current?.scrollTo({
      top: idx * ITEM_HEIGHT,
      behavior: "auto",
    });
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      const el = containerRef.current;
      if (!el) return;
      const idx = Math.round(el.scrollTop / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(levels.length - 1, idx));
      el.scrollTo({ top: clamped * ITEM_HEIGHT, behavior: "smooth" });
      onChange(levels[clamped]);
    }, 100);
  }, [onChange]);

  // 🔻 Custom wheel handler — slows scroll speed to ~half
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const SPEED_FACTOR = 0.5; // lower = slower, try 0.3 if still too fast
    el.scrollTop += e.deltaY * SPEED_FACTOR;
    handleScroll();
  }, [handleScroll]);

  return (
    <div className="relative h-[168px] w-24">
      <div className="pointer-events-none absolute left-0 right-0 top-1/2 z-10 h-14 -translate-y-1/2 rounded-lg border-2 border-blue-600 bg-blue-50/40" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-14 bg-gradient-to-b from-white to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-14 bg-gradient-to-t from-white to-transparent" />

      <div
        ref={containerRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        className="h-full snap-y snap-mandatory overflow-y-scroll scrollbar-none"
        style={{ scrollbarWidth: "none" }}
      >
        <div style={{ height: ITEM_HEIGHT }} />
        {levels.map((level) => (
          <div
            key={level}
            className="flex h-14 snap-center items-center justify-center text-sm font-medium capitalize text-gray-700"
            style={{ scrollSnapStop: "always" }}
          >
            {level}
          </div>
        ))}
        <div style={{ height: ITEM_HEIGHT }} />
      </div>
    </div>
  );
}

// ---------- Main component ----------
export default function PreferenceSelector({
  onComplete,
}: {
  onComplete: (prefs: any) => void;
}) {
  const [step, setStep] = useState<"intro" | "selector">("intro");
  
  const [prefs, setPrefs] = useState<{
    text: TextLevel;
    audio: AudioLevel;
    visual: VisualLevel;
  }>({
    text: "medium",
    audio: "low",
    visual: "medium",
  });
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = (category: Category, level: Level) => {
    setPrefs((prev) => ({ ...prev, [category]: level } as typeof prev));
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        throw new Error("No authenticated user found");
      }

      const { error: upsertError } = await supabase
        .from("user_preferences")
        .upsert({
          user_id: userData.user.id,
          text_pref: prefs.text,
          audio_pref: prefs.audio,
          image_pref: prefs.visual,
          updated_at: new Date().toISOString(),
        });

      if (upsertError) throw upsertError;

      onComplete({
        text_pref: prefs.text,
        audio_pref: prefs.audio,
        image_pref: prefs.visual,
      }); 
    }  catch (err: any) {
      setError(err.message || "Failed to save preferences");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        {step === "intro" ? (
          <>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              Before moving on
            </h2>
            <p className="mb-6 text-sm text-gray-600">
              We ask you to give us some insight on your learning preferences,
              so we can tailor your content to how you learn best.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setStep("selector")}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                OK
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mb-1 text-lg font-semibold text-gray-900">
              Set your preferences
            </h2>
            <p className="mb-6 text-sm text-gray-500">
              Scroll each column to choose Low, Medium, or High.
            </p>

            <div className="mb-6 flex justify-around">
              {CATEGORIES.map(({ key, label }) => {
                  const levelsForCategory =
                      key === "text" ? TEXT_LEVELS : key === "audio" ? AUDIO_LEVELS : VISUAL_LEVELS;
                  return (
                    <div key={key} className="flex flex-col items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {label}
                      </span>
                      <SlotColumn value={prefs[key]} onChange={(v) => handleSelect(key, v)} levels={levelsForCategory} />
                    </div>
                    );
              })}
            </div>

            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Submit"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
