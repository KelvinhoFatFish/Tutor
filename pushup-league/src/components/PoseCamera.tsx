'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DetectorEvent, FrameMetrics, Landmarks } from '@/lib/pushup/types';
import { evaluateReadiness, type ReadinessResult } from '@/lib/pushup/detector';
import type { PushupDetector } from '@/lib/pushup/detector';

/**
 * ============================================================================
 *  POSE CAMERA
 * ============================================================================
 *
 * Owns the camera, the MediaPipe pose model and the skeleton drawing.
 *
 * PRIVACY: the model and its WebAssembly runtime are served from THIS site
 * (see scripts/setup-assets.mjs), and both run inside the browser. Video frames
 * are never uploaded anywhere - only the finished rep count is, and only when
 * the workout ends. Nothing here sends a picture over the network.
 *
 * PERFORMANCE: detection runs at ~30 frames per second. That is plenty for a
 * push-up (the fastest human rep is around 700 ms) and roughly halves the
 * battery drain compared with running on every animation frame.
 */

const DETECT_INTERVAL_MS = 1000 / 30;

/** The standard MediaPipe pose skeleton, drawn as lines between joints. */
const POSE_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10], [11, 12],
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
];

/** Joints we colour differently because they decide whether a rep counts. */
const KEY_JOINTS = new Set([11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]);

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'loading-model'
  | 'ready'
  | 'error';

export interface CameraError {
  title: string;
  detail: string;
  /** What the user should actually do about it. */
  fix: string;
}

export interface PoseCameraProps {
  /** The detector instance to feed. Owned by the parent so it can read totals. */
  detector: PushupDetector;
  /** When false, frames are still drawn but no reps are counted. */
  counting: boolean;
  onEvent?: (event: DetectorEvent) => void;
  onReadiness?: (result: ReadinessResult) => void;
  onMetrics?: (metrics: FrameMetrics | null) => void;
  onStatusChange?: (status: CameraStatus) => void;
  onMultiplePeople?: (count: number) => void;
  facingMode?: 'user' | 'environment';
  onToggleFacing?: () => void;
  /** Shown underneath the video. */
  footer?: React.ReactNode;
  overlay?: React.ReactNode;
}

export default function PoseCamera({
  detector,
  counting,
  onEvent,
  onReadiness,
  onMetrics,
  onStatusChange,
  onMultiplePeople,
  facingMode = 'environment',
  onToggleFacing,
  footer,
  overlay,
}: PoseCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const landmarkerRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const lastDetectRef = useRef(0);
  const lastDrawRef = useRef<Landmarks | null>(null);
  /** When we last sent a continuous readout (metrics / readiness) to the parent. */
  const lastEmitRef = useRef(0);
  /** The last event we forwarded, used to avoid re-rendering on every frame. */
  const lastEventRef = useRef<{ type: string; message: string | null }>({ type: '', message: null });

  // Props are read inside the animation loop, so keep them in refs to avoid
  // restarting the loop every time a parent re-renders.
  const countingRef = useRef(counting);
  const callbacksRef = useRef({ onEvent, onReadiness, onMetrics, onMultiplePeople });
  useEffect(() => {
    countingRef.current = counting;
  }, [counting]);
  useEffect(() => {
    callbacksRef.current = { onEvent, onReadiness, onMetrics, onMultiplePeople };
  }, [onEvent, onReadiness, onMetrics, onMultiplePeople]);

  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<CameraError | null>(null);
  const [modelProgress, setModelProgress] = useState(1);

  const updateStatus = useCallback(
    (next: CameraStatus) => {
      setStatus(next);
      onStatusChange?.(next);
    },
    [onStatusChange],
  );

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------
  const draw = useCallback((landmarks: Landmarks | null, canvas: HTMLCanvasElement, video: HTMLVideoElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.clearRect(0, 0, width, height);
    if (!landmarks) return;

    const px = (p: { x: number; y: number }) => ({ x: p.x * width, y: p.y * height });

    // Joint lines
    ctx.lineWidth = Math.max(3, width / 190);
    ctx.lineCap = 'round';
    for (const [a, b] of POSE_CONNECTIONS) {
      const pa = landmarks[a];
      const pb = landmarks[b];
      if (!pa || !pb) continue;
      if ((pa.visibility ?? 1) < 0.35 || (pb.visibility ?? 1) < 0.35) continue;

      const A = px(pa);
      const B = px(pb);
      const confidence = Math.min(pa.visibility ?? 1, pb.visibility ?? 1);

      ctx.strokeStyle = `rgba(43, 255, 136, ${0.25 + confidence * 0.6})`;
      ctx.shadowColor = 'rgba(43, 255, 136, 0.55)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }

    // Joints
    ctx.shadowBlur = 0;
    landmarks.forEach((point, index) => {
      const visibility = point.visibility ?? 1;
      if (visibility < 0.35) return;
      const { x, y } = px(point);
      const isKey = KEY_JOINTS.has(index);
      const radius = isKey ? Math.max(4, width / 150) : Math.max(2.5, width / 260);

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isKey ? '#2bff88' : 'rgba(0, 194, 255, 0.85)';
      ctx.fill();

      if (isKey) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(4, 7, 12, 0.85)';
        ctx.stroke();
      }
    });
  }, []);

  // -------------------------------------------------------------------------
  // Detection loop
  // -------------------------------------------------------------------------
  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;

    if (video && canvas && landmarker && video.readyState >= 2) {
      const now = performance.now();
      if (now - lastDetectRef.current >= DETECT_INTERVAL_MS) {
        lastDetectRef.current = now;
        try {
          const result = landmarker.detectForVideo(video, now);
          const poses: Landmarks[] = (result?.landmarks ?? []) as Landmarks[];

          if (poses.length > 1) {
            callbacksRef.current.onMultiplePeople?.(poses.length);
          }

          const primary = poses.length > 0 ? normalise(poses[0]) : null;
          lastDrawRef.current = primary;
          draw(primary, canvas, video);

          // The detector runs on EVERY frame so a rep can never be missed.
          let event: DetectorEvent | null = null;
          if (countingRef.current) {
            event = detector.update(primary, now);

            // ...but we only tell the parent about it when something actually
            // changed. Without this the workout screen would re-render ~30 times
            // a second, which drains the battery and makes the counter stutter.
            const previous = lastEventRef.current;
            const worthReporting =
              event.type === 'count' ||
              event.type === 'invalid' ||
              event.type !== previous.type ||
              event.message !== previous.message;

            if (worthReporting) {
              lastEventRef.current = { type: event.type, message: event.message };
              callbacksRef.current.onEvent?.(event);
            }
          }

          // Live readouts (angles, camera-position checks) are for the human eye,
          // so a handful of updates per second is plenty.
          if (now - lastEmitRef.current >= 200) {
            lastEmitRef.current = now;
            callbacksRef.current.onMetrics?.(event?.metrics ?? detector.getMetrics());
            callbacksRef.current.onReadiness?.(evaluateReadiness(primary, detector.getConfig()));
          }
        } catch (detectError) {
          // A single bad frame must never kill the session.
          console.warn('[pose] detection frame skipped', detectError);
        }
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [detector, draw]);

  // -------------------------------------------------------------------------
  // Start-up
  // -------------------------------------------------------------------------
  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    try {
      landmarkerRef.current?.close?.();
    } catch {
      // already disposed
    }
    landmarkerRef.current = null;
    updateStatus('idle');
  }, [updateStatus]);

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined') return;
    setError(null);

    // 1. Is the browser even able to give us a camera here?
    if (!navigator.mediaDevices?.getUserMedia) {
      updateStatus('error');
      setError({
        title: 'This browser cannot use the camera',
        detail:
          'Browsers only allow camera access on a secure page. That means https:// or, on your own computer, http://localhost.',
        fix: 'Open the app at http://localhost:3000 while developing, or use the https:// address once it is deployed. Also try Chrome, Edge or Safari.',
      });
      return;
    }

    try {
      updateStatus('requesting');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 },
        },
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play().catch(() => {
        /* autoplay can be refused; the preview still renders */
      });

      // 2. Load the pose model (once per page view).
      updateStatus('loading-model');
      setModelProgress(0);
      const vision = await import('@mediapipe/tasks-vision');

      const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
      setModelProgress(0.6);

      let landmarker;
      try {
        landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: '/models/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          // 2 lets us notice when somebody else walks into shot.
          numPoses: 2,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch (gpuError) {
        // Older devices without WebGL2 still work, just a bit slower.
        console.warn('[pose] GPU delegate unavailable, falling back to CPU', gpuError);
        landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'CPU' },
          runningMode: 'VIDEO',
          numPoses: 2,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      }

      setModelProgress(1);
      landmarkerRef.current = landmarker;
      updateStatus('ready');
      rafRef.current = requestAnimationFrame(tick);
    } catch (cameraError) {
      updateStatus('error');
      setError(describeCameraError(cameraError));
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, [facingMode, tick, updateStatus]);

  // Restart the video source when the user flips between front and back cameras.
  useEffect(() => {
    if (status !== 'ready' && status !== 'requesting') return;
    let cancelled = false;

    const swap = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        // Ignore: we keep the previous camera running.
      }
    };

    void swap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  useEffect(() => {
    void start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the page awake during a workout where supported.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
        };
        if (nav.wakeLock) lock = await nav.wakeLock.request('screen');
      } catch {
        // Not supported or denied - not important.
      }
    };
    if (status === 'ready') void request();
    return () => {
      void lock?.release().catch(() => {});
    };
  }, [status]);

  const percentLoaded = Math.round(modelProgress * 100);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black">
        <video
          ref={videoRef}
          className="block h-auto w-full"
          style={{
            // Mirror the front camera so it behaves like a mirror.
            transform: facingMode === 'user' ? 'scaleX(-1)' : undefined,
            aspectRatio: '4 / 3',
            objectFit: 'cover',
          }}
          playsInline
          muted
          autoPlay
        />
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : undefined }}
        />

        {status === 'requesting' ? (
          <CameraNotice icon="📷" title="Waiting for camera permission…" detail="Choose Allow when your browser asks." />
        ) : null}
        {status === 'loading-model' ? (
          <CameraNotice
            icon="🧠"
            title="Loading the pose model…"
            detail={`${percentLoaded}% - this happens once and is then cached.`}
          />
        ) : null}
        {status === 'error' && error ? (
          <CameraNotice icon="⚠️" title={error.title} detail={error.detail} fix={error.fix} tone="error" />
        ) : null}

        {overlay}

        {onToggleFacing && status === 'ready' ? (
          <button
            type="button"
            onClick={onToggleFacing}
            className="absolute top-3 right-3 rounded-full border border-white/15 bg-ink-950/70 px-3 py-2 text-xs font-bold backdrop-blur-md"
          >
            🔄 {facingMode === 'user' ? 'Front' : 'Back'}
          </button>
        ) : null}
      </div>

      {status === 'error' && error ? (
        <div className="card p-4 text-sm">
          <p className="font-bold text-flame-400">What to do</p>
          <p className="mt-1 text-slate-300">{error.fix}</p>
          <button type="button" onClick={() => void start()} className="btn btn-secondary mt-3 w-full">
            Try again
          </button>
        </div>
      ) : null}

      {footer}
    </div>
  );
}

function CameraNotice({
  icon,
  title,
  detail,
  fix,
  tone = 'info',
}: {
  icon: string;
  title: string;
  detail: string;
  fix?: string;
  tone?: 'info' | 'error';
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-ink-950/82 p-6 text-center backdrop-blur-sm">
      <div className="max-w-sm">
        <div className="text-4xl" aria-hidden="true">
          {icon}
        </div>
        <p className={`mt-2 text-base font-bold ${tone === 'error' ? 'text-danger-400' : 'text-slate-100'}`}>
          {title}
        </p>
        <p className="mt-1 text-sm text-slate-400">{detail}</p>
        {fix ? <p className="mt-2 text-xs text-slate-500">{fix}</p> : null}
      </div>
    </div>
  );
}

/** Converts MediaPipe's landmark objects into our own plain shape. */
function normalise(landmarks: Landmarks): Landmarks {
  return landmarks.map((point) => ({
    x: point.x,
    y: point.y,
    z: point.z ?? 0,
    visibility: point.visibility,
  }));
}

/**
 * Turns a raw getUserMedia failure into something a non-technical person can
 * act on. Getting this wrong is the difference between "the app is broken" and
 * "you clicked Block once, here is how to undo it".
 */
function describeCameraError(error: unknown): CameraError {
  const name = (error as { name?: string })?.name ?? '';

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        title: 'Camera access was blocked',
        detail: 'Your browser or your phone is currently refusing to share the camera with this site.',
        fix: 'Tap the lock or camera icon in the address bar, set Camera to "Allow", then reload the page. On iPhone: Settings → Safari → Camera → Allow.',
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        title: 'No camera was found',
        detail: 'We could not find a camera that matches what the app asked for.',
        fix: 'Check that no other app is using the camera, then try the 🔄 button to switch between the front and back camera.',
      };
    case 'NotReadableError':
      return {
        title: 'The camera is busy',
        detail: 'Another app or browser tab is already using the camera.',
        fix: 'Close other video apps (Zoom, Teams, Camera) and any other PushUp League tabs, then press Try again.',
      };
    default:
      return {
        title: 'The camera could not be started',
        detail: (error as { message?: string })?.message ?? 'An unknown camera error occurred.',
        fix: 'Reload the page and allow camera access when asked. If it keeps failing, try Chrome or Safari.',
      };
  }
}
