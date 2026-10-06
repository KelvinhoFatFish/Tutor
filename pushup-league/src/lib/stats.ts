import 'server-only';
import { getDb, num, todayKey, addDays, toDayKey, newId, nowIso } from './db';

/**
 * STATISTICS ENGINE
 * =================
 * `daily_stats` is the single source of truth for how many push-ups a user did
 * on a given day. The totals cached on the `users` row (lifetime, streak,
 * personal best...) are *derived* from it and recomputed after every workout,
 * so they can never drift out of sync or double-count.
 *
 * Everything is keyed on the user's own local calendar day (a "day key" such as
 * 2024-06-14) which the browser sends up with each request.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Accepts a day key from the browser, but refuses anything more than two days
 * away from the server's date. That keeps the app usable for people in other
 * time zones while stopping anyone from filing a workout into the future to
 * fake a streak.
 */
export function sanitizeDayKey(raw: unknown, fallback = todayKey()): string {
  const value = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return fallback;
  const server = new Date(`${fallback}T12:00:00`);
  if (Math.abs(parsed.getTime() - server.getTime()) > 2 * DAY_MS) return fallback;
  return value;
}

export interface PeriodTotals {
  today: number;
  week: number;
  month: number;
  lifetime: number;
}

export interface DaySeriesEntry {
  day: string;
  count: number;
  /** Short weekday label for the chart, e.g. "Mon". */
  label: string;
}

export interface UserStats extends PeriodTotals {
  currentStreak: number;
  longestStreak: number;
  personalBest: number;
  averageDaily: number;
  activeDays: number;
  lastWorkoutDay: string | null;
  todaySeries: DaySeriesEntry[];
  weekTotal: number;
  yesterdayTotal: number;
  /** today - yesterday. Positive means improving. */
  deltaVsYesterday: number;
  /** How many days this month had at least one push-up. */
  activeDaysThisMonth: number;
}

function weekdayLabel(dayKey: string): string {
  const date = new Date(`${dayKey}T12:00:00`);
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

/** Monday-based start of the week containing `dayKey`. */
export function startOfWeek(dayKey: string): string {
  const date = new Date(`${dayKey}T12:00:00`);
  const offset = (date.getDay() + 6) % 7;
  return toDayKey(addDays(date, -offset));
}

export function startOfMonth(dayKey: string): string {
  const date = new Date(`${dayKey}T12:00:00`);
  return toDayKey(new Date(date.getFullYear(), date.getMonth(), 1));
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Computes the streak by walking backwards through the days the user actually
 * trained. A streak survives until a whole day is missed, so training yesterday
 * but not yet today does NOT break it.
 */
export function computeStreaks(days: string[], today: string): { current: number; longest: number } {
  const unique = Array.from(new Set(days)).sort();
  if (unique.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i += 1) {
    const prev = new Date(`${unique[i - 1]}T12:00:00`).getTime();
    const cur = new Date(`${unique[i]}T12:00:00`).getTime();
    const gap = Math.round((cur - prev) / DAY_MS);
    if (gap === 1) {
      run += 1;
    } else if (gap > 1) {
      run = 1;
    }
    if (run > longest) longest = run;
  }

  // Current streak: count back from today (or yesterday) while days are present.
  const present = new Set(unique);
  const todayDate = new Date(`${today}T12:00:00`);
  let cursor = present.has(today) ? todayDate : addDays(todayDate, -1);
  let current = 0;
  while (present.has(toDayKey(cursor))) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, longest: Math.max(longest, current) };
}

export async function getUserStats(userId: string, dayKey: string): Promise<UserStats> {
  const db = await getDb();
  const today = dayKey;

  const rows = await db.all<{ day_key: string; pushup_count: number }>(
    'SELECT day_key, pushup_count FROM daily_stats WHERE user_id = ? AND pushup_count > 0 ORDER BY day_key ASC',
    [userId],
  );

  const byDay = new Map<string, number>();
  for (const row of rows) {
    byDay.set(row.day_key, num(row.pushup_count));
  }

  const sumWhere = (predicate: (day: string) => boolean) => {
    let total = 0;
    for (const [day, count] of byDay) if (predicate(day)) total += count;
    return total;
  };

  const weekStart = startOfWeek(today);
  const monthStart = startOfMonth(today);

  const today_total = byDay.get(today) ?? 0;
  const yesterday = toDayKey(addDays(new Date(`${today}T12:00:00`), -1));
  const yesterdayTotal = byDay.get(yesterday) ?? 0;

  const streaks = computeStreaks(Array.from(byDay.keys()), today);
  const lifetime = sumWhere(() => true);
  const activeDays = byDay.size;
  const personalBest = byDay.size === 0 ? 0 : Math.max(...byDay.values());

  // Last 14 days for the little bar chart on the dashboard and profile.
  const todaySeries: DaySeriesEntry[] = [];
  for (let i = 13; i >= 0; i -= 1) {
    const day = toDayKey(addDays(new Date(`${today}T12:00:00`), -i));
    todaySeries.push({ day, count: byDay.get(day) ?? 0, label: weekdayLabel(day) });
  }

  const activeDaysThisMonth = Array.from(byDay.keys()).filter((day) => day >= monthStart).length;

  return {
    today: today_total,
    week: sumWhere((day) => day >= weekStart && day <= today),
    month: sumWhere((day) => day >= monthStart && day <= today),
    lifetime,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    personalBest,
    averageDaily: activeDays === 0 ? 0 : Math.round(lifetime / activeDays),
    activeDays,
    lastWorkoutDay: byDay.size === 0 ? null : Array.from(byDay.keys()).sort().at(-1) ?? null,
    todaySeries,
    weekTotal: sumWhere((day) => day >= weekStart && day <= today),
    yesterdayTotal,
    deltaVsYesterday: today_total - yesterdayTotal,
    activeDaysThisMonth,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface RecordWorkoutInput {
  sessionId: string;
  userId: string;
  startedAt: string;
  endedAt: string;
  dayKey: string;
  reps: number;
  invalidReps: number;
  validationScore: number;
  device?: string | null;
}

export interface RecordWorkoutResult {
  duplicate: boolean;
  accepted: number;
  flagged: boolean;
  flaggedReason: string | null;
  stats: UserStats;
}

/**
 * Server-side plausibility check.
 *
 * The browser counts the reps, but we do not simply trust the number it sends.
 * A rep needs at least ~650 ms of real movement, so a session cannot honestly
 * contain more reps than its duration allows. Anything above the human
 * ceiling is recorded but flagged, so leaderboards can exclude it.
 */
const MAX_REPS_PER_MINUTE = 90; // ~0.67 s per rep, faster than the detector allows
const MAX_SESSION_REPS = 2000;

export function auditWorkout(input: RecordWorkoutInput): { ok: boolean; reason: string | null } {
  const durationMs = Math.max(
    0,
    new Date(input.endedAt).getTime() - new Date(input.startedAt).getTime(),
  );
  const durationMinutes = durationMs / 60000;

  if (input.reps < 0 || input.reps > MAX_SESSION_REPS) {
    return { ok: false, reason: `impossible rep count (${input.reps})` };
  }
  if (durationMs <= 0 && input.reps > 0) {
    return { ok: false, reason: 'zero-length session with reps' };
  }
  if (durationMinutes > 0 && input.reps / durationMinutes > MAX_REPS_PER_MINUTE) {
    return { ok: false, reason: `rate of ${Math.round(input.reps / durationMinutes)} reps/min is not humanly possible` };
  }
  if (input.validationScore < 0.25 && input.reps > 20) {
    return { ok: false, reason: 'most repetitions failed validation' };
  }
  return { ok: true, reason: null };
}

export async function recordWorkout(input: RecordWorkoutInput): Promise<RecordWorkoutResult> {
  const db = await getDb();
  const audit = auditWorkout(input);
  const flagged = audit.ok ? 0 : 1;

  // The session id comes from the browser and is the primary key, so a retry
  // after a lost connection can never add the same push-ups twice.
  const insert = await db.run(
    `INSERT INTO workout_sessions
       (id, user_id, started_at, ended_at, day_key, pushup_count, invalid_count, validation_score, duration_ms, device, flagged, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [
      input.sessionId,
      input.userId,
      input.startedAt,
      input.endedAt,
      input.dayKey,
      input.reps,
      input.invalidReps,
      input.validationScore,
      Math.max(0, new Date(input.endedAt).getTime() - new Date(input.startedAt).getTime()),
      input.device ?? null,
      flagged,
      nowIso(),
    ],
  );

  if (insert.changes === 0) {
    // We have seen this session before - report the current totals unchanged.
    return {
      duplicate: true,
      accepted: 0,
      flagged: flagged === 1,
      flaggedReason: audit.reason,
      stats: await getUserStats(input.userId, input.dayKey),
    };
  }

  const credited = audit.ok ? input.reps : 0;

  if (credited > 0) {
    await db.run(
      `INSERT INTO daily_stats (id, user_id, day_key, pushup_count, session_count, avg_confidence, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT (user_id, day_key) DO UPDATE SET
         pushup_count = daily_stats.pushup_count + excluded.pushup_count,
         session_count = daily_stats.session_count + 1,
         updated_at = excluded.updated_at`,
      [newId(), input.userId, input.dayKey, credited, input.validationScore, nowIso()],
    );
  }

  await recomputeUserAggregates(input.userId, input.dayKey);
  const stats = await getUserStats(input.userId, input.dayKey);
  return { duplicate: false, accepted: credited, flagged: flagged === 1, flaggedReason: audit.reason, stats };
}

/**
 * Recomputes the cached totals on the user row from `daily_stats`.
 * This is the only place those columns are written.
 */
export async function recomputeUserAggregates(userId: string, dayKey: string): Promise<void> {
  const db = await getDb();
  const stats = await getUserStats(userId, dayKey);
  const sessionRow = await db.get<{ total: number | string | null }>(
    'SELECT COUNT(*) AS total FROM workout_sessions WHERE user_id = ? AND flagged = 0',
    [userId],
  );

  await db.run(
    `UPDATE users SET
       current_streak = ?,
       longest_streak = ?,
       lifetime_pushups = ?,
       personal_best = ?,
       avg_daily_pushups = ?,
       active_days = ?,
       last_workout_date = ?
     WHERE id = ?`,
    [
      stats.currentStreak,
      stats.longestStreak,
      stats.lifetime,
      stats.personalBest,
      stats.averageDaily,
      stats.activeDays,
      stats.lastWorkoutDay,
      userId,
    ],
  );
  void sessionRow;
}

/** Rolls the challenge scoreboard forward for the challanges a user is in. */
export async function refreshChallengeTotals(userId: string, dayKey: string): Promise<void> {
  const db = await getDb();
  const participations = await db.all<{ id: string; challenge_id: string; start_date: string; end_date: string }>(
    `SELECT cp.id, cp.challenge_id, c.start_date, c.end_date
       FROM challenge_participants cp
       JOIN challenges c ON c.id = cp.challenge_id
      WHERE cp.user_id = ? AND c.start_date <= ? AND c.end_date >= ?`,
    [userId, dayKey, dayKey],
  );

  for (const p of participations) {
    const row = await db.get<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(pushup_count), 0) AS total
         FROM daily_stats
        WHERE user_id = ? AND day_key >= ? AND day_key <= ?`,
      [userId, p.start_date, p.end_date],
    );
    await db.run('UPDATE challenge_participants SET pushup_count = ? WHERE id = ?', [
      num(row?.total), p.id,
    ]);
  }
}

export { todayKey };
