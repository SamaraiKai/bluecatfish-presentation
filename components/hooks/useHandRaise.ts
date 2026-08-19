"use client";
import { useEffect, useRef, useState } from "react";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const RAISE_SUSTAIN_MS = 600; 
const COOLDOWN_MS = 4000;

export function useHandRaise(enabled: boolean, onRaised: () => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detectorRef = useRef<HandLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const raiseStartRef = useRef<number | null>(null);
  const lastTriggerRef = useRef<number>(0);
  const onRaisedRef = useRef(onRaised);
  onRaisedRef.current = onRaised;

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return
    let cancelled = false;

    const start = async () => {
      setError(null);
      setReady(false);
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
        );
        const detector = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          },
          runningMode: "VIDEO",
          numHands: 1,
        });
        if (cancelled) {
          detector.close();
          return;
        }
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

          const result = detectorRef.current.detectForVideo(videoRef.current, performance.now());
          const hand = result.landmarks?.[0];

          // Landmark 0 = wrist. Video y-coords are 0 (top) to 1 (bottom).
          // A raised hand puts the wrist in the upper portion of frame.
          const wristY = hand?.[0]?.y;
          const isRaised = wristY !== undefined && wristY < 0.35;

          if (isRaised) {
            if (raiseStartRef.current === null) {
              raiseStartRef.current = Date.now();
            } else if (
              Date.now() - raisedStartRef.current > RAISE_SUSTAIN_MS &&
              Date.now() - lastTriggerRef.current > COOLDOWN_MS
            ) {
              lastTriggerRef.current = Date.now();
              raiseStartRef.current = null;
              onRaisedRef.current();
            }
          } else {
            raisedStartRef.current = null;
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

  return { ready, error };
}
