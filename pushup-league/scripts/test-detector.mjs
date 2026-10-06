/**
 * DETECTOR TEST HARNESS
 * =====================
 * The push-up detector is the most important logic in this app, so it gets a
 * real test. We cannot attach a camera from a terminal, so instead we
 * synthesise the 33 pose landmarks that MediaPipe would produce for a person
 * doing different kinds of movement, and check what the state machine counts.
 *
 * Run it with:  npm run test:detector
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// 1. Compile the detector module to plain JavaScript so Node can run it.
//    (TypeScript is already installed as a dev dependency.)
// ---------------------------------------------------------------------------
const ts = (await import('typescript')).default;
const root = process.cwd();
const srcDir = path.join(root, 'src', 'lib', 'pushup');
const outDir = path.join(root, '.test-build');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const file of fs.readdirSync(srcDir)) {
  if (!file.endsWith('.ts')) continue;
  const source = fs.readFileSync(path.join(srcDir, file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: file,
  });
  fs.writeFileSync(path.join(outDir, file.replace(/\.ts$/, '.js')), outputText);
}

const require = createRequire(pathToFileURL(path.join(root, 'package.json')).href);
const { PushupDetector, DEFAULT_CONFIG } = require(path.join(outDir, 'detector.js'));

// ---------------------------------------------------------------------------
// 2. Synthetic body builder
// ---------------------------------------------------------------------------

const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
};

function makeEmptyBody(visibility = 0.1) {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility }));
}

function angleAt(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Places the elbow so that the angle shoulder-elbow-wrist equals `targetDeg`.
 * Solved with the law of cosines, then verified.
 */
function elbowAt(shoulder, wrist, targetDeg, sideSign = 1) {
  const dx = wrist.x - shoulder.x;
  const dy = wrist.y - shoulder.y;
  const d = Math.hypot(dx, dy);
  const theta = (targetDeg * Math.PI) / 180;
  const link = d / (2 * Math.sin(theta / 2));
  const half = d / 2;
  const sagitta = Math.sqrt(Math.max(0, link * link - half * half));
  const mx = (shoulder.x + wrist.x) / 2;
  const my = (shoulder.y + wrist.y) / 2;
  const px = -dy / d;
  const py = dx / d;
  return { x: mx + px * sagitta * sideSign, y: my + py * sagitta * sideSign, z: 0 };
}

const WRIST_Y = 0.80; // the floor - hands stay planted here
const WRIST_X = 0.34;
const SHOULDER_X = 0.30;

/**
 * Builds one frame of a person in a side-on plank.
 *
 * @param elbowAngle 165 = arms extended, 95 = deep bottom
 * @param bodyY      shoulder/hip/ankle height; larger = closer to the floor
 * @param collapse   when true the body stays high while the elbows bend
 *                   (the "cheat" where only the arms move)
 */
function buildBody({ elbowAngle, bodyY, visibility = 0.95, noise = 0, rand = Math.random }) {
  const lm = makeEmptyBody(visibility);
  const jitter = () => (noise === 0 ? 0 : (rand() * 2 - 1) * noise);
  const point = (x, y) => ({ x: x + jitter(), y: y + jitter(), z: 0, visibility });

  // Torso, hip, knee and ankle all at the same height => perfectly straight body.
  const shoulder = point(SHOULDER_X, bodyY);
  const hip = point(0.55, bodyY);
  const knee = point(0.70, bodyY);
  const ankle = point(0.85, bodyY);
  const wrist = point(WRIST_X, WRIST_Y);
  const elbow = { ...elbowAt(shoulder, wrist, elbowAngle, 1), visibility };

  for (const i of [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER]) lm[i] = { ...shoulder };
  for (const i of [LM.LEFT_HIP, LM.RIGHT_HIP]) lm[i] = { ...hip };
  for (const i of [LM.LEFT_KNEE, LM.RIGHT_KNEE]) lm[i] = { ...knee };
  for (const i of [LM.LEFT_ANKLE, LM.RIGHT_ANKLE]) lm[i] = { ...ankle };
  for (const i of [LM.LEFT_WRIST, LM.RIGHT_WRIST]) lm[i] = { ...wrist };
  for (const i of [LM.LEFT_ELBOW, LM.RIGHT_ELBOW]) lm[i] = { ...elbow };
  lm[LM.NOSE] = { x: 0.22, y: bodyY - 0.05, z: 0, visibility };

  return lm;
}

// ---------------------------------------------------------------------------
// 3. Scenario helpers
// ---------------------------------------------------------------------------

const FRAME_MS = 16.7; // ~60 frames per second

const TOP_ELBOW = 165;
const BOTTOM_ELBOW = 95;
const TOP_Y = 0.55;
const BOTTOM_Y = 0.73;

function lerp(a, b, t) {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/**
 * Yields a frame-by-frame timeline for one repetition.
 * Phases: descend (35%) -> hold at the bottom (18%) -> ascend (47%)
 */
function* repFrames({ durationMs, depthElbow = BOTTOM_ELBOW, depthY = BOTTOM_Y, collapse = false, noise = 0, rand = Math.random }) {
  const steps = Math.max(3, Math.round(durationMs / FRAME_MS));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    let elbow;
    let bodyY;
    if (t < 0.35) {
      const k = t / 0.35;
      elbow = lerp(TOP_ELBOW, depthElbow, k);
      bodyY = collapse ? TOP_Y : lerp(TOP_Y, depthY, k);
    } else if (t < 0.53) {
      elbow = depthElbow;
      bodyY = collapse ? TOP_Y : depthY;
    } else {
      const k = (t - 0.53) / 0.47;
      elbow = lerp(depthElbow, TOP_ELBOW, k);
      bodyY = collapse ? TOP_Y : lerp(depthY, TOP_Y, k);
    }
    yield buildBody({ elbowAngle: elbow, bodyY, noise, rand });
  }
}

function* restFrames(durationMs, noise = 0, rand = Math.random) {
  const steps = Math.max(1, Math.round(durationMs / FRAME_MS));
  for (let i = 0; i < steps; i += 1) {
    yield buildBody({ elbowAngle: TOP_ELBOW, bodyY: TOP_Y, noise, rand });
  }
}

/** Feeds a timeline into a fresh detector and returns the final state. */
function run(frames, config = {}, startAt = 1000) {
  const detector = new PushupDetector(config);
  let now = startAt;
  const events = [];
  for (const frame of frames) {
    const event = detector.update(frame, now);
    if (event.type === 'count' || event.type === 'invalid' || event.type === 'unstable') {
      events.push({ type: event.type, reason: event.invalidReason, at: now });
    }
    now += FRAME_MS;
  }
  return {
    detector,
    reps: detector.getReps(),
    invalid: detector.getInvalidReps(),
    score: detector.getValidationScore(),
    events,
  };
}

function* concat(...iterables) {
  for (const it of iterables) yield* it;
}

// ---------------------------------------------------------------------------
// 4. Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// Sanity-check the synthetic body generator before trusting any result.
{
  const probe = buildBody({ elbowAngle: 120, bodyY: 0.6 });
  const measured = angleAt(probe[LM.LEFT_SHOULDER], probe[LM.LEFT_ELBOW], probe[LM.LEFT_WRIST]);
  if (Math.abs(measured - 120) > 0.5) {
    console.error(`Test harness bug: asked for a 120 deg elbow, built ${measured.toFixed(1)} deg`);
    process.exit(1);
  }
  const align = angleAt(probe[LM.LEFT_SHOULDER], probe[LM.LEFT_HIP], probe[LM.LEFT_ANKLE]);
  if (Math.abs(align - 180) > 0.5) {
    console.error(`Test harness bug: straight body measured ${align.toFixed(1)} deg`);
    process.exit(1);
  }
}

console.log('PushUp League - push-up detector tests');
console.log('=====================================');
console.log(`Config: elbow must reach <= ${DEFAULT_CONFIG.minElbowAngle} deg, ` +
  `shoulders must drop >= ${DEFAULT_CONFIG.minDepthDelta}, ` +
  `min rep time ${DEFAULT_CONFIG.minRepDurationMs} ms`);

section('1. Ten clean, full-depth push-ups');
{
  const timeline = [];
  for (let i = 0; i < 10; i += 1) {
    timeline.push(...repFrames({ durationMs: 1400 }));
    timeline.push(...restFrames(600));
  }
  const result = run(timeline);
  check('counts exactly 10 reps', result.reps === 10, `counted ${result.reps}`);
  check('no invalid reps', result.invalid === 0, `${result.invalid} invalid`);
  check('validation score is 1.0', result.score === 1, `score ${result.score}`);
}

section('2. Clean reps with camera noise (smoothing + debouncing)');
{
  // Deterministic pseudo-random noise so the result is reproducible.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const timeline = [];
  for (let i = 0; i < 8; i += 1) {
    timeline.push(...repFrames({ durationMs: 1500, noise: 0.006, rand }));
    timeline.push(...restFrames(600, 0.006, rand));
  }
  const result = run(timeline);
  check('counts exactly 8 noisy reps', result.reps === 8, `counted ${result.reps}`);
  check('rejects nothing', result.invalid === 0, `${result.invalid} invalid`);
}

section('3. Shallow reps (elbow only reaches 128 deg) are rejected');
{
  const timeline = [];
  for (let i = 0; i < 3; i += 1) {
    timeline.push(...repFrames({ durationMs: 1400, depthElbow: 128, depthY: 0.62 }));
    timeline.push(...restFrames(600));
  }
  const result = run(timeline);
  check('counts 0 reps', result.reps === 0, `counted ${result.reps}`);
  check('reports invalid reps', result.invalid >= 1, `${result.invalid} invalid`);
  check(
    'reason is "not deep enough"',
    result.events.some((e) => e.reason === 'not-deep-enough'),
    JSON.stringify(result.events.map((e) => e.reason)),
  );
}

section('4. Arm-only movement (body stays high) is rejected');
{
  const timeline = [];
  for (let i = 0; i < 3; i += 1) {
    timeline.push(...repFrames({ durationMs: 1400, collapse: true }));
    timeline.push(...restFrames(600));
  }
  const result = run(timeline);
  check('counts 0 reps', result.reps === 0, `counted ${result.reps}`);
  check('reports invalid reps', result.invalid >= 1, `${result.invalid} invalid`);
}

section('5. Head-only movement never counts');
{
  const timeline = [];
  for (let i = 0; i < 120; i += 1) {
    const body = buildBody({ elbowAngle: TOP_ELBOW, bodyY: TOP_Y });
    body[LM.NOSE] = { x: 0.22, y: TOP_Y - 0.05 + Math.sin(i / 3) * 0.06, z: 0, visibility: 0.95 };
    timeline.push(body);
  }
  const result = run(timeline);
  check('counts 0 reps', result.reps === 0, `counted ${result.reps}`);
  check('reports no invalid reps either', result.invalid === 0, `${result.invalid} invalid`);
}

section('6. Reps that are too fast are rejected');
{
  // A normal, full-depth rep but with a minimum duration that it cannot satisfy.
  // This proves the minRepDurationMs rule is what rejects it.
  const timeline = [...repFrames({ durationMs: 1400 }), ...restFrames(600)];
  const result = run(timeline, { minRepDurationMs: 3000 });
  check('counts 0 reps', result.reps === 0, `counted ${result.reps}`);
  check(
    'reason is "too fast"',
    result.events.some((e) => e.reason === 'too-fast'),
    JSON.stringify(result.events.map((e) => e.reason)),
  );
}

section('7. Rapid half-oscillations never count');
{
  const timeline = [];
  for (let cycle = 0; cycle < 25; cycle += 1) {
    for (let i = 0; i < 4; i += 1) timeline.push(buildBody({ elbowAngle: 165, bodyY: TOP_Y }));
    for (let i = 0; i < 4; i += 1) timeline.push(buildBody({ elbowAngle: 148, bodyY: TOP_Y + 0.01 }));
  }
  const result = run(timeline);
  check('counts 0 reps', result.reps === 0, `counted ${result.reps}`);
}

section('8. A knocked camera abandons the rep in progress');
{
  const timeline = [];
  timeline.push(...restFrames(300));
  // Start a genuine rep, then the phone gets bumped halfway down.
  const rep = [...repFrames({ durationMs: 1400 })];
  timeline.push(...rep.slice(0, 20));
  const bump = buildBody({ elbowAngle: 140, bodyY: TOP_Y + 0.05 });
  for (let i = 0; i < 3; i += 1) timeline.push(bump.map((p) => ({ ...p, x: p.x + 0.45 })));
  timeline.push(...rep.slice(20));
  timeline.push(...restFrames(600));
  const result = run(timeline);
  check('reports an unstable frame', result.events.some((e) => e.type === 'unstable'));
  check('does not count the interrupted rep', result.reps === 0, `counted ${result.reps}`);
}

section('9. Losing the person mid-rep does not count');
{
  const timeline = [];
  timeline.push(...restFrames(300));
  const rep = [...repFrames({ durationMs: 1400 })];
  timeline.push(...rep.slice(0, 25));
  for (let i = 0; i < 30; i += 1) timeline.push(null); // walked out of shot
  timeline.push(...restFrames(600));
  const result = run(timeline);
  check('counts 0 reps', result.reps === 0, `counted ${result.reps}`);
}

section('10. The cooldown window blocks a second rep inside it');
{
  // Two genuine reps back to back. With the default 320 ms cooldown both are
  // real push-ups and both should count, so we widen the window to prove the
  // guard actually fires.
  const twoReps = [...repFrames({ durationMs: 1000 }), ...repFrames({ durationMs: 1000 }), ...restFrames(600)];
  const normal = run(twoReps);
  check('two real back-to-back reps both count', normal.reps === 2, `counted ${normal.reps}`);

  const guarded = run(twoReps, { cooldownMs: 5000 });
  check('a 5 s cooldown allows only 1 rep', guarded.reps === 1, `counted ${guarded.reps}`);
}

section('11. Body that is not straight is rejected');
{
  // Sag the hips so the hip angle is about 126 deg - well outside the
  // 145 deg minimum the standard configuration allows.
  const timeline = [];
  for (let i = 0; i < 60; i += 1) {
    const body = buildBody({ elbowAngle: TOP_ELBOW, bodyY: TOP_Y });
    body[LM.LEFT_HIP] = { x: 0.55, y: TOP_Y + 0.14, z: 0, visibility: 0.95 };
    body[LM.RIGHT_HIP] = { ...body[LM.LEFT_HIP] };
    timeline.push(body);
  }
  const result = run(timeline);
  check('never reaches READY, counts 0', result.reps === 0, `counted ${result.reps}`);
  check('phase stays IDLE', result.detector.getPhase() === 'IDLE', `phase ${result.detector.getPhase()}`);
}

section('12. Person standing up (not a plank) is not counted');
{
  const timeline = [];
  for (let i = 0; i < 90; i += 1) {
    const body = makeEmptyBody(0.95);
    // Vertical body: shoulders high, ankles low, arms straight down.
    body[LM.LEFT_SHOULDER] = { x: 0.5, y: 0.25, z: 0, visibility: 0.95 };
    body[LM.RIGHT_SHOULDER] = { ...body[LM.LEFT_SHOULDER] };
    body[LM.LEFT_HIP] = { x: 0.5, y: 0.5, z: 0, visibility: 0.95 };
    body[LM.RIGHT_HIP] = { ...body[LM.LEFT_HIP] };
    body[LM.LEFT_KNEE] = { x: 0.5, y: 0.68, z: 0, visibility: 0.95 };
    body[LM.RIGHT_KNEE] = { ...body[LM.LEFT_KNEE] };
    body[LM.LEFT_ANKLE] = { x: 0.5, y: 0.88, z: 0, visibility: 0.95 };
    body[LM.RIGHT_ANKLE] = { ...body[LM.LEFT_ANKLE] };
    body[LM.LEFT_ELBOW] = { x: 0.5, y: 0.4, z: 0, visibility: 0.95 };
    body[LM.RIGHT_ELBOW] = { ...body[LM.LEFT_ELBOW] };
    body[LM.LEFT_WRIST] = { x: 0.5, y: 0.55, z: 0, visibility: 0.95 };
    body[LM.RIGHT_WRIST] = { ...body[LM.LEFT_WRIST] };
    timeline.push(body);
  }
  const result = run(timeline);
  check('counts 0 reps while standing', result.reps === 0, `counted ${result.reps}`);
}

section('13. A long, realistic 25-rep set');
{
  let seed = 987654;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const timeline = [];
  for (let i = 0; i < 25; i += 1) {
    const duration = 1200 + Math.round(rand() * 700);
    timeline.push(...repFrames({ durationMs: duration, depthElbow: 92 + rand() * 8, depthY: 0.71 + rand() * 0.04, noise: 0.005, rand }));
    timeline.push(...restFrames(400 + rand() * 400, 0.005, rand));
  }
  const result = run(timeline);
  check('counts exactly 25 reps', result.reps === 25, `counted ${result.reps}`);
  check('validation score stays above 0.9', result.score > 0.9, `score ${result.score.toFixed(3)}`);
}

section('14. Readiness check reports what to fix');
{
  const { evaluateReadiness } = require(path.join(outDir, 'detector.js'));
  const good = evaluateReadiness(buildBody({ elbowAngle: TOP_ELBOW, bodyY: TOP_Y }));
  check('accepts a good plank position', good.ready === true, JSON.stringify(good.checks.filter((c) => !c.ok)));
  const nothing = evaluateReadiness(null);
  check('rejects "no person"', nothing.ready === false);
  const far = evaluateReadiness(buildBody({ elbowAngle: TOP_ELBOW, bodyY: TOP_Y, visibility: 0.3 }));
  check('rejects a low-confidence pose', far.ready === false);
}

// ---------------------------------------------------------------------------
console.log('\n=====================================');
console.log(`${passed} passed, ${failed} failed`);
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
