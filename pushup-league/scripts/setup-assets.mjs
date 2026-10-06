/**
 * SETUP ASSETS
 * ============
 * Prepares the two files the pose detector needs at runtime:
 *
 *   1. The MediaPipe WebAssembly runtime -> copied out of node_modules into
 *      public/mediapipe/wasm/ so the browser downloads it from OUR site.
 *   2. The pose landmark model (.task) -> downloaded from Google once and
 *      saved into public/models/.
 *
 * Because both are served from our own domain, the camera feed never has to
 * leave the device and the app keeps working offline once loaded. There is no
 * third-party request at runtime.
 *
 * This runs automatically before `npm run dev` and `npm run build`, and is
 * safe to run again at any time - existing files are skipped.
 */
import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

// --- 1. WebAssembly runtime -------------------------------------------------
const wasmSource = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmTarget = path.join(root, 'public', 'mediapipe', 'wasm');

try {
  await mkdir(wasmTarget, { recursive: true });
  await cp(wasmSource, wasmTarget, { recursive: true });
  console.log('[ok  ] MediaPipe WebAssembly runtime copied to public/mediapipe/wasm');
} catch (error) {
  console.error(`[fail] Could not copy the MediaPipe runtime: ${error.message}`);
  console.error('       Did you run "npm install" first?');
  process.exit(1);
}

// --- 2. Pose model ----------------------------------------------------------
const modelTarget = path.join(root, 'public', 'models', 'pose_landmarker_lite.task');
const existing = await stat(modelTarget).catch(() => null);

if (existing && existing.size > 100_000) {
  console.log(`[skip] Pose model already downloaded (${(existing.size / 1e6).toFixed(2)} MB)`);
} else {
  console.log('[get ] Downloading the pose model (about 6 MB, one time only)...');
  await import('./download-models.mjs');
}
