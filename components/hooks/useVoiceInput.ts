import { useState, useEffect, useRef, useCallback } from 'react';
import fixWebmDuration from 'fix-webm-duration';

type Status = "idle" | "listening" | "processing";

const SILENCE_THRESHOLD = 0.010; // RMS below this counts as silence
const SILENCE_DURATION = 2000;   // ms of silence before auto-stop

// Barge-in detection. Real speech dips between syllables, so the watcher
// counts speech with short gaps allowed, against a threshold that adapts to
// the room's background level (with a floor so a quiet room isn't hair-trigger).
const BARGE_MIN_LEVEL = 0.02;   // never trigger below this RMS
const BARGE_NOISE_MULT = 3;     // speech must be this many times the room's background level
const BARGE_ONSET_MS = 300;     // this much speech starts a barge-in...
const BARGE_GAP_MS = 180;       // ...where dips shorter than this don't reset it
const BARGE_TICK_MS = 30;

// The watcher hears the room through the same speakers the professor plays on;
// the browser's echo cancellation removes that playback from the mic signal.
const BARGE_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export type MicLevel = { level: number; threshold: number };

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
};

// What speech-to-text tends to "hear" in background noise or a cough
const NOISE_TRANSCRIPTS = /^(?:thank you|thanks|thanks for watching|thank you for watching|you|bye|okay|ok|hmm+|uh+|um+|so|yeah|oh|ah|music|\[.*\]|\(.*\))[.!?]*$/i;
function isNoiseTranscript(text: string): boolean {
  return NOISE_TRANSCRIPTS.test(text.trim());
}

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",         // Safari
    "audio/ogg;codecs=opus",
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return ""; // let the browser choose
}

/**
 * bargeInActive: talking now interrupts (the professor or tutor is speaking).
 * armed: keep the mic watcher open (voice interruptions switched on), so it
 *   isn't torn down and reopened between every audio clip. Defaults to bargeInActive.
 */
export function useVoiceInput(
  onTranscript: (text: string) => void,
  onListenStart?: () => void,
  bargeInActive: boolean = false,
  armed: boolean = bargeInActive,
) {
  const [status, setStatus] = useState<Status>("idle");
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<number>(0);

  // shared analyser plumbing
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const hasSpokenRef = useRef(false);

  // passive barge-in watcher (separate stream from recording)
  const bargeStreamRef = useRef<MediaStream | null>(null);
  const bargeCtxRef = useRef<AudioContext | null>(null);
  const bargeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bargeStartRef = useRef<number | null>(null);
  // Live mic level for the on-screen meter (read by polling, so it never re-renders the page)
  const levelRef = useRef<MicLevel>({ level: 0, threshold: BARGE_MIN_LEVEL });
  const bargeInActiveRef = useRef(bargeInActive);
  bargeInActiveRef.current = bargeInActive;
  // Bumped on every stop, so a watcher still waiting for the mic when it was
  // stopped knows to shut itself down instead of running on unowned
  const bargeGenRef = useRef(0);

  // Latest callbacks, so the passive loop never closes over stale ones
  const onListenStartRef = useRef(onListenStart);
  onListenStartRef.current = onListenStart;
  // Same for the transcript: a barge-in recording starts from an old render,
  // and its callback would otherwise see the slide as it was back then
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  /* ---------------------------------------------------- recording cleanup */
  const cleanupAnalyser = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    silenceStartRef.current = null;
    hasSpokenRef.current = false;
  };

  const stopListening = () => {
    cleanupAnalyser();
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      setStatus("processing");
    }
  };

  /* ------------------------------------------------ silence auto-stop loop */
  const watchForSilence = async (stream: MediaStream) => {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);

    const tick = () => {
      analyser.getFloatTimeDomainData(buffer);

      // root mean square = rough loudness
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
      const rms = Math.sqrt(sum / buffer.length);


      if (rms > SILENCE_THRESHOLD) {
        hasSpokenRef.current = true;
        silenceStartRef.current = null;
      } else if (hasSpokenRef.current) {
        // only start the clock once they've actually said something
        if (silenceStartRef.current === null) {
          silenceStartRef.current = performance.now();
        } else if (performance.now() - silenceStartRef.current > SILENCE_DURATION) {
          console.log('STOPPING: silence duration exceeded');
          stopListening();
          return;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    tick();
  };

  /* ------------------------------------------------------ start recording */
  const startListening = async () => {
    try {
      recordingStartRef.current = Date.now();
      stopBargeWatch();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
      const track = stream.getAudioTracks()[0];

      chunksRef.current = [];

      const mimeType = pickMimeType();
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        cleanupAnalyser();
        const recordingDuration = Date.now() - recordingStartRef.current;
        stream.getTracks().forEach((t) => t.stop());
        
        try {
          const actualType = mr.mimeType || mimeType || "audio/webm";
          const rawBlob = new Blob(chunksRef.current, { type: actualType });

         const blob = actualType.includes('webm')
          ? await fixWebmDuration(rawBlob, recordingDuration)
          : rawBlob;

          const ext = actualType.includes("mp4") ? "mp4"
              : actualType.includes("ogg") ? "ogg"
              : "webm";
          
          const formData = new FormData();
          formData.append("file", blob, `recording.${ext}`);

          const res = await fetch("/api/transcribe", { method: "POST", body: formData });
          const data = await res.json();

          const text = (data.text ?? "").trim();

          // Whisper returns filler like "Thank you." or "." on near-silence
          if (text.length > 2 && !isNoiseTranscript(text)) onTranscriptRef.current(text);
          else console.warn("Discarded empty transcript:", data.error ?? "");
        } catch (e) {
          console.error("Transcription failed:", e);
        } finally {
          setStatus("idle");
        }
      };

      mr.start();
      mediaRecorderRef.current = mr;
      setStatus("listening");
      onListenStartRef.current?.();
      await watchForSilence(stream);
    } catch (err) {
      console.error("Mic permission denied", err);
      setStatus("idle");
    }
  };

  const toggleMic = () => {
    if (status === "listening") stopListening();
    else startListening();
  };

  /* --------------------------------------------------- passive barge-in */
  const stopBargeWatch = () => {
    bargeGenRef.current++;
    if (bargeTimerRef.current) clearInterval(bargeTimerRef.current);
    bargeTimerRef.current = null;
    bargeCtxRef.current?.close().catch(() => {});
    bargeCtxRef.current = null;
    bargeStreamRef.current?.getTracks().forEach((t) => t.stop());
    bargeStreamRef.current = null;
    bargeStartRef.current = null;
    levelRef.current = { level: 0, threshold: levelRef.current.threshold };
  };

  const startBargeWatch = async () => {
    stopBargeWatch();   // never run two watchers
    const gen = bargeGenRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: BARGE_CONSTRAINTS,
      });
      if (gen !== bargeGenRef.current) {   // stopped while waiting for the mic
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      bargeStreamRef.current = stream;
 
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      bargeCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      if (gen !== bargeGenRef.current) return;   // stopBargeWatch already closed ctx and stream
 
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;   // ~21ms frames: short enough to see syllables
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);

      let noiseFloor = -1;          // learned background level
      let lastVoiced = 0;
 
      // setInterval, not requestAnimationFrame: keeps listening even when the
      // browser throttles animation frames (unfocused kiosk window, etc.)
      bargeTimerRef.current = setInterval(() => {
        if (gen !== bargeGenRef.current) return;
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);
        const now = performance.now();

        if (noiseFloor < 0) noiseFloor = rms;
        const threshold = Math.max(BARGE_MIN_LEVEL, noiseFloor * BARGE_NOISE_MULT);
        const voiced = rms > threshold;
        levelRef.current = { level: rms, threshold };

        if (voiced) {
          if (bargeStartRef.current === null) bargeStartRef.current = now;
          lastVoiced = now;
        } else {
          // only quiet moments teach the background level, capped so a noisy
          // stretch can't make the watcher deaf
          noiseFloor = Math.min(0.03, noiseFloor * 0.97 + rms * 0.03);
          if (bargeStartRef.current !== null && now - lastVoiced > BARGE_GAP_MS) bargeStartRef.current = null;
        }

        if (
          bargeInActiveRef.current &&
          bargeStartRef.current !== null &&
          lastVoiced - bargeStartRef.current >= BARGE_ONSET_MS
        ) {
          // Speech over the professor — cut it off and start recording
          startListening();
        }
      }, BARGE_TICK_MS);
    } catch {
      console.warn("Barge-in watcher could not access the mic");
    }
  };

  // Keep the watcher open while interruptions are on and we aren't recording.
  // Whether speech actually interrupts is checked live (bargeInActiveRef), so
  // the mic isn't closed and reopened every time one audio clip ends and the next starts.
  useEffect(() => {
    if (armed && status === "idle") {
      startBargeWatch();
    } else {
      stopBargeWatch();
    }
    return () => stopBargeWatch()
  }, [armed, status]);

  // Speech that started while nothing was playing shouldn't count once the professor starts
  useEffect(() => {
    if (!bargeInActive) bargeStartRef.current = null;
  }, [bargeInActive]);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);
 
  return { status, toggleMic, levelRef };
}
