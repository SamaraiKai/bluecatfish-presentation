import { useRef, useState } from 'react';

async function fetchClip(text: string): Promise<Blob | null> {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

export function useSpeechQueue() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const clipsRef = useRef<Promise<Blob | null>[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const drainingRef = useRef(false);
  const cancelledRef = useRef(false);

  const playBlob = (blob: Blob) =>
    new Promise<void>((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      const done = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    });

  const drain = async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setIsSpeaking(true);

    while (clipsRef.current.length > 0 && !cancelledRef.current) {
      const blob = await clipsRef.current.shift()!;
      if (cancelledRef.current) break;
      if (blob) await playBlob(blob);
    }

    drainingRef.current = false;
    setIsSpeaking(false);
  };

  // Kicks off generation immediately; playback stays in order
  const enqueue = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    cancelledRef.current = false;
    clipsRef.current.push(fetchClip(trimmed));
    drain();
  };

  const stopSpeaking = () => {
    cancelledRef.current = true;
    clipsRef.current = [];
    audioRef.current?.pause();
    audioRef.current = null;
    setIsSpeaking(false);
  };

  return { enqueue, stopSpeaking, isSpeaking };
}
