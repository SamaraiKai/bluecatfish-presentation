import { useState, useEffect, useRef, useCallback } from 'react';
import fixWebmDuration from 'fix-webm-duration';

type Status = "idle" | "listening" | "processing";

const SILENCE_THRESHOLD = 0.010; // RMS below this counts as silence
const SILENCE_DURATION = 2000;   // ms of silence before auto-stop

const BARGE_THRESHOLD = 0.05;
const BARGE_SUSTAIN = 250;

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

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

export function useVoiceInput(onTranscript: (text: string) => void, onListenStart?: () => void, bargeInActive: boolean = false) {
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
  const bargeRafRef = useRef<number | null>(null);
  const bargeStartRef = useRef<number | null>(null);

  // Latest callbacks, so the passive loop never closes over stale ones
  const onListenStartRef = useRef(onListenStart);
  onListenStartRef.current = onListenStart;

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

      console.log(`rms=${rms.toFixed(4)} hasSpoken=${hasSpokenRef.current} silenceMs=${silenceStartRef.current ? Math.round(performance.now() - silenceStartRef.current) : 'n/a'}`);

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];

      const mimeType = pickMimeType();
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      console.log('blob size:', blob.size, 'bytes, type:', blob.type, 'duration used for fix:', recordingDuration, 'ms');
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
          if (text.length > 2) onTranscript(text);
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
      onListenStart?.();  
      await watchForSilence(stream);
    } catch {
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
    if (bargeRafRef.current) cancelAnimationFrame(bargeRafRef.current);
    bargeRafRef.current = null;
    bargeCtxRef.current?.close().catch(() => {});
    bargeCtxRef.current = null;
    bargeStreamRef.current?.getTracks().forEach((t) => t.stop());
    bargeStreamRef.current = null;
    bargeStartRef.current = null;
  };

  const startBargeWatch = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: MIC_CONSTRAINTS,
      });
      bargeStreamRef.current = stream;
 
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      bargeCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      console.log('AudioContext state:', ctx.state);
 
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
 
      const buffer = new Float32Array(analyser.fftSize);
 
      const tick = () => {
        analyser.getFloatTimeDomainData(buffer);
 
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);
 
        if (rms > BARGE_THRESHOLD) {
          if (bargeStartRef.current === null) {
            bargeStartRef.current = performance.now();
          } else if (performance.now() - bargeStartRef.current > BARGE_SUSTAIN) {
            // Sustained speech over the AI — cut it off and start recording
            startListening();
            return;
          }
        } else {
          bargeStartRef.current = null;
        }
 
        bargeRafRef.current = requestAnimationFrame(tick);
      };
 
      tick();
    } catch {
      console.warn("Barge-in watcher could not access the mic");
    }
  };

  // Run the passive watcher only while the AI is talking and we aren't recording
  useEffect(() => {
    if (bargeInActive && status === "idle") {
      startBargeWatch();
    } else {
      stopBargeWatch();
    }
    return () => {
      stopBargeWatch();
      stopListening();
    };
  }, [bargeInActive, status]);
 
  return { status, toggleMic };
}
