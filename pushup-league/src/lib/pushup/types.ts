/**
 * PUSH-UP DETECTION - SHARED TYPES
 * --------------------------------
 * These types are deliberately independent of MediaPipe so the counting logic
 * can be unit-tested with plain numbers (see scripts/test-detector.ts).
 */

export interface Point {
  /** 0 = left edge of the camera frame, 1 = right edge. */
  x: number;
  /** 0 = top of the camera frame, 1 = bottom. */
  y: number;
  z?: number;
  /** How sure the model is that this joint is really visible (0..1). */
  visibility?: number;
}

/** A single detected person: 33 MediaPipe pose landmarks. */
export type Landmarks = Point[];

/**
 * MediaPipe's fixed landmark numbering. We only use the joints that matter for
 * a push-up, but the full names are here so the code reads clearly.
 */
export const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT: 31,
  RIGHT_FOOT: 32,
} as const;

/**
 * The joints the app refuses to count without. If any of these are missing the
 * user is told to step back into frame rather than being given a free rep.
 */
export const REQUIRED_LANDMARKS: number[] = [
  LM.LEFT_SHOULDER,
  LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW,
  LM.RIGHT_ELBOW,
  LM.LEFT_WRIST,
  LM.RIGHT_WRIST,
  LM.LEFT_HIP,
  LM.RIGHT_HIP,
  LM.LEFT_KNEE,
  LM.RIGHT_KNEE,
  LM.LEFT_ANKLE,
  LM.RIGHT_ANKLE,
];

/** Which side of the body the detector decided to trust this frame. */
export type Side = 'left' | 'right';

export interface FrameMetrics {
  /** Average elbow angle in degrees. 180 = arm perfectly straight. */
  elbowAngle: number;
  /** Which arm produced the elbow angle. */
  side: Side;
  /** Angle at the hip between shoulder and ankle. 180 = perfectly straight body. */
  bodyAlignment: number;
  /** How straight the body is, as a pass/fail against the config tolerance. */
  alignmentOk: boolean;
  /** Lowest visibility across the joints we require (0..1). */
  confidence: number;
  /** Normalised shoulder height; larger = closer to the bottom of the frame. */
  shoulderY: number;
  hipY: number;
  /** Wrist height - in a push-up the shoulder sits above the wrist. */
  wristY: number;
  /** Vertical distance from shoulders to ankles. Small => user is far away. */
  bodySpan: number;
  /** True when the camera frame is too jumpy to trust (hand waved over lens, phone knocked). */
  unstable: boolean;
}

export type PushupPhase = 'IDLE' | 'READY' | 'DOWN' | 'BOTTOM' | 'UP';

export type DetectorEventType =
  | 'idle'
  | 'ready'
  | 'down'
  | 'bottom'
  | 'up'
  | 'count'
  | 'invalid'
  | 'unstable'
  | 'low-confidence';

export interface DetectorEvent {
  type: DetectorEventType;
  phase: PushupPhase;
  /** Total valid reps counted since the last reset. */
  reps: number;
  /** Rejected attempts since the last reset. */
  invalidReps: number;
  /** Total hold time in ms since the last reset. */
  elapsedMs: number;
  /** Human-readable text for the UI (already written for the user). */
  message: string | null;
  /** Why a rep was rejected, when type === 'invalid'. */
  invalidReason?: InvalidReason;
  metrics: FrameMetrics | null;
}

export type InvalidReason =
  | 'not-deep-enough'
  | 'too-fast'
  | 'body-not-straight'
  | 'unstable-camera'
  | 'tracking-lost'
  | 'depth-not-measured';

export interface PushupDetectorConfig {
  /** Arm must bend to at least this angle to count as a full push-up. */
  minElbowAngle: number;
  /** Arms are treated as "extended" at or above this angle. */
  maxElbowAngle: number;
  /** Crossing below this angle starts the descent. */
  downElbowAngle: number;
  /** While pushing back up, the arm must pass this before a rep can complete. */
  upElbowAngle: number;
  /** Leaving the BOTTOM phase requires rising above this angle. */
  bottomExitElbowAngle: number;
  /** Allow the body this many degrees away from perfectly straight. */
  alignmentTolerance: number;
  /** How far the shoulders must drop, as a fraction of frame height. */
  minDepthDelta: number;
  /** How far the hips must drop too - this is what blocks "head-bobbing" cheats. */
  minHipDepthDelta: number;
  /** A rep faster than this cannot be a real push-up. */
  minRepDurationMs: number;
  /** A rep slower than this is considered abandoned. */
  maxRepDurationMs: number;
  /** Minimum wait between two counted reps. */
  cooldownMs: number;
  /** How long the user must hold the bottom position. */
  minBottomHoldMs: number;
  /** Joints below this visibility are ignored. */
  confidenceThreshold: number;
  /** Smoothing factor for landmarks: 0 = frozen, 1 = no smoothing. */
  smoothingAlpha: number;
  /** Consecutive frames required before accepting a phase change (debouncing). */
  minFramesInState: number;
  /** A single-frame jump bigger than this (in frame heights) means the camera moved. */
  maxFrameJump: number;
  /** After an unstable frame, ignore input for this long. */
  unstableCooldownMs: number;
  /**
   * How long the body must appear in the frame (2D shoulder-to-ankle distance,
   * as a fraction of frame width/height) to prove the whole body is in shot.
   */
  minBodySpan: number;
  /** Require the wrists to be at or below shoulder height (plank, not standing). */
  requireWristBelowShoulder: boolean;
}

export const DEFAULT_CONFIG: PushupDetectorConfig = {
  minElbowAngle: 100,
  maxElbowAngle: 158,
  downElbowAngle: 132,
  upElbowAngle: 150,
  bottomExitElbowAngle: 116,
  alignmentTolerance: 35,
  minDepthDelta: 0.05,
  minHipDepthDelta: 0.022,
  minRepDurationMs: 650,
  maxRepDurationMs: 15000,
  cooldownMs: 320,
  minBottomHoldMs: 55,
  confidenceThreshold: 0.5,
  smoothingAlpha: 0.45,
  minFramesInState: 2,
  maxFrameJump: 0.3,
  unstableCooldownMs: 550,
  minBodySpan: 0.22,
  requireWristBelowShoulder: true,
};

/**
 * Tuning presets. Exposed in the workout screen under "Detection settings" so
 * you can adjust difficulty live without editing code.
 */
export const CONFIG_PRESETS: Record<string, { label: string; description: string; overrides: Partial<PushupDetectorConfig> }> = {
  beginner: {
    label: 'Beginner / easy',
    description: 'Accepts shallower reps. Good for knee push-ups or when you are just starting.',
    overrides: {
      minElbowAngle: 115,
      downElbowAngle: 140,
      upElbowAngle: 145,
      bottomExitElbowAngle: 128,
      minDepthDelta: 0.03,
      minHipDepthDelta: 0.012,
      alignmentTolerance: 55,
      minBodySpan: 0.17,
      minRepDurationMs: 500,
    },
  },
  standard: {
    label: 'Standard (recommended)',
    description: 'Full-depth push-ups with a straight body. The default.',
    overrides: {},
  },
  strict: {
    label: 'Strict / competition',
    description: 'Demands deep reps, a very straight body and a slower tempo.',
    overrides: {
      minElbowAngle: 90,
      downElbowAngle: 125,
      bottomExitElbowAngle: 110,
      alignmentTolerance: 28,
      minDepthDelta: 0.065,
      minHipDepthDelta: 0.03,
      minRepDurationMs: 900,
      cooldownMs: 450,
      minBodySpan: 0.28,
    },
  },
};
