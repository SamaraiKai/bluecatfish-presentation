import { useRef, useState } from "react";

type Status = "idle" | "listening" | "processing";

export function useVoiceInput(onTranscript: (text: string) => void) {
  const [status, setStatus] = useState<Status>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];

      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        try {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const formData = new FormData();
          formData.append("file", blob, "recording.webm");

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
    } catch {
      console.error("Mic permission denied");
      setStatus("idle");
    }
  };

  const stopListening = () => {
    mediaRecorderRef.current?.stop();
    setStatus("processing");
  };

  const toggleMic = () => {
    if (status === "listening") stopListening();
    else startListening();
  };

  return { status, toggleMic };
}
