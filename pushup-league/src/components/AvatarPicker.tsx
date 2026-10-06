'use client';

import { useRef, useState } from 'react';
import Avatar from './Avatar';

const EMOJI = ['💪', '🔥', '⚡', '🏆', '🥇', '🚀', '🦍', '🐺', '🦈', '🐉', '👑', '😤', '🤖', '🧊', '🌟', '🎯'];

/**
 * Lets the user pick a profile picture. Two options:
 *   - tap an emoji (instant, no upload, no privacy questions)
 *   - choose a photo from the device, which is shrunk to a small square on the
 *     device itself before being saved. We deliberately do not accept a large
 *     original: a 96x96 thumbnail is plenty for an avatar and keeps the
 *     database (and your data footprint) tiny.
 */
export default function AvatarPicker({
  username,
  value,
  onChange,
}: {
  username: string;
  value: string | null;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const dataUrl = await shrinkToSquare(file, 160);
      onChange(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That picture could not be used.');
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4">
        <Avatar username={username || 'You'} avatar={value} size={72} ring />
        <div className="flex-1">
          <p className="text-sm font-semibold">Profile picture</p>
          <p className="text-xs text-slate-400">
            Pick an emoji, or use a photo. Photos are resized on your device before they are saved.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn btn-secondary px-3 py-1.5 text-xs"
              onClick={() => inputRef.current?.click()}
            >
              📷 Choose photo
            </button>
            {value ? (
              <button
                type="button"
                className="btn btn-ghost px-3 py-1.5 text-xs"
                onClick={() => onChange('')}
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = '';
        }}
      />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {EMOJI.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onChange(emoji)}
            aria-label={`Use ${emoji} as your avatar`}
            className={`h-9 w-9 rounded-xl border text-lg transition ${
              value === emoji
                ? 'border-volt-500/60 bg-volt-500/15'
                : 'border-white/10 bg-white/5 hover:bg-white/10'
            }`}
          >
            {emoji}
          </button>
        ))}
      </div>

      {error ? <p className="mt-2 text-xs text-danger-400">{error}</p> : null}
    </div>
  );
}

/**
 * Reads an image file, crops it to a centred square and re-encodes it as a
 * small JPEG. Runs entirely in the browser - the original file is never sent
 * anywhere.
 */
async function shrinkToSquare(file: File, size: number): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  if (file.size > 12 * 1024 * 1024) throw new Error('That image is larger than 12 MB. Please pick a smaller one.');

  const bitmapUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('That image could not be read.'));
      element.src = bitmapUrl;
    });

    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = (image.naturalWidth - side) / 2;
    const sy = (image.naturalHeight - side) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser could not process that image.');
    ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size);

    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}
