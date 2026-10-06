'use client';

import Link from 'next/link';
import { useSession } from '@/lib/client/session';
import { useStats } from '@/lib/client/hooks';
import { formatNumber, greeting } from '@/lib/client/format';
import LeaderboardList from '@/components/LeaderboardList';
import ActivityChart from '@/components/ActivityChart';
import ShareCard from '@/components/ShareCard';

/**
 * DASHBOARD
 * =========
 * The screen you open every day. Reading order is deliberate:
 *   1. How many you have done today (the number you came for)
 *   2. Where you stand against your friends (the reason to do more)
 *   3. The button (the action)
 *   4. Everything else
 */
export default function DashboardPage() {
  const { user } = useSession();
  const { data, loading } = useStats();

  const stats = data?.stats;
  const leaderboard = data?.leaderboard;

  if (loading || !stats || !leaderboard) {
    return <DashboardSkeleton />;
  }

  const improving = stats.deltaVsYesterday > 0;
  const goal = Math.max(stats.personalBest, 25);
  const progressToBest = Math.min(1, stats.today / goal);

  return (
    <div className="flex flex-col gap-4 animate-rise">
      <div>
        <h1 className="text-xl font-extrabold sm:text-2xl">
          {greeting()}, {user?.username} 👋
        </h1>
      </div>

      {/* ---------- Today's number ---------- */}
      <section className="card card-raised overflow-hidden p-5">
        <div className="flex items-start justify-between">
          <p className="text-xs font-bold tracking-widest text-slate-400">TODAY&apos;S PUSH-UPS</p>
          {stats.currentStreak > 0 ? (
            <span className="chip border-flame-500/30 bg-flame-500/12 text-flame-400">
              <span className="animate-flame" aria-hidden="true">
                🔥
              </span>
              {stats.currentStreak} day{stats.currentStreak === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>

        <p className="stat-number mt-1 text-6xl text-volt-500 sm:text-7xl">{formatNumber(stats.today)}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {stats.deltaVsYesterday === 0 ? (
            <span className="chip text-slate-400">Same as yesterday</span>
          ) : (
            <span
              className={`chip ${
                improving
                  ? 'border-volt-500/30 bg-volt-500/12 text-volt-400'
                  : 'border-white/10 text-slate-400'
              }`}
            >
              {improving ? '▲' : '▼'} {formatNumber(Math.abs(stats.deltaVsYesterday))} vs yesterday
            </span>
          )}
          <span className="chip text-slate-400">Best day: {formatNumber(stats.personalBest)}</span>
          {leaderboard.selfRank ? (
            <span className="chip text-slate-400">
              Rank #{leaderboard.selfRank} of {leaderboard.entries.length}
            </span>
          ) : null}
        </div>

        {/* Progress towards your own personal best - a private goal, not a comparison. */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>
              {stats.today >= goal ? '🎉 You beat your best day!' : `Towards your best day (${formatNumber(goal)})`}
            </span>
            <span className="tabular">{Math.round(progressToBest * 100)}%</span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full bg-gradient-to-r from-volt-500 to-volt-400 transition-[width] duration-700"
              style={{ width: `${progressToBest * 100}%` }}
            />
          </div>
        </div>
      </section>

      {/* ---------- The button ---------- */}
      <Link href="/workout" className="btn btn-primary w-full py-5 text-lg animate-pulse-ring">
        💪 DO PUSH-UPS
      </Link>

      {/* ---------- Friend leaderboard ---------- */}
      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Friend leaderboard</h2>
          <Link href="/leaderboard" className="text-xs font-semibold text-volt-400 hover:underline">
            See all →
          </Link>
        </div>

        <div className="mt-3">
          <LeaderboardList
            entries={leaderboard.entries.slice(0, 5)}
            emptyMessage="No friends yet — invite someone and this becomes a competition."
          />
        </div>

        {leaderboard.message ? (
          <p className="mt-3 rounded-xl border border-volt-500/25 bg-volt-500/8 px-3 py-2.5 text-sm font-semibold text-volt-400">
            {leaderboard.message}
          </p>
        ) : null}
      </section>

      {/* ---------- Invite prompt when you are alone ---------- */}
      {leaderboard.friendCount === 0 && user ? (
        <ShareCard username={user.username} friendCode={user.friend_code} compact />
      ) : null}

      {/* ---------- Period totals ---------- */}
      <section className="card p-5">
        <h2 className="font-bold">Your progress</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Today" value={stats.today} />
          <Stat label="This week" value={stats.week} />
          <Stat label="This month" value={stats.month} />
          <Stat label="Lifetime" value={stats.lifetime} accent />
        </dl>
      </section>

      {/* ---------- Chart ---------- */}
      <section className="card p-5">
        <h2 className="font-bold">Last 14 days</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          {stats.activeDaysThisMonth} active day{stats.activeDaysThisMonth === 1 ? '' : 's'} this month ·
          average {formatNumber(stats.averageDaily)} per active day
        </p>
        <div className="mt-4">
          <ActivityChart data={stats.todaySeries} />
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5">
      <dt className="text-[11px] font-semibold text-slate-400">{label}</dt>
      <dd className={`stat-number mt-0.5 text-2xl ${accent ? 'text-sky-400' : ''}`}>
        {formatNumber(value)}
      </dd>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="skeleton h-7 w-52" />
      <div className="skeleton h-52 w-full rounded-3xl" />
      <div className="skeleton h-16 w-full rounded-full" />
      <div className="skeleton h-64 w-full rounded-3xl" />
    </div>
  );
}
