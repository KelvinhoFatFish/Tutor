import 'server-only';
import { getDb, newId, nowIso, num } from './db';

/**
 * CHALLENGES
 * ==========
 * A challenge is a time-boxed competition between friends:
 *
 *   "100 Push-Up Weekend"   type = total,     target 100
 *   "First to 500"          type = first_to,  target 500
 *   "30-Day Challenge"      type = total,     target null (no finishing line)
 *
 * Scoring is always derived from `daily_stats` between the start and end dates,
 * so a participant's score is their real, validated push-ups during the window -
 * it cannot be inflated by editing the challenge row.
 */

export type ChallengeType = 'total' | 'first_to';

export interface ChallengeParticipantView {
  userId: string;
  username: string;
  avatar: string | null;
  pushups: number;
  isSelf: boolean;
  rank: number;
  /** 0..1 progress towards the target (1 when there is no target). */
  progress: number;
}

export interface ChallengeView {
  id: string;
  name: string;
  description: string | null;
  type: ChallengeType;
  target: number | null;
  startDate: string;
  endDate: string;
  createdBy: string;
  isCreator: boolean;
  isParticipant: boolean;
  participants: ChallengeParticipantView[];
  totalPushups: number;
  daysRemaining: number;
  daysTotal: number;
  daysElapsed: number;
  status: 'upcoming' | 'active' | 'finished';
  selfRank: number | null;
  message: string | null;
  /** For type "first_to": who reached the target first, if anyone. */
  winner: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / DAY_MS);
}

export interface CreateChallengeInput {
  creatorId: string;
  name: string;
  description: string | null;
  type: ChallengeType;
  target: number | null;
  startDate: string;
  endDate: string;
  invitees: string[];
}

export async function createChallenge(input: CreateChallengeInput): Promise<string> {
  const db = await getDb();
  const id = newId();

  await db.run(
    `INSERT INTO challenges (id, creator_id, name, description, type, target, start_date, end_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.creatorId, input.name, input.description, input.type, input.target,
      input.startDate, input.endDate, nowIso(),
    ],
  );

  const memberIds = Array.from(new Set([input.creatorId, ...input.invitees]));
  for (const userId of memberIds) {
    await db.run(
      `INSERT INTO challenge_participants (id, challenge_id, user_id, pushup_count, joined_at)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT (challenge_id, user_id) DO NOTHING`,
      [newId(), id, userId, nowIso()],
    );
  }

  await refreshChallenge(id, input.creatorId);
  return id;
}

/** Recomputes every participant's score from their daily stats. */
export async function refreshChallenge(challengeId: string, viewerId: string): Promise<void> {
  const db = await getDb();
  const challenge = await db.get<{ start_date: string; end_date: string }>(
    'SELECT start_date, end_date FROM challenges WHERE id = ?',
    [challengeId],
  );
  if (!challenge) return;

  const participants = await db.all<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM challenge_participants WHERE challenge_id = ?',
    [challengeId],
  );

  for (const participant of participants) {
    const row = await db.get<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(pushup_count), 0) AS total
         FROM daily_stats
        WHERE user_id = ? AND day_key >= ? AND day_key <= ?`,
      [participant.user_id, challenge.start_date, challenge.end_date],
    );
    await db.run('UPDATE challenge_participants SET pushup_count = ? WHERE id = ?', [
      num(row?.total), participant.id,
    ]);
  }
  void viewerId;
}

async function loadParticipants(challengeId: string, viewerId: string, target: number | null) {
  const db = await getDb();
  const rows = await db.all<{
    user_id: string;
    username: string;
    avatar: string | null;
    pushup_count: number;
    joined_at: string;
  }>(
    `SELECT cp.user_id, u.username, u.avatar, cp.pushup_count, cp.joined_at
       FROM challenge_participants cp
       JOIN users u ON u.id = cp.user_id
      WHERE cp.challenge_id = ? AND u.deleted_at IS NULL
      ORDER BY cp.pushup_count DESC, u.username ASC`,
    [challengeId],
  );

  const participants: ChallengeParticipantView[] = rows.map((row, index) => ({
    userId: row.user_id,
    username: row.username,
    avatar: row.avatar,
    pushups: num(row.pushup_count),
    isSelf: row.user_id === viewerId,
    rank: index + 1,
    progress: target && target > 0 ? Math.max(0, Math.min(1, num(row.pushup_count) / target)) : 1,
  }));

  // "First to N" is decided by who got there first in time, not by who has the
  // highest total. Re-rank those by the day they crossed the line.
  return participants;
}

/** For a first_to challenge, find who crossed the target first. */
async function findFirstToWinner(challengeId: string, target: number, endDate: string): Promise<string | null> {
  const db = await getDb();
  const participants = await db.all<{ user_id: string; username: string }>(
    `SELECT cp.user_id, u.username FROM challenge_participants cp
       JOIN users u ON u.id = cp.user_id WHERE cp.challenge_id = ?`,
    [challengeId],
  );

  let best: { username: string; day: string } | null = null;
  for (const participant of participants) {
    const days = await db.all<{ day_key: string; pushup_count: number }>(
      `SELECT day_key, pushup_count FROM daily_stats
        WHERE user_id = ? AND day_key <= ? ORDER BY day_key ASC`,
      [participant.user_id, endDate],
    );
    let running = 0;
    for (const day of days) {
      running += num(day.pushup_count);
      if (running >= target) {
        if (!best || day.day_key < best.day) {
          best = { username: participant.username, day: day.day_key };
        }
        break;
      }
    }
  }
  return best?.username ?? null;
}

export async function getChallenge(
  challengeId: string,
  viewerId: string,
  dayKey: string,
): Promise<ChallengeView | null> {
  const db = await getDb();
  const row = await db.get<{
    id: string;
    creator_id: string;
    name: string;
    description: string | null;
    type: string;
    target: number | null;
    start_date: string;
    end_date: string;
    created_at: string;
  }>('SELECT * FROM challenges WHERE id = ?', [challengeId]);
  if (!row) return null;

  await refreshChallenge(row.id, viewerId);

  const membership = await db.get<{ id: string }>(
    'SELECT id FROM challenge_participants WHERE challenge_id = ? AND user_id = ?',
    [row.id, viewerId],
  );

  // You must be in a challenge (or have created it) to see the scoreboard.
  if (!membership && row.creator_id !== viewerId) return null;

  const target = row.target === null ? null : num(row.target);
  const participants = await loadParticipants(row.id, viewerId, target);

  const status: ChallengeView['status'] =
    dayKey < row.start_date ? 'upcoming' : dayKey > row.end_date ? 'finished' : 'active';

  const self = participants.find((p) => p.isSelf) ?? null;
  const daysTotal = Math.max(1, daysBetween(row.start_date, row.end_date) + 1);
  const daysElapsed = Math.max(0, Math.min(daysTotal, daysBetween(row.start_date, dayKey) + 1));
  const daysRemaining = Math.max(0, daysBetween(dayKey, row.end_date));

  let winner: string | null = null;
  if (row.type === 'first_to' && target) {
    winner = await findFirstToWinner(row.id, target, row.end_date);
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: (row.type as ChallengeType) ?? 'total',
    target,
    startDate: row.start_date,
    endDate: row.end_date,
    createdBy: row.creator_id,
    isCreator: row.creator_id === viewerId,
    isParticipant: membership !== null,
    participants,
    totalPushups: participants.reduce((sum, p) => sum + p.pushups, 0),
    daysRemaining,
    daysTotal,
    daysElapsed,
    status,
    selfRank: self?.rank ?? null,
    message: buildChallengeMessage(participants, self, target, status, row.type === 'first_to' ? winner : null),
    winner,
  };
}

/**
 * The competitive line shown under a challenge. Same rule as the leaderboard:
 * push people up, never shame them.
 */
export function buildChallengeMessage(
  participants: ChallengeParticipantView[],
  self: ChallengeParticipantView | null,
  target: number | null,
  status: ChallengeView['status'],
  winner: string | null,
): string | null {
  if (status === 'upcoming') return 'This challenge has not started yet. Get ready! 🔥';
  if (winner) return `🏆 ${winner} reached ${target?.toLocaleString()} first!`;
  if (!self) return null;

  if (participants.length <= 1) {
    return target
      ? `You're going for ${target.toLocaleString()} push-ups. Keep going!`
      : 'Invite a friend to make this a real competition.';
  }

  if (self.rank === 1) {
    const second = participants[1];
    const lead = self.pushups - second.pushups;
    if (lead === 0) return `🥇 You're tied with ${second.username}. Time to break away!`;
    return `🥇 You're leading by ${lead.toLocaleString()} reps. Hold the line!`;
  }

  const ahead = participants[self.rank - 2];
  const gap = ahead.pushups - self.pushups;
  if (gap === 0) return `🔥 You're level with ${ahead.username} - one set takes the lead!`;
  if (gap === 1) return `🔥 Just 1 rep behind ${ahead.username}!`;
  if (gap <= 25) return `You are only ${gap} reps behind ${ahead.username}!`;
  return `${gap.toLocaleString()} reps behind ${ahead.username}. Chip away at it.`;
}

export async function listChallenges(viewerId: string, dayKey: string): Promise<ChallengeView[]> {
  const db = await getDb();
  const rows = await db.all<{ challenge_id: string }>(
    `SELECT challenge_id FROM challenge_participants WHERE user_id = ?
     UNION
     SELECT id AS challenge_id FROM challenges WHERE creator_id = ?`,
    [viewerId, viewerId],
  );

  const views: ChallengeView[] = [];
  for (const row of rows) {
    const view = await getChallenge(row.challenge_id, viewerId, dayKey);
    if (view) views.push(view);
  }

  const order = { active: 0, upcoming: 1, finished: 2 } as const;
  return views.sort((a, b) => order[a.status] - order[b.status] || a.endDate.localeCompare(b.endDate));
}

export async function joinChallenge(challengeId: string, userId: string): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO challenge_participants (id, challenge_id, user_id, pushup_count, joined_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT (challenge_id, user_id) DO NOTHING`,
    [newId(), challengeId, userId, nowIso()],
  );
  await refreshChallenge(challengeId, userId);
}

export async function leaveChallenge(challengeId: string, userId: string): Promise<void> {
  const db = await getDb();
  await db.run('DELETE FROM challenge_participants WHERE challenge_id = ? AND user_id = ?', [
    challengeId, userId,
  ]);
}

export async function deleteChallenge(challengeId: string, userId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.get<{ creator_id: string }>('SELECT creator_id FROM challenges WHERE id = ?', [challengeId]);
  if (!row || row.creator_id !== userId) return false;
  await db.run('DELETE FROM challenge_participants WHERE challenge_id = ?', [challengeId]);
  await db.run('DELETE FROM challenges WHERE id = ?', [challengeId]);
  return true;
}

export async function participantIds(challengeId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.all<{ user_id: string }>(
    'SELECT user_id FROM challenge_participants WHERE challenge_id = ?',
    [challengeId],
  );
  return rows.map((r) => r.user_id);
}
