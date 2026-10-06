'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSession } from '@/lib/client/session';
import { useStats } from '@/lib/client/hooks';
import Avatar from '@/components/Avatar';
import ActivityChart from '@/components/ActivityChart';
import ShareCard from '@/components/ShareCard';
import ProgressBar from '@/components/ProgressBar';
import { apiGet } from '@/lib/client/api';
import { useEffect } from 'react';
import { formatDay, formatDuration, formatNumber, timeAgo } from '@/lib/client/format';

/**
 * PROFILE
 * =======
 * Your own numbers, your achievements, and the history of every session you
 * have ever logged.
 */

interface SessionRow {
  id: string;
  startedAt: string;
  endedAt: string;
  pushups: number;
  invalidReps: number;
  validationScore: number;
  durationMs: number;
  flagged: boolean;
}

export default function ProfilePage() {
  const { user } = useSession();
  const { data, loading } = useStats();
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const payload = await apiGet<{ sessions: SessionRow[] }>('/api/workouts?limit=15');
        setSessions(payload.sessions);
      } catch {
        setSessions([]);
      }
    })();
  }, [data]);

  if (loading || !data || !user) {
    return (
      <div className="flex flex-col gap-3">
        <div className="skeleton h-32 w-full rounded-3xl" />
        <div className="skeleton h-40 w-full rounded-3xl" />
      </div>
    );
  }

  const { stats, achievements } = data;

  return (
    <div className="flex flex-col gap-4 animate-rise">
      {/* ---------- Identity ---------- */}
      <section className="card card-raised p-5">
        <div className="flex items-center gap-4">
          <Avatar username={user.username} avatar={user.avatar} size={72} ring />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-extrabold">{user.username}</h1>
            <p className="text-xs text-slate-400">Joined {formatDay(user.created_at)}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {stats.currentStreak > 0 ? (
                <span className="chip border-flame-500/30 bg-flame-500/12 text-flame-400">
                  🔥 {stats.currentStreak} day streak
                </span>
              ) : null}
              {user.face_auth_enabled ? <span className="chip text-volt-400">🔐 Passkey on</span> : null}
            </div>
          </div>
          <Link href="/settings" className="btn btn-secondary shrink-0 px-3 py-2 text-xs" aria-label="Settings">
            ⚙️
          </Link>
        </div>

        <p className="stat-number mt-5 text-5xl text-volt-500">{formatNumber(stats.lifetime)}</p>
        <p className="text-xs font-bold tracking-widest text-slate-400">LIFETIME PUSH-UPS</p>
      </section>

      {/* ---------- Career stats ---------- */}
      <section className="card p-5">
        <h2 className="font-bold">Career</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Current streak" value={`${stats.currentStreak}`} suffix=" days" icon="🔥" />
          <Stat label="Longest streak" value={`${stats.longestStreak}`} suffix=" days" icon="⚡" />
          <Stat label="Personal best day" value={formatNumber(stats.personalBest)} icon="🏅" />
          <Stat label="Average per active day" value={formatNumber(stats.averageDaily)} icon="📊" />
          <Stat label="Active days" value={formatNumber(stats.activeDays)} icon="📅" />
          <Stat label="This month" value={formatNumber(stats.month)} icon="🗓️" />
        </dl>
      </section>

      {/* ---------- Achievements ---------- */}
      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Achievements</h2>
          <span className="text-xs text-slate-400">
            {achievements.unlocked.length} / {achievements.unlocked.length + achievements.locked.length}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {achievements.unlocked.map((achievement) => (
            <div
              key={achievement.code}
              className="rounded-2xl border border-volt-500/35 bg-volt-500/10 p-3 text-center"
            >
              <div className="text-2xl" aria-hidden="true">
                {achievement.icon}
              </div>
              <p className="mt-1 text-xs font-bold leading-tight">{achievement.name}</p>
              <p className="mt-0.5 text-[10px] text-slate-400">{achievement.description}</p>
            </div>
          ))}

          {achievements.locked.map((achievement) => (
            <div
              key={achievement.code}
              className="rounded-2xl border border-white/8 bg-white/3 p-3 text-center opacity-70"
            >
              <div className="text-2xl grayscale" aria-hidden="true">
                {achievement.icon}
              </div>
              <p className="mt-1 text-xs font-bold leading-tight">{achievement.name}</p>
              <div className="mt-2">
                <ProgressBar value={achievement.progress} height={5} label={`${achievement.name} progress`} />
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                {Math.round(achievement.progress * 100)}% · needs {formatNumber(achievement.threshold)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Chart ---------- */}
      <section className="card p-5">
        <h2 className="font-bold">Last 14 days</h2>
        <div className="mt-4">
          <ActivityChart data={stats.todaySeries} />
        </div>
      </section>

      {/* ---------- Session history ---------- */}
      <section className="card p-5">
        <h2 className="font-bold">Recent sessions</h2>
        {sessions.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            No sessions yet.{' '}
            <Link href="/workout" className="font-semibold text-volt-400 hover:underline">
              Do your first set →
            </Link>
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/6">
            {sessions.map((session) => (
              <li key={session.id} className="flex items-center gap-3 py-2.5">
                <span className="text-lg" aria-hidden="true">
                  {session.flagged ? '⚠️' : '💪'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {formatNumber(session.pushups)} push-ups
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      {formatDuration(session.durationMs)}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {timeAgo(session.startedAt)}
                    {session.invalidReps > 0 ? ` · ${session.invalidReps} rejected` : ''}
                    {session.flagged ? ' · flagged, not counted' : ''}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-slate-500 tabular">
                  {Math.round(session.validationScore * 100)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ShareCard username={user.username} friendCode={user.friend_code} />
    </div>
  );
}

function Stat({ label, value, suffix = '', icon }: { label: string; value: string; suffix?: string; icon: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5">
      <dt className="flex items-center gap-1 text-[11px] font-semibold text-slate-400">
        <span aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className="stat-number mt-0.5 text-2xl">
        {value}
        <span className="text-sm font-semibold text-slate-400">{suffix}</span>
      </dd>
    </div>
  );
}
