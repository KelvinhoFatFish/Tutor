'use client';

import Avatar from './Avatar';
import { formatCompact } from '@/lib/client/format';

/**
 * The ranked list of you and your friends. Your own row is always highlighted
 * so you can find yourself instantly, even when you are tenth.
 */

export interface LeaderboardEntry {
  userId: string;
  username: string;
  avatar: string | null;
  total: number;
  rank: number;
  isSelf: boolean;
}

const MEDALS = ['🥇', '🥈', '🥉'];

export default function LeaderboardList({
  entries,
  onSelect,
  emptyMessage = 'Add friends to start a competition.',
}: {
  entries: LeaderboardEntry[];
  onSelect?: (entry: LeaderboardEntry) => void;
  emptyMessage?: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-white/12 px-4 py-6 text-center text-sm text-slate-400">
        {emptyMessage}
      </p>
    );
  }

  const top = Math.max(1, entries[0]?.total ?? 1);

  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map((entry) => {
        const medal = MEDALS[entry.rank - 1];
        return (
          <li key={entry.userId}>
            <button
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(entry)}
              className={`relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border px-3 py-2.5 text-left transition ${
                entry.isSelf
                  ? 'border-volt-500/50 bg-volt-500/10'
                  : 'border-white/8 bg-white/4 hover:bg-white/8'
              } ${onSelect ? 'cursor-pointer' : 'cursor-default'}`}
            >
              {/* A faint bar showing how close each person is to the leader. */}
              <span
                className="absolute inset-y-0 left-0 -z-0 opacity-[0.13]"
                style={{
                  width: `${Math.round((entry.total / top) * 100)}%`,
                  background: entry.isSelf
                    ? 'linear-gradient(90deg,#2bff88,transparent)'
                    : 'linear-gradient(90deg,#00c2ff,transparent)',
                }}
                aria-hidden="true"
              />

              <span className="relative z-10 w-7 shrink-0 text-center text-sm font-bold text-slate-400 tabular">
                {medal ?? entry.rank}
              </span>

              <Avatar username={entry.username} avatar={entry.avatar} size={34} />

              <span className="relative z-10 min-w-0 flex-1 truncate font-semibold">
                {entry.username}
                {entry.isSelf ? <span className="ml-1.5 text-xs text-volt-400">(you)</span> : null}
              </span>

              <span className="relative z-10 shrink-0 font-extrabold tabular">
                {formatCompact(entry.total)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
