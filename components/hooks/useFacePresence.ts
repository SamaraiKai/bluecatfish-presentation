"use client";

import { useEffect, useRef, useState } from "react";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

const ABSENCE_GRACE_MS = 3500;

export function useFacePresence(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastSeenRef = useRef<number>(Date.now());

  const [present, setPresent] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const start = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
        );
        const detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
          },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.5,
        });
        if (cancelled) return;
        detectorRef.current = detector;

        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const video = document.createElement("video");
        video.srcObject = stream;
        video.playsInline = true;
        await video.play();
        videoRef.current = video;
        setReady(true);

        const loop = () => {
          if (cancelled || !detectorRef.current || !videoRef.current) return;
          const result = detectorRef.current.detectForVideo(
            videoRef.current,
            performance.now()
          );

          if (result.detections.length > 0) {
            lastSeenRef.current = Date.now();
            setPresent(true);
          } else if (Date.now() - lastSeenRef.current > ABSENCE_GRACE_MS) {
            // 2s grace period so a blink or head turn doesn't trigger it
            setPresent(false);
          }

          rafRef.current = requestAnimationFrame(loop);
        };
        loop();
      } catch (e: any) {
        setError(e.message ?? "Camera unavailable");
      }
    };

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      detectorRef.current?.close();
      const stream = videoRef.current?.srcObject as MediaStream | undefined;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled]);

  return { present, ready, error };
}
