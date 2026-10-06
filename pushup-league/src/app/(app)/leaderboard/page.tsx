'use client';

import { useState } from 'react';
import { useLeaderboard } from '@/lib/client/hooks';
import LeaderboardList from '@/components/LeaderboardList';
import ShareCard from '@/components/ShareCard';
import { useSession } from '@/lib/client/session';
import { formatCompact } from '@/lib/client/format';

/**
 * LEADERBOARDS
 * ============
 * Four tabs, one friend group. Your own row is highlighted, and the line above
 * the list always tells you the single most useful thing: who to chase.
 */

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'all', label: 'All Time' },
] as const;

type Range = (typeof TABS)[number]['id'];

export default function LeaderboardPage() {
  const [range, setRange] = useState<Range>('today');
  const { data, loading } = useLeaderboard(range);
  const { user } = useSession();

  const entries = data?.entries ?? [];
  const self = entries.find((entry) => entry.isSelf);

  return (
    <div className="flex flex-col gap-4 animate-rise">
      <div>
        <h1 className="text-xl font-extrabold sm:text-2xl">Leaderboard 🏆</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          {data ? `${entries.length} competitor${entries.length === 1 ? '' : 's'} · you and your friends` : 'Loading…'}
        </p>
      </div>

      {/* Tabs - horizontally scrollable so they never wrap awkwardly on a phone */}
      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex gap-2" role="tablist" aria-label="Leaderboard period">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={range === tab.id}
              onClick={() => setRange(tab.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition ${
                range === tab.id
                  ? 'bg-volt-500 text-ink-950'
                  : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="skeleton h-14 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {data?.message ? (
            <p className="rounded-2xl border border-volt-500/25 bg-volt-500/8 px-4 py-3 text-sm font-semibold text-volt-400">
              {data.message}
            </p>
          ) : null}

          {self ? (
            <div className="card flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-[11px] font-semibold text-slate-400">Your position</p>
                <p className="stat-number text-2xl">
                  #{self.rank}
                  <span className="ml-2 text-sm font-semibold text-slate-400">
                    of {entries.length}
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold text-slate-400">
                  {range === 'today' ? 'Today' : range === 'week' ? 'This week' : range === 'month' ? 'This month' : 'All time'}
                </p>
                <p className="stat-number text-2xl text-volt-500">{formatCompact(self.total)}</p>
              </div>
            </div>
          ) : null}

          <LeaderboardList entries={entries} />

          {entries.length > 1 ? <Podium entries={entries} /> : null}

          {data && data.friendCount === 0 && user ? (
            <ShareCard username={user.username} friendCode={user.friend_code} compact />
          ) : null}

          {entries.length > 1 && self ? (
            <p className="text-center text-xs text-slate-500">
              A single set of 20 could move you up. Consistency beats one big day. 💪
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** A tiny summary of the top three, for a bit of ceremony. */
function Podium({ entries }: { entries: Array<{ username: string; total: number }> }) {
  const [first, second, third] = entries;
  return (
    <div className="grid grid-cols-3 gap-2">
      {[
        { entry: second, place: '🥈', height: 'h-14' },
        { entry: first, place: '🥇', height: 'h-20' },
        { entry: third, place: '🥉', height: 'h-10' },
      ].map(({ entry, place, height }, index) =>
        entry ? (
          <div key={index} className="flex flex-col items-center justify-end gap-1">
            <span className="text-2xl" aria-hidden="true">
              {place}
            </span>
            <p className="w-full truncate text-center text-xs font-semibold">{entry.username}</p>
            <div
              className={`w-full ${height} rounded-t-xl border border-white/10 bg-gradient-to-t from-white/4 to-volt-500/25`}
            />
            <p className="text-[11px] font-bold text-slate-400 tabular">{formatCompact(entry.total)}</p>
          </div>
        ) : (
          <div key={index} />
        ),
      )}
    </div>
  );
}
