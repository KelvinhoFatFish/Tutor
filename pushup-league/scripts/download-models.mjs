// Downloads the MediaPipe pose model into public/models/ so the app can serve
// it itself. Re-run any time with:  node scripts/download-models.mjs
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const MODELS = [
  {
    file: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    required: true,
  },
  {
    file: 'pose_landmarker_full.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
    required: false,
  },
];

const outDir = path.join(process.cwd(), 'public', 'models');
await mkdir(outDir, { recursive: true });

let failures = 0;

for (const model of MODELS) {
  const target = path.join(outDir, model.file);
  try {
    const existing = await stat(target).catch(() => null);
    if (existing && existing.size > 100_000) {
      console.log(`[skip] ${model.file} already present (${(existing.size / 1e6).toFixed(2)} MB)`);
      continue;
    }
    console.log(`[get ] ${model.file}`);
    const res = await fetch(model.url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 100_000) throw new Error(`suspiciously small (${bytes.length} bytes)`);
    await writeFile(target, bytes);
    console.log(`[ok  ] ${model.file} (${(bytes.length / 1e6).toFixed(2)} MB)`);
  } catch (error) {
    failures += model.required ? 1 : 0;
    console.error(`[fail] ${model.file}: ${error.message}`);
    if (model.required) {
      console.error('       The lite model is required. Check your internet connection and retry.');
    }
  }
}

if (failures > 0) {
  console.error('\nOne or more required models could not be downloaded.');
  process.exit(1);
}
console.log('\nAll required models are in place.');
