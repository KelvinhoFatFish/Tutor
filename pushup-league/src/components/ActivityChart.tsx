'use client';

import { formatCompact } from '@/lib/client/format';

/**
 * The last 14 days as simple bars. Deliberately dependency-free: a chart
 * library would add hundreds of kilobytes for a shape this simple.
 */
export default function ActivityChart({
  data,
  height = 96,
}: {
  data: Array<{ day: string; count: number; label: string }>;
  height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.count));
  const todayKey = data[data.length - 1]?.day;

  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((entry) => {
          const ratio = entry.count / max;
          const isToday = entry.day === todayKey;
          return (
            <div key={entry.day} className="group flex h-full flex-1 flex-col justify-end">
              <div
                className="relative w-full rounded-t-md transition-[height] duration-500"
                style={{
                  height: `${Math.max(entry.count > 0 ? 6 : 2, ratio * 100)}%`,
                  background: isToday
                    ? 'linear-gradient(180deg,#2bff88,#08a551)'
                    : entry.count > 0
                      ? 'linear-gradient(180deg,rgba(79,216,255,0.85),rgba(0,145,213,0.5))'
                      : 'rgba(255,255,255,0.07)',
                }}
                title={`${entry.label}: ${entry.count} push-ups`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1">
        {data.map((entry) => (
          <span
            key={entry.day}
            className={`flex-1 text-center text-[10px] font-semibold ${
              entry.day === todayKey ? 'text-volt-400' : 'text-slate-500'
            }`}
          >
            {entry.label.slice(0, 1)}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Peak day: <span className="font-semibold text-slate-300">{formatCompact(max)}</span> push-ups
      </p>
    </div>
  );
}
