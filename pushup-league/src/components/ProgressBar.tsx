'use client';

/**
 * A rounded progress bar. Used for challenge targets and achievement progress.
 */
export default function ProgressBar({
  value,
  tone = 'volt',
  height = 8,
  label,
}: {
  /** 0..1 */
  value: number;
  tone?: 'volt' | 'sky' | 'flame';
  height?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const gradients: Record<string, string> = {
    volt: 'linear-gradient(90deg, #2bff88, #6dffb0)',
    sky: 'linear-gradient(90deg, #00c2ff, #4fd8ff)',
    flame: 'linear-gradient(90deg, #ff9d1c, #ffc247)',
  };

  return (
    <div
      className="w-full overflow-hidden rounded-full bg-white/8"
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${clamped * 100}%`, background: gradients[tone] }}
      />
    </div>
  );
}
