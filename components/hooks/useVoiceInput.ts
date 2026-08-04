import { useRef, useState } from "react";

type Status = "idle" | "listening" | "processing";

const SILENCE_THRESHOLD = 0.015; // RMS below this counts as silence
const SILENCE_DURATION = 2000;   // ms of silence before auto-stop

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

export function useVoiceInput(onTranscript: (text: string) => void, onListenStart?: () => void) {
  const [status, setStatus] = useState<Status>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // silence detection
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const hasSpokenRef = useRef(false);

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
          stopListening();
          return;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    tick();
  };
  
  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];

      const mimeType = pickMimeType();
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        try {
          const actualType = mr.mimeType || mimeType || "audio/webm";
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });

          const ext = actualType.includes("mp4") ? "mp4"
              : actualType.includes("ogg") ? "ogg"
              : "webm";
          
          const formData = new FormData();
          formData.append("file", blob, `recording.${ext}`);

          const res = await fetch("/api/transcribe", { method: "POST", body: formData });
          const data = await res.json();

          if (data.text?.trim()) onTranscript(data.text);
          else console.warn("Empty transcript", data.error ?? "");
        } catch (e) {
          console.error("Transcription failed:", e);
        } finally {
          setStatus("idle");
        }
      };

      mr.start();
      mediaRecorderRef.current = mr;
      setStatus("listening");
      onListenStart?.();  
      await watchForSilence(stream);
    } catch {
      console.error("Mic permission denied");
      setStatus("idle");
    }
  };

  const toggleMic = () => {
    if (status === "listening") stopListening();
    else startListening();
  };

  return { status, toggleMic };
}
