import {
  DEFAULT_CONFIG,
  LM,
  type DetectorEvent,
  type FrameMetrics,
  type InvalidReason,
  type Landmarks,
  type PushupDetectorConfig,
  type PushupPhase,
  type Side,
} from './types';
import {
  allLandmarksInFrame,
  angleAt,
  bestArm,
  bestLeg,
  bodySpan,
  frameJump,
  smoothLandmarks,
  trackingConfidence,
} from './geometry';

/**
 * ============================================================================
 *  THE PUSH-UP DETECTOR
 * ============================================================================
 *
 * This is the part of PushUp League that actually decides whether a push-up
 * happened. It is intentionally NOT a threshold on a single number - that
 * approach counts every wobble of the camera.
 *
 * Instead it runs a debounced state machine:
 *
 *        ┌──────────────────────────── count +1 ──────────────────────────┐
 *        │                                                                │
 *        v                                                                │
 *     ┌──────┐   arms extend    ┌───────┐   elbow bends   ┌──────┐   depth  ┌────────┐   push up   ┌────┐
 *     │ IDLE │ ───────────────> │ READY │ ──────────────> │ DOWN │ ───────> │ BOTTOM │ ──────────> │ UP │
 *     └──────┘                  └───────┘                 └──────┘          └────────┘             └────┘
 *        ^                          ^                         │                                        │
 *        │                          └──── "not deep enough" ──┘   (goes back up without reaching depth)
 *        └── tracking lost / camera knocked ──────────────────────────────────────────────────────────────
 *
 * A repetition is only counted when ALL of the following are true:
 *   1. The body was locked in a plank at the top (arms extended, body straight).
 *   2. The elbow bent past `minElbowAngle`.
 *   3. The shoulders physically dropped by `minDepthDelta`.
 *   4. The hips physically dropped by `minHipDepthDelta`  <-- blocks head-bobbing.
 *   5. The bottom position was held for `minBottomHoldMs`.
 *   6. The arms returned to extended.
 *   7. The whole movement took at least `minRepDurationMs`   <-- blocks spamming.
 *   8. The camera was stable throughout.
 *
 * Every threshold lives in PushupDetectorConfig so you can tune it with real
 * people without touching this file.
 */

interface RepAccumulator {
  startedAt: number;
  minElbowAngle: number;
  maxShoulderY: number;
  minShoulderY: number;
  maxHipY: number;
  minHipY: number;
  reachedBottom: boolean;
  bottomEnteredAt: number | null;
  depthAtBottom: number;
  hipDepthAtBottom: number;
  alignmentSum: number;
  alignmentSamples: number;
}

function emptyRep(now: number, shoulderY: number, hipY: number): RepAccumulator {
  return {
    startedAt: now,
    minElbowAngle: 180,
    maxShoulderY: shoulderY,
    minShoulderY: shoulderY,
    maxHipY: hipY,
    minHipY: hipY,
    reachedBottom: false,
    bottomEnteredAt: null,
    depthAtBottom: 0,
    hipDepthAtBottom: 0,
    alignmentSum: 0,
    alignmentSamples: 0,
  };
}

export class PushupDetector {
  private config: PushupDetectorConfig;

  private smoothed: Landmarks | null = null;
  private rawPrevious: Landmarks | null = null;

  private phase: PushupPhase = 'IDLE';
  private pendingPhase: PushupPhase | null = null;
  private pendingFrames = 0;

  private reps = 0;
  private invalidReps = 0;
  private startedAt: number | null = null;
  private lastCountAt = Number.NEGATIVE_INFINITY;
  private lastInvalidAt = Number.NEGATIVE_INFINITY;
  private unstableUntil = 0;
  private lowConfidenceSince: number | null = null;

  /** Shoulder/hip height while standing at the top of the movement. */
  private topShoulderY: number | null = null;
  private topHipY: number | null = null;

  private rep: RepAccumulator | null = null;
  private lastMetrics: FrameMetrics | null = null;
  private lastMessage: string | null = null;
  /** Set when a rep is rejected mid-frame so update() can return it. */
  private pendingEvent: DetectorEvent | null = null;

  constructor(config: Partial<PushupDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getConfig(): PushupDetectorConfig {
    return { ...this.config };
  }

  /** Live tuning - safe to call while a workout is running. */
  setConfig(patch: Partial<PushupDetectorConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  getPhase(): PushupPhase {
    return this.phase;
  }

  getReps(): number {
    return this.reps;
  }

  getInvalidReps(): number {
    return this.invalidReps;
  }

  getMetrics(): FrameMetrics | null {
    return this.lastMetrics;
  }

  /**
   * 0..1 quality score for the session so far. The server stores this with the
   * session and uses it to flag suspicious workouts.
   */
  getValidationScore(): number {
    const attempts = this.reps + this.invalidReps;
    if (attempts === 0) return 1;
    return Math.max(0, Math.min(1, this.reps / attempts));
  }

  /** How deep the current repetition is, as a multiple of the required depth. */
  getRepProgress(): number {
    const rep = this.rep;
    if (!rep || this.topShoulderY === null) return 0;
    const descent = Math.max(0, rep.maxShoulderY - this.topShoulderY);
    const required = Math.max(1e-6, this.config.minDepthDelta);
    return Math.max(0, Math.min(1.6, descent / required));
  }

  reset(): void {
    this.smoothed = null;
    this.rawPrevious = null;
    this.phase = 'IDLE';
    this.pendingPhase = null;
    this.pendingFrames = 0;
    this.reps = 0;
    this.invalidReps = 0;
    this.startedAt = null;
    this.lastCountAt = Number.NEGATIVE_INFINITY;
    this.lastInvalidAt = Number.NEGATIVE_INFINITY;
    this.unstableUntil = 0;
    this.lowConfidenceSince = null;
    this.topShoulderY = null;
    this.topHipY = null;
    this.rep = null;
    this.lastMetrics = null;
    this.lastMessage = null;
  }

  /**
   * Feed one camera frame in. Returns an event describing what (if anything)
   * just happened. Call it once per animation frame.
   *
   * @param landmarks 33 MediaPipe pose landmarks, or null when no person was found.
   * @param timestampMs  a monotonically increasing timestamp (performance.now()).
   */
  update(landmarks: Landmarks | null, timestampMs: number): DetectorEvent {
    if (this.startedAt === null) this.startedAt = timestampMs;

    if (!landmarks || landmarks.length < 29) {
      return this.handleNoPose(timestampMs);
    }

    // --- 1. Reject frames where the camera itself jumped -------------------
    const jump = frameJump(this.rawPrevious, landmarks);
    this.rawPrevious = landmarks.map((p) => ({ ...p }));
    if (jump > this.config.maxFrameJump) {
      this.unstableUntil = timestampMs + this.config.unstableCooldownMs;
      this.abandonRep(timestampMs);
      this.setPhase('IDLE', timestampMs);
      return this.emit('unstable', timestampMs, 'Camera moved - hold your phone steady.', null, 'unstable-camera');
    }
    if (timestampMs < this.unstableUntil) {
      return this.emit('unstable', timestampMs, 'Steady the camera...', null, 'unstable-camera');
    }

    // --- 2. Smooth the joints so noise cannot fake a rep -------------------
    this.smoothed = smoothLandmarks(this.smoothed, landmarks, this.config.smoothingAlpha);
    const points = this.smoothed;

    // --- 3. Measure the body ----------------------------------------------
    const confidence = trackingConfidence(points);
    const arm = bestArm(points);
    const leg = bestLeg(points);
    const elbowAngle = angleAt(arm.shoulder, arm.elbow, arm.wrist);
    const bodyAlignment = angleAt(leg.shoulder, leg.hip, leg.ankle);
    const alignmentOk = bodyAlignment >= 180 - this.config.alignmentTolerance;
    const span = bodySpan(points);
    const shoulderY = arm.shoulder.y;
    const hipY = leg.hip.y;

    const metrics: FrameMetrics = {
      elbowAngle,
      side: arm.side as Side,
      bodyAlignment,
      alignmentOk,
      confidence,
      shoulderY,
      hipY,
      wristY: arm.wrist.y,
      bodySpan: span,
      unstable: false,
    };
    this.lastMetrics = metrics;

    // --- 4. Refuse to judge when we cannot see the whole body -------------
    if (confidence < this.config.confidenceThreshold) {
      if (this.lowConfidenceSince === null) this.lowConfidenceSince = timestampMs;
      this.abandonRep(timestampMs);
      this.setPhase('IDLE', timestampMs);
      return this.emit('low-confidence', timestampMs, this.confidenceHint(metrics), metrics);
    }
    this.lowConfidenceSince = null;

    // --- 5. Run the state machine -----------------------------------------
    this.pendingEvent = null;
    switch (this.phase) {
      case 'IDLE':
        this.stepIdle(timestampMs, metrics, points);
        break;
      case 'READY':
        this.stepReady(timestampMs, metrics);
        break;
      case 'DOWN':
        this.stepDown(timestampMs, metrics);
        break;
      case 'BOTTOM':
        this.stepBottom(timestampMs, metrics);
        break;
      case 'UP':
        this.stepUp(timestampMs, metrics);
        break;
    }

    if (this.pendingEvent) {
      const event = this.pendingEvent;
      this.pendingEvent = null;
      return event;
    }

    return this.emit(this.eventTypeForPhase(), timestampMs, this.lastMessage, metrics);
  }

  // -------------------------------------------------------------------------
  // Phase handlers
  // -------------------------------------------------------------------------

  private stepIdle(now: number, metrics: FrameMetrics, points: Landmarks): void {
    if (!this.isTopPosition(metrics)) {
      this.pendingPhase = null;
      this.pendingFrames = 0;
      this.lastMessage = this.positionHint(metrics);
      return;
    }
    if (!this.confirm('READY')) return;

    this.setPhase('READY', now);
    this.topShoulderY = metrics.shoulderY;
    this.topHipY = metrics.hipY;
    this.lastMessage = 'Ready - go!';
    void points;
  }

  private stepReady(now: number, metrics: FrameMetrics): void {
    if (!this.isTopPosition(metrics)) {
      // Track the baseline a little even if the body is not perfect, but only
      // when the arms really are extended, otherwise the baseline drifts down
      // and every later rep looks shallow.
      if (metrics.elbowAngle >= this.config.maxElbowAngle && this.topShoulderY !== null) {
        this.topShoulderY = this.topShoulderY * 0.88 + metrics.shoulderY * 0.12;
        this.topHipY = (this.topHipY ?? metrics.hipY) * 0.88 + metrics.hipY * 0.12;
      }
      this.lastMessage = this.positionHint(metrics);
    } else if (this.topShoulderY !== null) {
      // Gentle re-baselining so slow drift of the phone does not break depth.
      this.topShoulderY = this.topShoulderY * 0.94 + metrics.shoulderY * 0.06;
      this.topHipY = (this.topHipY ?? metrics.hipY) * 0.94 + metrics.hipY * 0.06;
    }

    if (metrics.elbowAngle < this.config.downElbowAngle) {
      if (!this.confirm('DOWN')) return;
      this.setPhase('DOWN', now);
      this.rep = emptyRep(now, metrics.shoulderY, metrics.hipY);
      this.lastMessage = 'Down...';
    }
  }

  private stepDown(now: number, metrics: FrameMetrics): void {
    const rep = this.rep ?? (this.rep = emptyRep(now, metrics.shoulderY, metrics.hipY));
    this.accumulate(rep, metrics);
    this.lastMessage = this.depthMessage();

    const depth = this.shoulderDepth(rep);
    const hipDepth = this.hipDepth(rep);
    const hitDepth =
      metrics.elbowAngle <= this.config.minElbowAngle &&
      depth >= this.config.minDepthDelta &&
      hipDepth >= this.config.minHipDepthDelta;

    if (hitDepth) {
      if (!this.confirm('BOTTOM')) return;
      rep.reachedBottom = true;
      rep.bottomEnteredAt = now;
      rep.depthAtBottom = depth;
      rep.hipDepthAtBottom = hipDepth;
      this.setPhase('BOTTOM', now);
      this.lastMessage = 'Bottom - now push!';
      return;
    }

    // Came back up without reaching depth: a rejected (half) repetition.
    if (metrics.elbowAngle >= this.config.upElbowAngle) {
      this.reject(now, 'not-deep-enough', 'Invalid rep - go all the way down.');
      return;
    }

    if (now - rep.startedAt > this.config.maxRepDurationMs) {
      this.reject(now, 'depth-not-measured', 'Rep timed out - start again from the top.');
    }
  }

  private stepBottom(now: number, metrics: FrameMetrics): void {
    const rep = this.rep;
    if (!rep || rep.bottomEnteredAt === null) {
      this.setPhase('UP', now);
      return;
    }
    this.accumulate(rep, metrics);
    this.lastMessage = 'Bottom - now push!';

    if (metrics.elbowAngle < this.config.minElbowAngle) return; // still resting at the bottom
    if (now - rep.bottomEnteredAt < this.config.minBottomHoldMs) return;
    if (metrics.elbowAngle < this.config.bottomExitElbowAngle) return;

    this.setPhase('UP', now);
    this.lastMessage = 'Up!';
  }

  private stepUp(now: number, metrics: FrameMetrics): void {
    const rep = this.rep;
    if (!rep) {
      this.setPhase('READY', now);
      return;
    }
    this.accumulate(rep, metrics);

    // Went back down again - that is fine, keep waiting for the top.
    if (metrics.elbowAngle < this.config.minElbowAngle) {
      this.setPhase('BOTTOM', now);
      rep.bottomEnteredAt = now;
      return;
    }

    if (metrics.elbowAngle < this.config.upElbowAngle) {
      this.lastMessage = 'Push all the way up!';
      if (now - rep.startedAt > this.config.maxRepDurationMs) {
        this.reject(now, 'depth-not-measured', 'Rep timed out - start again from the top.');
      }
      return;
    }

    // Arms are extended again: decide whether this rep is legitimate.
    const duration = now - rep.startedAt;
    const avgAlignment = rep.alignmentSamples > 0 ? rep.alignmentSum / rep.alignmentSamples : metrics.bodyAlignment;

    if (!rep.reachedBottom) {
      this.reject(now, 'not-deep-enough', 'Invalid rep - go all the way down.');
      return;
    }
    if (duration < this.config.minRepDurationMs) {
      this.reject(now, 'too-fast', 'Invalid rep - too fast to be real.');
      return;
    }
    if (avgAlignment < 180 - this.config.alignmentTolerance) {
      this.reject(now, 'body-not-straight', 'Invalid rep - keep your body straight.');
      return;
    }
    if (now - this.lastCountAt < this.config.cooldownMs) {
      this.reject(now, 'too-fast', 'Invalid rep - slow down a little.');
      return;
    }

    this.reps += 1;
    this.lastCountAt = now;
    this.rep = null;
    this.setPhase('READY', now);
    this.topShoulderY = metrics.shoulderY;
    this.topHipY = metrics.hipY;
    this.lastMessage = null;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private accumulate(rep: RepAccumulator, metrics: FrameMetrics): void {
    rep.minElbowAngle = Math.min(rep.minElbowAngle, metrics.elbowAngle);
    rep.maxShoulderY = Math.max(rep.maxShoulderY, metrics.shoulderY);
    rep.minShoulderY = Math.min(rep.minShoulderY, metrics.shoulderY);
    rep.maxHipY = Math.max(rep.maxHipY, metrics.hipY);
    rep.minHipY = Math.min(rep.minHipY, metrics.hipY);
    rep.alignmentSum += metrics.bodyAlignment;
    rep.alignmentSamples += 1;
  }

  /** How far the shoulders have dropped below the top position. */
  private shoulderDepth(rep: RepAccumulator): number {
    if (this.topShoulderY === null) return 0;
    return rep.maxShoulderY - this.topShoulderY;
  }

  private hipDepth(rep: RepAccumulator): number {
    if (this.topHipY === null) return 0;
    return rep.maxHipY - this.topHipY;
  }

  private isTopPosition(metrics: FrameMetrics): boolean {
    if (metrics.elbowAngle < this.config.maxElbowAngle) return false;
    if (!metrics.alignmentOk) return false;
    if (metrics.bodySpan < this.config.minBodySpan) return false;
    if (this.config.requireWristBelowShoulder && metrics.wristY < metrics.shoulderY - 0.02) return false;
    if (this.smoothed && !allLandmarksInFrame(this.smoothed, 0.03)) return false;
    return true;
  }

  private depthMessage(): string {
    const progress = this.getRepProgress();
    if (progress < 0.5) return 'Keep going down...';
    if (progress < 1) return 'Almost there - lower!';
    return 'Deep enough - push up!';
  }

  private positionHint(metrics: FrameMetrics): string {
    if (metrics.bodySpan < this.config.minBodySpan) return 'Move the camera back so your whole body fits in view.';
    if (!metrics.alignmentOk) return 'Straighten your body into a plank.';
    if (metrics.elbowAngle < this.config.maxElbowAngle) return 'Extend your arms at the top to begin.';
    if (this.config.requireWristBelowShoulder && metrics.wristY < metrics.shoulderY - 0.02) {
      return 'Get into a push-up position - hands on the floor below your shoulders.';
    }
    return 'Get into a plank position facing the camera.';
  }

  private confidenceHint(metrics: FrameMetrics): string {
    if (metrics.bodySpan < this.config.minBodySpan) return "Can't see your full body. Move back into frame.";
    return "Can't see your full body. Move back into frame.";
  }

  /**
   * Debouncing: a phase change is only accepted after it has been true for
   * `minFramesInState` consecutive frames. With minFramesInState = 2 a single
   * glitched frame can never move the state machine.
   */
  private confirm(next: PushupPhase): boolean {
    if (this.pendingPhase === next) {
      this.pendingFrames += 1;
    } else {
      this.pendingPhase = next;
      this.pendingFrames = 1;
    }
    if (this.pendingFrames >= Math.max(1, this.config.minFramesInState)) {
      this.pendingPhase = null;
      this.pendingFrames = 0;
      return true;
    }
    return false;
  }

  private setPhase(next: PushupPhase, now: number): void {
    if (this.phase === next) return;
    this.phase = next;
    this.pendingPhase = null;
    this.pendingFrames = 0;
    void now;
  }

  private abandonRep(now: number): void {
    void now;
    this.rep = null;
  }

  /** Reject the current repetition and return to READY (or IDLE). */
  private reject(now: number, reason: InvalidReason, message: string): void {
    this.rep = null;
    this.setPhase('READY', now);
    // Rate-limit the "Invalid rep" popups so an unsteady camera cannot spam them.
    if (now - this.lastInvalidAt > 900) {
      this.invalidReps += 1;
      this.lastInvalidAt = now;
      this.pendingEvent = this.emit('invalid', now, message, this.lastMetrics, reason);
    }
    this.lastMessage = message;
  }

  private handleNoPose(now: number): DetectorEvent {
    this.smoothed = null;
    const wasActive = this.phase !== 'IDLE';
    if (wasActive) {
      this.rep = null;
      this.setPhase('IDLE', now);
      this.lastMessage = "Can't see your full body. Move back into frame.";
      return this.emit('low-confidence', now, this.lastMessage, null);
    }
    this.setPhase('IDLE', now);
    return this.emit('idle', now, 'Looking for you...', null);
  }

  private eventTypeForPhase(): DetectorEvent['type'] {
    switch (this.phase) {
      case 'READY':
        return this.lastMessage === null ? 'count' : 'ready';
      case 'DOWN':
        return 'down';
      case 'BOTTOM':
        return 'bottom';
      case 'UP':
        return 'up';
      default:
        return 'idle';
    }
  }

  private emit(
    type: DetectorEvent['type'],
    now: number,
    message: string | null,
    metrics: FrameMetrics | null,
    invalidReason?: InvalidReason,
  ): DetectorEvent {
    return {
      type,
      phase: this.phase,
      reps: this.reps,
      invalidReps: this.invalidReps,
      elapsedMs: this.startedAt === null ? 0 : now - this.startedAt,
      message,
      invalidReason,
      metrics,
    };
  }
}

/**
 * READINESS CHECK for the setup screen.
 *
 * Used before a workout begins to answer "is the phone in a good spot?".
 * Each check is explained in plain language so the user knows what to fix.
 */
export interface ReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  hint: string;
}

export interface ReadinessResult {
  ready: boolean;
  checks: ReadinessCheck[];
  metrics: FrameMetrics | null;
}

export function evaluateReadiness(
  landmarks: Landmarks | null,
  config: Partial<PushupDetectorConfig> = {},
): ReadinessResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const emptyChecks: ReadinessCheck[] = [
    { id: 'person', label: 'Person detected', ok: false, hint: 'Step into the camera view.' },
    { id: 'fullbody', label: 'Whole body visible', ok: false, hint: 'Head, shoulders, hips, knees and feet must all be in shot.' },
    { id: 'lighting', label: 'Enough light', ok: false, hint: 'Turn on a light or face a window.' },
    { id: 'plank', label: 'Plank position detected', ok: false, hint: 'Get down into a push-up position.' },
  ];

  if (!landmarks || landmarks.length < 29) {
    return { ready: false, checks: emptyChecks, metrics: null };
  }

  const confidence = trackingConfidence(landmarks);
  const arm = bestArm(landmarks);
  const leg = bestLeg(landmarks);
  const elbowAngle = angleAt(arm.shoulder, arm.elbow, arm.wrist);
  const bodyAlignment = angleAt(leg.shoulder, leg.hip, leg.ankle);
  const alignmentOk = bodyAlignment >= 180 - cfg.alignmentTolerance;
  const span = bodySpan(landmarks);
  const inFrame = allLandmarksInFrame(landmarks, 0.02);

  const metrics: FrameMetrics = {
    elbowAngle,
    side: arm.side as Side,
    bodyAlignment,
    alignmentOk,
    confidence,
    shoulderY: arm.shoulder.y,
    hipY: leg.hip.y,
    wristY: arm.wrist.y,
    bodySpan: span,
    unstable: false,
  };

  const checks: ReadinessCheck[] = [
    {
      id: 'person',
      label: 'Person detected',
      ok: confidence > 0.25,
      hint: 'Step into the camera view.',
    },
    {
      id: 'fullbody',
      label: 'Whole body visible',
      ok: inFrame && confidence >= cfg.confidenceThreshold && span >= cfg.minBodySpan,
      hint: span < cfg.minBodySpan
        ? 'Move the camera further away - your feet or head are cut off.'
        : 'Move so your head, shoulders, hips, knees and feet are all in shot.',
    },
    {
      id: 'lighting',
      label: 'Enough light',
      ok: confidence >= 0.7,
      hint: 'Turn on a light or face a window - the camera is struggling to see you.',
    },
    {
      id: 'plank',
      label: 'Plank position detected',
      ok: alignmentOk && metrics.wristY >= arm.shoulder.y - 0.12,
      hint: 'Lie down in a push-up position with your hands below your shoulders.',
    },
  ];

  return { ready: checks.every((c) => c.ok), checks, metrics };
}

export { DEFAULT_CONFIG };
export * from './types';
