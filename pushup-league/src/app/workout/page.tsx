'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PushupDetector, type ReadinessResult } from '@/lib/pushup/detector';
import {
  CONFIG_PRESETS,
  DEFAULT_CONFIG,
  type DetectorEvent,
  type FrameMetrics,
  type PushupDetectorConfig,
} from '@/lib/pushup/types';
import PoseCamera from '@/components/PoseCamera';
import Avatar from '@/components/Avatar';
import { useSession } from '@/lib/client/session';
import { useStats } from '@/lib/client/hooks';
import { useToast } from '@/components/Toast';
import { apiSend } from '@/lib/client/api';
import { enqueueSession } from '@/lib/client/offline';
import {
  loadFeedbackPrefs,
  playCountdownTick,
  playFinishSound,
  playRepSound,
  unlockAudio,
  vibrate,
} from '@/lib/client/feedback';
import { formatClock, formatNumber, localDayKey } from '@/lib/client/format';

/**
 * ============================================================================
 *  WORKOUT
 * ============================================================================
 * Four phases, in order:
 *
 *   SETUP      camera preview, position checks, "when it says Ready, press START"
 *   COUNTDOWN  3 · 2 · 1 · GO!
 *   ACTIVE     the big counter, live metrics, END WORKOUT
 *   COMPLETE   the celebration, the numbers, and what to do next
 *
 * The rep counting itself lives entirely in src/lib/pushup/detector.ts - this
 * file only presents it, plays the feedback and saves the result.
 */

type Phase = 'setup' | 'countdown' | 'active' | 'complete';

interface SaveResult {
  savedOnline: boolean;
  stats?: {
    today: number;
    lifetime: number;
    currentStreak: number;
    personalBest: number;
    week: number;
    month: number;
    deltaVsYesterday: number;
  };
  newAchievements?: Array<{ code: string; name: string; description: string; icon: string }>;
  rank?: number | null;
  totalPlayers?: number;
  leaderboard?: Array<{ userId: string; username: string; avatar: string | null; total: number; rank: number; isSelf: boolean }>;
  flagged?: boolean;
}

export default function WorkoutPage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-sm text-slate-400">Loading…</div>}>
      <WorkoutScreen />
    </Suspense>
  );
}

function WorkoutScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, refresh } = useSession();
  const { push } = useToast();

  // One detector for the whole page life. `useState(() => ...)` guarantees it is
  // created exactly once, even across re-renders.
  const [detector] = useState(() => new PushupDetector());
  const [config, setConfig] = useState<PushupDetectorConfig>(DEFAULT_CONFIG);
  const [preset, setPreset] = useState<'beginner' | 'standard' | 'strict'>('standard');
  const [showTuning, setShowTuning] = useState(false);

  const [phase, setPhase] = useState<Phase>('setup');
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const [metrics, setMetrics] = useState<FrameMetrics | null>(null);
  const [reps, setReps] = useState(0);
  const [invalidReps, setInvalidReps] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [flash, setFlash] = useState(0);
  const [multiplePeople, setMultiplePeople] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [saving, setSaving] = useState(false);

  // Today's total BEFORE this session, so the live screen can show a running
  // "Today: 87" that includes the reps you are doing right now.
  const { data: statsData } = useStats();
  const [baselineToday, setBaselineToday] = useState(0);
  const baselineRef = useRef(0);
  useEffect(() => {
    baselineRef.current = statsData?.stats.today ?? 0;
  }, [statsData]);

  const startedAtRef = useRef<Date | null>(null);
  const sessionIdRef = useRef<string>('');
  const feedbackRef = useRef(loadFeedbackPrefs());
  const lastInvalidAtRef = useRef(0);

  const isFirstSession = params.get('first') === '1';

  // Keep the detector's thresholds in sync with the tuning panel.
  useEffect(() => {
    detector.setConfig(config);
  }, [config, detector]);

  useEffect(() => {
    feedbackRef.current = loadFeedbackPrefs();
  }, [phase]);

  // Warn before losing reps to an accidental tab close.
  useEffect(() => {
    if (phase !== 'active') return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  // Workout stopwatch.
  useEffect(() => {
    if (phase !== 'active') return;
    const timer = window.setInterval(() => {
      if (startedAtRef.current) {
        setElapsed(Date.now() - startedAtRef.current.getTime());
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const handleEvent = useCallback(
    (event: DetectorEvent) => {
      setMessage(event.message);
      setMetrics(event.metrics);

      if (event.type === 'count') {
        setReps(event.reps);
        setFlash((value) => value + 1);
        if (feedbackRef.current.sound) playRepSound('count');
        if (feedbackRef.current.haptics) vibrate(35);
        return;
      }

      if (event.type === 'invalid' && event.reps + event.invalidReps > 0) {
        setInvalidReps(event.invalidReps);
        // Play at most one "nope" per second so a shaky camera cannot drone.
        const now = Date.now();
        if (now - lastInvalidAtRef.current > 900) {
          lastInvalidAtRef.current = now;
          if (feedbackRef.current.sound) playRepSound('invalid');
          if (feedbackRef.current.haptics) vibrate([20, 60, 20]);
        }
      }
    },
    [],
  );

  const startCountdown = () => {
    unlockAudio();
    detector.reset();
    setReps(0);
    setInvalidReps(0);
    setMessage(null);
    setResult(null);
    setCountdown(3);
    setPhase('countdown');
  };

  // 3 · 2 · 1 · GO!
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown < 0) {
      startedAtRef.current = new Date();
      sessionIdRef.current = crypto.randomUUID();
      setElapsed(0);
      setBaselineToday(baselineRef.current);
      setPhase('active');
      return;
    }
    playCountdownTick(countdown === 0);
    if (feedbackRef.current.haptics) vibrate(countdown === 0 ? 80 : 25);
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, countdown]);

  const finish = async () => {
    setSaving(true);
    const endedAt = new Date();
    const startedAt = startedAtRef.current ?? endedAt;

    const session = {
      id: sessionIdRef.current || crypto.randomUUID(),
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      reps,
      invalidReps,
      validationScore: detector.getValidationScore(),
      dayKey: localDayKey(),
      device: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent.slice(0, 120),
    };

    if (feedbackRef.current.sound) playFinishSound();
    if (feedbackRef.current.haptics) vibrate([60, 40, 60, 40, 120]);

    let saveResult: SaveResult = { savedOnline: false };

    try {
      const payload = await apiSend<{
        duplicate: boolean;
        accepted: number;
        flagged: boolean;
        stats: SaveResult['stats'];
        newAchievements: SaveResult['newAchievements'];
        leaderboard: {
          entries: SaveResult['leaderboard'];
          selfRank: number | null;
        };
      }>('/api/workouts', 'POST', session);

      saveResult = {
        savedOnline: true,
        stats: payload.stats,
        newAchievements: payload.newAchievements,
        rank: payload.leaderboard?.selfRank ?? null,
        totalPlayers: payload.leaderboard?.entries?.length ?? 0,
        leaderboard: payload.leaderboard?.entries ?? [],
        flagged: payload.flagged,
      };
      await refresh();
      window.dispatchEvent(new CustomEvent('pushup-league:stats-stale'));
    } catch {
      // No connection (or the server is asleep): keep the reps on the device.
      enqueueSession({ ...session, queuedAt: new Date().toISOString() });
      saveResult = { savedOnline: false };
      push('Saved on this device — it will upload when you are back online. 💾', 'warn');
    }

    setResult(saveResult);
    setSaving(false);
    setPhase('complete');
  };

  const doAnotherSet = () => {
    setResult(null);
    detector.reset();
    setReps(0);
    setInvalidReps(0);
    setPhase('setup');
  };

  const selfRow = result?.leaderboard?.find((entry) => entry.isSelf);

  const applyPreset = (key: 'beginner' | 'standard' | 'strict') => {
    setPreset(key);
    setConfig({ ...DEFAULT_CONFIG, ...CONFIG_PRESETS[key].overrides });
  };

  // ---------------------------------------------------------------- COMPLETE
  if (phase === 'complete') {
    return (
      <CompletionScreen
        reps={reps}
        invalidReps={invalidReps}
        elapsedMs={elapsed}
        result={result}
        saving={saving}
        selfRank={result?.rank ?? selfRow?.rank ?? null}
        totalPlayers={result?.totalPlayers ?? 0}
        onAnotherSet={doAnotherSet}
      />
    );
  }

  const active = phase === 'active';

  // ---------------------------------------------------------------------------
  // SETUP · COUNTDOWN · ACTIVE
  //
  // All three phases share ONE PoseCamera element. That matters: unmounting it
  // would release the camera and throw away the loaded pose model, costing a
  // second or two right at the moment you are ready to start.
  // ---------------------------------------------------------------------------
  return (
    <main className={`min-h-dvh px-3 pb-4 safe-top ${active ? 'pt-3' : 'pt-4'}`}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
        {!active ? (
          <div className="flex items-center justify-between">
            <Link href="/dashboard" className="btn btn-ghost px-3 py-2 text-sm">
              ← Back
            </Link>
            <p className="text-sm font-bold">{isFirstSession ? 'Your first set 💪' : 'New set'}</p>
            <button type="button" className="btn btn-ghost px-3 py-2 text-sm" onClick={() => setShowTuning((v) => !v)}>
              ⚙️
            </button>
          </div>
        ) : null}

        {!active && showTuning ? (
          <TuningPanel config={config} preset={preset} onPreset={applyPreset} onChange={setConfig} />
        ) : null}

        {/* The big live counter, during the workout only. */}
        {active ? (
          <div className="relative flex flex-col items-center justify-center rounded-3xl border border-volt-500/25 bg-gradient-to-b from-volt-500/12 to-transparent px-4 py-4">
            {flash > 0 ? (
              <span key={flash} className="rep-float">
                +1
              </span>
            ) : null}
            <p className="stat-number text-7xl text-volt-500 sm:text-8xl" aria-live="polite">
              {reps}
            </p>
            <p className="mt-1 text-xs font-bold tracking-[0.3em] text-slate-400">PUSH-UPS</p>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
              <span className="chip border-flame-500/30 bg-flame-500/12 text-flame-400">
                🔥 {user?.current_streak ?? 0} day streak
              </span>
              <span className="chip">⏱️ {formatClock(elapsed / 1000)}</span>
              <span className="chip">
                Today: {formatNumber(baselineToday + reps)}
                {user?.personal_best ? ` · Best ${formatNumber(Math.max(user.personal_best, baselineToday + reps))}` : ''}
              </span>
            </div>
          </div>
        ) : null}

        <div className="relative">
          <PoseCamera
            detector={detector}
            counting={active}
            facingMode={facing}
            onToggleFacing={() => setFacing((value) => (value === 'user' ? 'environment' : 'user'))}
            onReadiness={setReadiness}
            onEvent={handleEvent}
            onMetrics={setMetrics}
            onMultiplePeople={(count) => setMultiplePeople(count > 1)}
            overlay={
              phase === 'countdown' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-ink-950/70 backdrop-blur-sm">
                  <div key={countdown} className="animate-pop text-center">
                    <p className="stat-number text-8xl text-volt-500">{countdown > 0 ? countdown : 'GO!'}</p>
                    <p className="mt-2 text-sm font-bold text-slate-300">Get into position…</p>
                  </div>
                </div>
              ) : null
            }
          />
        </div>

        {/* Live feedback + controls */}
        <div className="flex flex-col gap-2">
          {active ? (
            <>
              {message ? (
                <p className="rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-center text-sm font-semibold text-sky-400">
                  {message}
                </p>
              ) : (
                <p className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-center text-sm text-slate-400">
                  {metrics
                    ? `Elbow ${Math.round(metrics.elbowAngle)}° · Body ${Math.round(metrics.bodyAlignment)}°`
                    : 'Tracking…'}
                </p>
              )}

              {multiplePeople ? (
                <p className="rounded-2xl border border-flame-500/30 bg-flame-500/10 px-4 py-2.5 text-center text-xs font-semibold text-flame-400">
                  More than one person is in view. Only the closest person is counted.
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => void finish()}
                disabled={saving}
                className="btn btn-danger w-full py-4 text-base"
              >
                {saving ? 'Saving…' : 'END WORKOUT'}
              </button>
              <p className="text-center text-xs text-slate-500">
                {invalidReps > 0 ? `${invalidReps} reps were rejected · ` : ''}
                Your video is processed on this device and never uploaded.
              </p>
            </>
          ) : (
            <>
              {/* Position checks */}
              <section className="card p-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold">Camera check</h2>
                  {readiness?.ready ? (
                    <span className="chip border-volt-500/40 bg-volt-500/15 text-volt-400">✓ Ready</span>
                  ) : (
                    <span className="chip text-slate-400">Not ready yet</span>
                  )}
                </div>

                <ul className="mt-3 flex flex-col gap-2">
                  {(readiness?.checks ?? FALLBACK_CHECKS).map((check) => (
                    <li key={check.id} className="flex items-start gap-2.5 text-sm">
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          check.ok ? 'bg-volt-500 text-ink-950' : 'bg-white/10 text-slate-400'
                        }`}
                      >
                        {check.ok ? '✓' : '·'}
                      </span>
                      <span>
                        <span className={check.ok ? 'font-semibold' : 'text-slate-400'}>{check.label}</span>
                        {!check.ok ? <span className="block text-xs text-slate-500">{check.hint}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>

                {readiness?.metrics ? (
                  <p className="mt-3 border-t border-white/6 pt-3 text-xs text-slate-500">
                    Elbow angle {Math.round(readiness.metrics.elbowAngle)}° · body straightness{' '}
                    {Math.round(readiness.metrics.bodyAlignment)}° · confidence{' '}
                    {Math.round(readiness.metrics.confidence * 100)}%
                  </p>
                ) : null}
              </section>

              {/* Positioning instructions */}
              <section className="card p-4 text-sm">
                <h2 className="font-bold">Getting the best count</h2>
                <ul className="mt-2 space-y-1.5 text-slate-300">
                  <li>
                    📱 Place your phone so your <strong>whole body</strong> is visible.
                  </li>
                  <li>🧍 Make sure your head, shoulders, hips, knees and feet can all be detected.</li>
                  <li>
                    ↔️ Ideally film from the <strong>side</strong> — the app reads elbow and hip angles.
                  </li>
                  <li>💡 Light yourself well; a dark room hides your joints.</li>
                  <li>🖐️ Hands on the floor below your shoulders — that is how it knows you are in a plank.</li>
                </ul>
              </section>

              <button
                type="button"
                className="btn btn-primary w-full py-5 text-lg"
                disabled={!readiness?.ready || phase === 'countdown'}
                onClick={startCountdown}
              >
                {readiness?.ready ? 'START 💪' : 'Waiting for a good position…'}
              </button>

              {!readiness?.ready ? (
                <button type="button" className="btn btn-ghost w-full text-sm" onClick={startCountdown}>
                  Start anyway (I know what I&apos;m doing)
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

const FALLBACK_CHECKS = [
  { id: 'person', label: 'Person detected', ok: false, hint: 'Step into the camera view.' },
  {
    id: 'fullbody',
    label: 'Whole body visible',
    ok: false,
    hint: 'Head, shoulders, hips, knees and feet must all be in shot.',
  },
  { id: 'lighting', label: 'Enough light', ok: false, hint: 'Turn on a light or face a window.' },
  {
    id: 'plank',
    label: 'Plank position detected',
    ok: false,
    hint: 'Get down into a push-up position.',
  },
];

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

function CompletionScreen({
  reps,
  invalidReps,
  elapsedMs,
  result,
  saving,
  selfRank,
  totalPlayers,
  onAnotherSet,
}: {
  reps: number;
  invalidReps: number;
  elapsedMs: number;
  result: SaveResult | null;
  saving: boolean;
  selfRank: number | null;
  totalPlayers: number;
  onAnotherSet: () => void;
}) {
  const { push } = useToast();
  const stats = result?.stats;
  const todayValue = stats?.today ?? reps;
  const calories = Math.round(reps * 0.5);

  const share = async () => {
    const text = `💪 I just did ${reps} push-ups on PushUp League! That's ${todayValue} today. Think you can beat me?`;
    const url = window.location.origin;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'PushUp League', text, url });
        return;
      } catch {
        /* dismissed - fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      push('Result copied — paste it anywhere ✓', 'success');
    } catch {
      push('Copying was blocked. Take a screenshot instead! 📸', 'warn');
    }
  };

  return (
    <main className="min-h-dvh px-4 py-8 safe-top">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 animate-rise">
        <div className="text-center">
          <div className="text-6xl animate-pop" aria-hidden="true">
            🔥
          </div>
          <h1 className="mt-3 text-3xl font-extrabold">{reps === 0 ? 'Good effort!' : 'GREAT JOB!'}</h1>
          <p className="stat-number mt-4 text-7xl text-volt-500">{formatNumber(reps)}</p>
          <p className="text-xs font-bold tracking-[0.3em] text-slate-400">PUSH-UPS</p>
          <p className="mt-2 text-sm text-slate-400">in {formatClock(elapsedMs / 1000)}</p>
        </div>

        {!result?.savedOnline ? (
          <p className="rounded-2xl border border-flame-500/30 bg-flame-500/10 px-4 py-3 text-center text-sm font-semibold text-flame-400">
            💾 Saved on this device. It will upload automatically when you are back online.
          </p>
        ) : null}

        {result?.flagged ? (
          <p className="rounded-2xl border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-center text-sm text-danger-400">
            ⚠️ This set was flagged by our checks and has not been added to your totals. If you think
            that is wrong, try a slower, fuller range of motion.
          </p>
        ) : null}

        <section className="card p-5">
          <dl className="grid grid-cols-2 gap-3">
            <CompleteStat label="Today's total" value={formatNumber(todayValue)} accent />
            <CompleteStat label="Lifetime" value={formatNumber(stats?.lifetime ?? todayValue)} />
            <CompleteStat label="This week" value={formatNumber(stats?.week ?? todayValue)} />
            <CompleteStat label="Personal best day" value={formatNumber(stats?.personalBest ?? todayValue)} />
            <CompleteStat label="Current streak" value={`${stats?.currentStreak ?? 0} days`} />
            <CompleteStat label="Rejected reps" value={formatNumber(invalidReps)} />
          </dl>

          <p className="mt-3 border-t border-white/6 pt-3 text-center text-xs text-slate-500">
            🔥 roughly <strong className="text-slate-300">{calories} kcal</strong> — an estimate only,
            based on about 0.5 kcal per push-up.
          </p>
        </section>

        {selfRank && totalPlayers > 1 ? (
          <section className="card p-5 text-center">
            <p className="text-sm text-slate-400">You are now</p>
            <p className="stat-number text-4xl text-sky-400">#{selfRank}</p>
            <p className="text-sm text-slate-400">among your {totalPlayers - 1} friends</p>
          </section>
        ) : null}

        {result?.newAchievements && result.newAchievements.length > 0 ? (
          <section className="card border-volt-500/30 p-5">
            <h2 className="text-center font-bold">Achievements unlocked 🏆</h2>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {result.newAchievements.map((achievement) => (
                <div
                  key={achievement.code}
                  className="w-32 rounded-2xl border border-volt-500/35 bg-volt-500/10 p-3 text-center"
                >
                  <div className="text-2xl" aria-hidden="true">
                    {achievement.icon}
                  </div>
                  <p className="mt-1 text-xs font-bold leading-tight">{achievement.name}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {result?.leaderboard && result.leaderboard.length > 1 ? (
          <section className="card p-5">
            <h2 className="font-bold">Today&apos;s standings</h2>
            <ul className="mt-3 flex flex-col gap-1.5">
              {result.leaderboard.slice(0, 5).map((entry) => (
                <li
                  key={entry.userId}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                    entry.isSelf ? 'border border-volt-500/40 bg-volt-500/10' : 'bg-white/4'
                  }`}
                >
                  <span className="w-5 text-center text-xs font-bold text-slate-500">
                    {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : entry.rank}
                  </span>
                  <Avatar username={entry.username} avatar={entry.avatar} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {entry.username}
                    {entry.isSelf ? <span className="ml-1 text-xs text-volt-400">(you)</span> : null}
                  </span>
                  <span className="text-sm font-extrabold tabular">{formatNumber(entry.total)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="flex flex-col gap-2">
          <button type="button" className="btn btn-primary w-full py-4" onClick={() => void share()}>
            📤 Share Result
          </button>
          <button type="button" className="btn btn-secondary w-full py-3.5" onClick={onAnotherSet} disabled={saving}>
            🔁 Do Another Set
          </button>
          <Link href="/dashboard" className="btn btn-ghost w-full py-3.5">
            Back to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}

function CompleteStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5">
      <dt className="text-[11px] font-semibold text-slate-400">{label}</dt>
      <dd className={`stat-number mt-0.5 text-2xl ${accent ? 'text-volt-500' : ''}`}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live tuning panel
// ---------------------------------------------------------------------------

/**
 * Lets you change the detection thresholds without editing code and restarting.
 * Handy while you are working out how strict the counter should be for real
 * people - which the brief explicitly asks to be easy to tune.
 */
function TuningPanel({
  config,
  preset,
  onPreset,
  onChange,
}: {
  config: PushupDetectorConfig;
  preset: string;
  onPreset: (key: 'beginner' | 'standard' | 'strict') => void;
  onChange: (config: PushupDetectorConfig) => void;
}) {
  const sliders = useMemo(
    () =>
      [
        { key: 'minElbowAngle', label: 'Depth required (lower = deeper)', min: 70, max: 140, step: 1, unit: '°' },
        { key: 'maxElbowAngle', label: 'Arms "extended" above', min: 130, max: 175, step: 1, unit: '°' },
        { key: 'downElbowAngle', label: 'Start of descent below', min: 110, max: 160, step: 1, unit: '°' },
        { key: 'alignmentTolerance', label: 'Body straightness tolerance', min: 10, max: 70, step: 1, unit: '°' },
        { key: 'minDepthDelta', label: 'Shoulder drop required', min: 0.01, max: 0.15, step: 0.005, unit: '' },
        { key: 'minRepDurationMs', label: 'Fastest allowed rep', min: 300, max: 2000, step: 50, unit: 'ms' },
        { key: 'cooldownMs', label: 'Cooldown between reps', min: 0, max: 1500, step: 50, unit: 'ms' },
        { key: 'confidenceThreshold', label: 'Minimum pose confidence', min: 0.2, max: 0.9, step: 0.05, unit: '' },
      ] as const,
    [],
  );

  return (
    <section className="card p-4">
      <h2 className="font-bold">Detection settings</h2>
      <p className="mt-0.5 text-xs text-slate-400">
        Tune how strict the counter is. Changes apply instantly to the live camera above.
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {(Object.keys(CONFIG_PRESETS) as Array<'beginner' | 'standard' | 'strict'>).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onPreset(key)}
            className={`rounded-xl border px-2 py-2 text-xs font-bold transition ${
              preset === key ? 'border-volt-500/60 bg-volt-500/12 text-volt-400' : 'border-white/10 bg-white/4'
            }`}
            title={CONFIG_PRESETS[key].description}
          >
            {CONFIG_PRESETS[key].label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {sliders.map((slider) => (
          <label key={slider.key} className="block">
            <span className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">{slider.label}</span>
              <span className="tabular text-slate-400">
                {config[slider.key]}
                {slider.unit}
              </span>
            </span>
            <input
              type="range"
              min={slider.min}
              max={slider.max}
              step={slider.step}
              value={config[slider.key]}
              onChange={(event) =>
                onChange({ ...config, [slider.key]: Number(event.target.value) })
              }
              className="mt-1.5 w-full accent-volt-500"
            />
          </label>
        ))}
      </div>

      <button type="button" className="btn btn-ghost mt-3 w-full text-xs" onClick={() => onPreset('standard')}>
        Reset to standard
      </button>
    </section>
  );
}
