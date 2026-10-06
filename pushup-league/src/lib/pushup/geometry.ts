import type { Landmarks, Point, Side } from './types';
import { LM, REQUIRED_LANDMARKS } from './types';

/**
 * GEOMETRY HELPERS
 * ----------------
 * Small, dependency-free maths used by the push-up detector. Everything works
 * in "normalised" coordinates: x and y are 0..1 across the camera frame, y
 * increasing downwards (the same convention MediaPipe uses).
 */

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

/**
 * The angle at joint `b`, formed by the lines b->a and b->c, in degrees.
 * 180 means a, b and c are in a straight line; 0 means fully folded.
 */
export function angleAt(a: Point, b: Point, c: Point): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const len1 = Math.hypot(v1x, v1y);
  const len2 = Math.hypot(v2x, v2y);
  if (len1 < 1e-6 || len2 < 1e-6) return 180;
  const dot = v1x * v2x + v1y * v2y;
  const cos = Math.max(-1, Math.min(1, dot / (len1 * len2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Exponential moving average - the cheapest effective way to de-noise a joint. */
export function smoothPoint(previous: Point | undefined, next: Point, alpha: number): Point {
  if (!previous) return { ...next };
  const a = Math.max(0, Math.min(1, alpha));
  return {
    x: previous.x + (next.x - previous.x) * a,
    y: previous.y + (next.y - previous.y) * a,
    z: (previous.z ?? 0) + ((next.z ?? 0) - (previous.z ?? 0)) * a,
    // Fail closed: if neither frame reports how confident the model is, treat
    // the joint as untrusted rather than silently assuming it is perfect.
    visibility: next.visibility ?? previous.visibility ?? 0,
  };
}

export function smoothLandmarks(
  previous: Landmarks | null,
  next: Landmarks,
  alpha: number,
): Landmarks {
  if (!previous || previous.length !== next.length) return next.map((p) => ({ ...p }));
  return next.map((point, index) => smoothPoint(previous[index], point, alpha));
}

export function visibilityOf(landmarks: Landmarks, index: number): number {
  return landmarks[index]?.visibility ?? 0;
}

/**
 * Some builds of the pose model omit the `visibility` field entirely. When that
 * happens for *every* landmark we fall back to trusting the geometry checks
 * alone; when it is present for even one landmark we require it everywhere.
 */
export function hasVisibilityData(landmarks: Landmarks): boolean {
  return landmarks.some((p) => typeof p?.visibility === 'number');
}

/**
 * Tracking confidence: the lowest visibility among the joints we require.
 * Using the *minimum* rather than the average is deliberate - one missing
 * ankle means we genuinely cannot judge the rep.
 */
export function trackingConfidence(landmarks: Landmarks): number {
  if (!hasVisibilityData(landmarks)) return 1; // model gave us no confidence data at all
  let worst = 1;
  for (const index of REQUIRED_LANDMARKS) {
    const v = visibilityOf(landmarks, index);
    if (v < worst) worst = v;
  }
  return worst;
}

export function averageVisibility(landmarks: Landmarks, indices: number[]): number {
  let sum = 0;
  for (const index of indices) sum += visibilityOf(landmarks, index);
  return sum / Math.max(1, indices.length);
}

export interface ArmChain {
  side: Side;
  shoulder: Point;
  elbow: Point;
  wrist: Point;
  /** Lowest visibility in the chain. */
  visibility: number;
}

export interface LegChain {
  side: Side;
  shoulder: Point;
  hip: Point;
  knee: Point;
  ankle: Point;
  visibility: number;
}

/**
 * Builds both arm chains. The detector then picks whichever side the camera can
 * actually see - when you film yourself from the side, one arm hides the other.
 */
export function buildArms(landmarks: Landmarks): ArmChain[] {
  const sides: Array<{ side: Side; s: number; e: number; w: number }> = [
    { side: 'left', s: LM.LEFT_SHOULDER, e: LM.LEFT_ELBOW, w: LM.LEFT_WRIST },
    { side: 'right', s: LM.RIGHT_SHOULDER, e: LM.RIGHT_ELBOW, w: LM.RIGHT_WRIST },
  ];
  return sides.map(({ side, s, e, w }) => ({
    side,
    shoulder: landmarks[s],
    elbow: landmarks[e],
    wrist: landmarks[w],
    visibility: Math.min(visibilityOf(landmarks, s), visibilityOf(landmarks, e), visibilityOf(landmarks, w)),
  }));
}

export function buildLegs(landmarks: Landmarks): LegChain[] {
  const sides: Array<{ side: Side; s: number; h: number; k: number; a: number }> = [
    { side: 'left', s: LM.LEFT_SHOULDER, h: LM.LEFT_HIP, k: LM.LEFT_KNEE, a: LM.LEFT_ANKLE },
    { side: 'right', s: LM.RIGHT_SHOULDER, h: LM.RIGHT_HIP, k: LM.RIGHT_KNEE, a: LM.RIGHT_ANKLE },
  ];
  return sides.map(({ side, s, h, k, a }) => ({
    side,
    shoulder: landmarks[s],
    hip: landmarks[h],
    knee: landmarks[k],
    ankle: landmarks[a],
    visibility: Math.min(
      visibilityOf(landmarks, s),
      visibilityOf(landmarks, h),
      visibilityOf(landmarks, k),
      visibilityOf(landmarks, a),
    ),
  }));
}

/** Picks the arm chain with the best visibility. */
export function bestArm(landmarks: Landmarks): ArmChain {
  const [left, right] = buildArms(landmarks);
  return left.visibility >= right.visibility ? left : right;
}

export function bestLeg(landmarks: Landmarks): LegChain {
  const [left, right] = buildLegs(landmarks);
  return left.visibility >= right.visibility ? left : right;
}

/**
 * Mean movement of all landmarks between two frames, in frame heights.
 * A large jump means the camera itself moved (phone knocked over, hand over the
 * lens) rather than the person doing a controlled repetition.
 */
export function frameJump(previous: Landmarks | null, next: Landmarks): number {
  if (!previous || previous.length !== next.length) return 0;
  let total = 0;
  let counted = 0;
  for (let i = 0; i < next.length; i += 1) {
    total += Math.hypot(next[i].x - previous[i].x, next[i].y - previous[i].y);
    counted += 1;
  }
  return counted === 0 ? 0 : total / counted;
}

/**
 * How long the person's body appears in the frame, measured as the 2D distance
 * from shoulder to ankle.
 *
 * This deliberately uses the full 2D distance rather than just the vertical
 * difference: when you prop the phone on the floor to your side, your body lies
 * roughly *across* the picture, so a purely vertical measure would read as
 * almost zero even though your whole body is clearly visible.
 */
export function bodySpan(landmarks: Landmarks): number {
  const legs = buildLegs(landmarks).filter((l) => l.visibility > 0.3);
  if (legs.length === 0) return 0;
  const spans = legs.map((leg) => distance(leg.shoulder, leg.ankle));
  return Math.max(...spans);
}

/** True when every required joint sits inside the frame (with a small margin). */
export function allLandmarksInFrame(landmarks: Landmarks, margin = 0.02): boolean {
  return REQUIRED_LANDMARKS.every((index) => {
    const p = landmarks[index];
    if (!p) return false;
    return p.x >= -margin && p.x <= 1 + margin && p.y >= -margin && p.y <= 1 + margin;
  });
}
