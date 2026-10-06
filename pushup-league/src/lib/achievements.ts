import 'server-only';
import { getDb, newId, nowIso, num } from './db';
import { getUserStats, type UserStats } from './stats';

/**
 * ACHIEVEMENTS
 * ============
 * The catalogue lives in the `achievements` table (seeded on first run). After
 * every workout we re-evaluate every achievement for that user and record any
 * that have just been earned. `ON CONFLICT DO NOTHING` plus the returned
 * "changes" count tells us which ones are new, so the UI can celebrate them
 * exactly once.
 */

export interface AchievementRow {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  kind: string;
  threshold: number;
  sort_order: number;
}

export interface AchievementWithState extends AchievementRow {
  unlocked_at: string | null;
  /** 0..1 progress towards the requirement. */
  progress: number;
}

async function friendsBeaten(userId: string, lifetime: number): Promise<number> {
  const db = await getDb();
  const row = await db.get<{ total: number | string | null }>(
    `SELECT COUNT(*) AS total
       FROM users u
      WHERE u.id <> ?
        AND u.deleted_at IS NULL
        AND u.lifetime_pushups < ?
        AND EXISTS (
          SELECT 1 FROM friendships f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = ? AND f.recipient_id = u.id)
               OR (f.recipient_id = ? AND f.requester_id = u.id))
        )`,
    [userId, lifetime, userId, userId],
  );
  return num(row?.total);
}

async function sessionCount(userId: string): Promise<number> {
  const db = await getDb();
  const row = await db.get<{ total: number | string | null }>(
    'SELECT COUNT(*) AS total FROM workout_sessions WHERE user_id = ? AND flagged = 0',
    [userId],
  );
  return num(row?.total);
}

/** The live value each achievement is measured against. */
async function currentValue(row: AchievementRow, userId: string, stats: UserStats): Promise<number> {
  switch (row.kind) {
    case 'lifetime':
      return stats.lifetime;
    case 'streak':
      return stats.currentStreak;
    case 'daily':
      return stats.personalBest;
    case 'friends':
      return friendsBeaten(userId, stats.lifetime);
    case 'sessions':
      return sessionCount(userId);
    default:
      return 0;
  }
}

/**
 * Evaluates every achievement and stores the ones just earned.
 * Returns the achievements unlocked by this call.
 */
export async function checkAchievements(userId: string, dayKey: string): Promise<AchievementRow[]> {
  const db = await getDb();
  const stats = await getUserStats(userId, dayKey);
  const catalogue = await db.all<AchievementRow>('SELECT * FROM achievements ORDER BY sort_order ASC');

  const unlocked: AchievementRow[] = [];
  for (const row of catalogue) {
    const value = await currentValue(row, userId, stats);
    if (value >= row.threshold) {
      const result = await db.run(
        `INSERT INTO user_achievements (id, user_id, achievement_id, unlocked_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, achievement_id) DO NOTHING`,
        [newId(), userId, row.id, nowIso()],
      );
      if (result.changes > 0) unlocked.push(row);
    }
  }
  return unlocked;
}

export async function getUserAchievements(
  userId: string,
  dayKey: string,
): Promise<{ unlocked: AchievementWithState[]; locked: AchievementWithState[] }> {
  const db = await getDb();
  const stats = await getUserStats(userId, dayKey);
  const rows = await db.all<AchievementRow & { unlocked_at: string | null }>(
    `SELECT a.*, ua.unlocked_at
       FROM achievements a
       LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ?
      ORDER BY a.sort_order ASC`,
    [userId],
  );

  const withState: AchievementWithState[] = [];
  for (const row of rows) {
    const value = await currentValue(row, userId, stats);
    withState.push({
      ...row,
      unlocked_at: row.unlocked_at ?? null,
      progress: row.threshold <= 0 ? 1 : Math.max(0, Math.min(1, value / row.threshold)),
    });
  }

  return {
    unlocked: withState.filter((a) => a.unlocked_at !== null),
    locked: withState.filter((a) => a.unlocked_at === null),
  };
}
