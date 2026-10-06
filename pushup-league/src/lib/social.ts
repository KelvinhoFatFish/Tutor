import 'server-only';
import { getDb, newId, nowIso, num } from './db';
import { getUserStats, startOfMonth, startOfWeek, type UserStats } from './stats';

/**
 * FRIENDS, LEADERBOARDS AND NOTIFICATIONS
 * =======================================
 *
 * Privacy rules enforced here:
 *   - A user's email address is never returned by any function in this file.
 *   - Friend-only data (streaks, weekly totals) is returned only when there is
 *     an accepted friendship in the database.
 *   - Blocking wins over everything: a blocked user cannot see you, search for
 *     you, or send you anything.
 */

export type LeaderboardRange = 'today' | 'week' | 'month' | 'all';

export interface LeaderboardEntry {
  userId: string;
  username: string;
  avatar: string | null;
  total: number;
  rank: number;
  isSelf: boolean;
}

export interface Leaderboard {
  range: LeaderboardRange;
  entries: LeaderboardEntry[];
  selfRank: number | null;
  selfTotal: number;
  message: string | null;
  friendCount: number;
}

export interface FriendSummary {
  userId: string;
  username: string;
  avatar: string | null;
  today: number;
  week: number;
  month: number;
  lifetime: number;
  currentStreak: number;
  personalBest: number;
}

// ---------------------------------------------------------------------------
// Friendship helpers
// ---------------------------------------------------------------------------

/** All user ids with an accepted friendship, excluding blocked relationships. */
export async function getFriendIds(userId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.all<{ requester_id: string; recipient_id: string; status: string }>(
    `SELECT requester_id, recipient_id, status FROM friendships
      WHERE requester_id = ? OR recipient_id = ?`,
    [userId, userId],
  );
  const ids: string[] = [];
  for (const row of rows) {
    if (row.status !== 'accepted') continue;
    ids.push(row.requester_id === userId ? row.recipient_id : row.requester_id);
  }
  return ids;
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.get<{ id: string }>(
    `SELECT id FROM friendships
      WHERE status = 'accepted'
        AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))`,
    [a, b, a, b],
  );
  return row !== null;
}

/** Ids that cannot interact with you in either direction (blocked / blocking). */
export async function getBlockedIds(userId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.all<{ requester_id: string; recipient_id: string }>(
    `SELECT requester_id, recipient_id FROM friendships
      WHERE status = 'blocked' AND (requester_id = ? OR recipient_id = ?)`,
    [userId, userId],
  );
  return rows.map((r) => (r.requester_id === userId ? r.recipient_id : r.requester_id));
}

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

function rangeWindow(range: LeaderboardRange, dayKey: string): { from: string; to: string } | null {
  switch (range) {
    case 'today':
      return { from: dayKey, to: dayKey };
    case 'week':
      return { from: startOfWeek(dayKey), to: dayKey };
    case 'month':
      return { from: startOfMonth(dayKey), to: dayKey };
    case 'all':
      return null;
  }
}

/**
 * Builds the ranked list of you plus your friends.
 * `includeSelf` is always true because seeing your own position is the whole
 * point of the screen.
 */
export async function buildLeaderboard(
  userId: string,
  dayKey: string,
  range: LeaderboardRange,
): Promise<Leaderboard> {
  const db = await getDb();
  const friendIds = await getFriendIds(userId);
  const ids = [userId, ...friendIds];
  const placeholders = ids.map(() => '?').join(', ');

  let rows: Array<{ id: string; username: string; avatar: string | null; total: number | string }>;

  const window = rangeWindow(range, dayKey);
  if (window === null) {
    // All time uses the cached lifetime column - no need to sum every day.
    rows = await db.all(
      `SELECT id, username, avatar, lifetime_pushups AS total
         FROM users
        WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      ids,
    );
  } else {
    rows = await db.all(
      `SELECT u.id, u.username, u.avatar, COALESCE(SUM(d.pushup_count), 0) AS total
         FROM users u
         LEFT JOIN daily_stats d
                ON d.user_id = u.id AND d.day_key >= ? AND d.day_key <= ?
        WHERE u.id IN (${placeholders}) AND u.deleted_at IS NULL
        GROUP BY u.id, u.username, u.avatar`,
      [window.from, window.to, ...ids],
    );
  }

  const entries: LeaderboardEntry[] = rows
    .map((row) => ({
      userId: row.id,
      username: row.username,
      avatar: row.avatar,
      total: num(row.total),
      rank: 0,
      isSelf: row.id === userId,
    }))
    // Ties are broken alphabetically so the order never flickers between loads.
    .sort((a, b) => (b.total - a.total) || a.username.localeCompare(b.username));

  entries.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  const self = entries.find((e) => e.isSelf) ?? null;
  const message = buildMotivationalMessage(entries, self, range);

  return {
    range,
    entries,
    selfRank: self?.rank ?? null,
    selfTotal: self?.total ?? 0,
    message,
    friendCount: friendIds.length,
  };
}

/**
 * The little line of encouragement under the leaderboard. Kept deliberately
 * positive - we nudge people up, we never shame them for a low number.
 */
export function buildMotivationalMessage(
  entries: LeaderboardEntry[],
  self: LeaderboardEntry | null,
  range: LeaderboardRange,
): string | null {
  if (!self || entries.length <= 1) return null;

  const when = range === 'today' ? 'today' : range === 'week' ? 'this week' : range === 'month' ? 'this month' : 'all time';

  // Nobody has done anything yet. A "you're tied for #1" message would be
  // technically true and completely hollow, so say nothing and let the
  // dashboard's call to action do the work.
  if (self.total === 0 && entries.every((entry) => entry.total === 0)) return null;

  if (self.rank === 1) {
    const second = entries[1];
    const lead = self.total - second.total;
    if (lead === 0) return `🥇 You're tied for #1 ${when}. Time to break it!`;
    return `🥇 You're #1 ${when} with a ${lead.toLocaleString()} push-up lead. Defend it!`;
  }

  const ahead = entries[self.rank - 2];
  if (!ahead) return null;
  const gap = ahead.total - self.total;

  if (gap === 0) {
    return `🔥 You're level with ${ahead.username} ${when} - one more set takes the lead!`;
  }
  if (self.total === 0) {
    return `You're #${self.rank} ${when}. One set and you're on the board.`;
  }
  if (gap === 1) {
    return `🔥 Just 1 push-up behind ${ahead.username}. You've got this!`;
  }
  if (gap <= 20) {
    return `🔥 ${gap} more push-ups and you'll pass ${ahead.username}!`;
  }
  return `You're only ${gap.toLocaleString()} push-ups behind ${ahead.username}. Start with 10.`;
}

/** Today's totals for you and every friend, used by the dashboard and Friends page. */
export async function getFriendSummaries(userId: string, dayKey: string): Promise<FriendSummary[]> {
  const db = await getDb();
  const friendIds = await getFriendIds(userId);
  if (friendIds.length === 0) return [];

  const placeholders = friendIds.map(() => '?').join(', ');
  const rows = await db.all<{
    id: string;
    username: string;
    avatar: string | null;
    lifetime_pushups: number;
    current_streak: number;
    personal_best: number;
    today: number | string;
    week: number | string;
    month: number | string;
  }>(
    `SELECT u.id, u.username, u.avatar, u.lifetime_pushups, u.current_streak, u.personal_best,
            COALESCE(SUM(CASE WHEN d.day_key = ? THEN d.pushup_count ELSE 0 END), 0) AS today,
            COALESCE(SUM(CASE WHEN d.day_key >= ? AND d.day_key <= ? THEN d.pushup_count ELSE 0 END), 0) AS week,
            COALESCE(SUM(CASE WHEN d.day_key >= ? AND d.day_key <= ? THEN d.pushup_count ELSE 0 END), 0) AS month
       FROM users u
       LEFT JOIN daily_stats d ON d.user_id = u.id
      WHERE u.id IN (${placeholders}) AND u.deleted_at IS NULL
      GROUP BY u.id, u.username, u.avatar, u.lifetime_pushups, u.current_streak, u.personal_best`,
    [dayKey, startOfWeek(dayKey), dayKey, startOfMonth(dayKey), dayKey, ...friendIds],
  );

  return rows
    .map((row) => ({
      userId: row.id,
      username: row.username,
      avatar: row.avatar,
      today: num(row.today),
      week: num(row.week),
      month: num(row.month),
      lifetime: num(row.lifetime_pushups),
      currentStreak: num(row.current_streak),
      personalBest: num(row.personal_best),
    }))
    .sort((a, b) => b.today - a.today || a.username.localeCompare(b.username));
}

// ---------------------------------------------------------------------------
// Friend requests
// ---------------------------------------------------------------------------

export type RequestOutcome =
  | { ok: true; status: 'requested' | 'accepted' | 'already_friends' | 'already_pending' }
  | { ok: false; error: string };

/**
 * Sends a friend request, or accepts one automatically when the other person
 * had already invited you (mutual intent needs no extra click).
 */
export async function sendFriendRequest(fromId: string, toId: string): Promise<RequestOutcome> {
  const db = await getDb();
  if (fromId === toId) return { ok: false, error: "You can't add yourself." };

  const target = await db.get<{ id: string }>('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL', [toId]);
  if (!target) return { ok: false, error: 'That user could not be found.' };

  const existing = await db.get<{ id: string; requester_id: string; recipient_id: string; status: string }>(
    `SELECT id, requester_id, recipient_id, status FROM friendships
      WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)`,
    [fromId, toId, toId, fromId],
  );

  if (existing) {
    if (existing.status === 'blocked') {
      return { ok: false, error: 'That user is unavailable.' };
    }
    if (existing.status === 'accepted') return { ok: true, status: 'already_friends' };
    if (existing.status === 'pending') {
      if (existing.requester_id === toId) {
        // They already invited you - accept it.
        await db.run('UPDATE friendships SET status = ?, updated_at = ? WHERE id = ?', [
          'accepted', nowIso(), existing.id,
        ]);
        await notify(toId, 'friend_accepted', `${(await username(fromId)) ?? 'Someone'} accepted your friend request.`, '🤝');
        return { ok: true, status: 'accepted' };
      }
      return { ok: true, status: 'already_pending' };
    }
  }

  await db.run(
    `INSERT INTO friendships (id, requester_id, recipient_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
    [newId(), fromId, toId, nowIso(), nowIso()],
  );
  await notify(toId, 'friend_request', `${(await username(fromId)) ?? 'Someone'} wants to be your friend.`, '🤝');
  return { ok: true, status: 'requested' };
}

async function username(userId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.get<{ username: string }>('SELECT username FROM users WHERE id = ?', [userId]);
  return row?.username ?? null;
}

export interface PendingRequest {
  friendshipId: string;
  userId: string;
  username: string;
  avatar: string | null;
  createdAt: string;
  direction: 'incoming' | 'outgoing';
}

export async function getPendingRequests(userId: string): Promise<PendingRequest[]> {
  const db = await getDb();
  const rows = await db.all<{
    id: string;
    requester_id: string;
    recipient_id: string;
    created_at: string;
    username: string;
    avatar: string | null;
  }>(
    `SELECT f.id, f.requester_id, f.recipient_id, f.created_at, u.username, u.avatar
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.recipient_id ELSE f.requester_id END
      WHERE f.status = 'pending' AND (f.requester_id = ? OR f.recipient_id = ?)
        AND u.deleted_at IS NULL
      ORDER BY f.created_at DESC`,
    [userId, userId, userId],
  );

  return rows.map((row) => ({
    friendshipId: row.id,
    userId: row.requester_id === userId ? row.recipient_id : row.requester_id,
    username: row.username,
    avatar: row.avatar,
    createdAt: row.created_at,
    direction: row.requester_id === userId ? 'outgoing' : 'incoming',
  }));
}

export async function respondToRequest(
  userId: string,
  friendshipId: string,
  action: 'accept' | 'reject',
): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  const row = await db.get<{ id: string; requester_id: string; recipient_id: string; status: string }>(
    'SELECT id, requester_id, recipient_id, status FROM friendships WHERE id = ?',
    [friendshipId],
  );
  // Only the person who received the request may accept or reject it.
  if (!row || row.recipient_id !== userId || row.status !== 'pending') {
    return { ok: false, error: 'That friend request is no longer available.' };
  }

  if (action === 'accept') {
    await db.run('UPDATE friendships SET status = ?, updated_at = ? WHERE id = ?', ['accepted', nowIso(), row.id]);
    await notify(row.requester_id, 'friend_accepted', `${(await username(userId)) ?? 'Someone'} accepted your friend request.`, '🤝');
  } else {
    await db.run('DELETE FROM friendships WHERE id = ?', [row.id]);
  }
  return { ok: true };
}

export async function removeFriend(userId: string, otherId: string): Promise<void> {
  const db = await getDb();
  await db.run(
    `DELETE FROM friendships
      WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)`,
    [userId, otherId, otherId, userId],
  );
}

/**
 * Blocking is stored as a friendship row with status 'blocked' and the blocker
 * recorded, so the link cannot be re-created from either side until unblocked.
 */
export async function blockUser(userId: string, otherId: string): Promise<void> {
  const db = await getDb();
  await db.run(
    `DELETE FROM friendships
      WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)`,
    [userId, otherId, otherId, userId],
  );
  await db.run(
    `INSERT INTO friendships (id, requester_id, recipient_id, status, blocked_by, created_at, updated_at)
     VALUES (?, ?, ?, 'blocked', ?, ?, ?)`,
    [newId(), userId, otherId, userId, nowIso(), nowIso()],
  );
}

export async function unblockUser(userId: string, otherId: string): Promise<void> {
  const db = await getDb();
  await db.run('DELETE FROM friendships WHERE status = ? AND blocked_by = ? AND recipient_id = ?', [
    'blocked', userId, otherId,
  ]);
}

// ---------------------------------------------------------------------------
// Search and profiles
// ---------------------------------------------------------------------------

export interface SearchResult {
  userId: string;
  username: string;
  avatar: string | null;
  relation: 'none' | 'pending_outgoing' | 'pending_incoming' | 'friends' | 'blocked';
}

export async function searchUsers(userId: string, query: string): Promise<SearchResult[]> {
  const db = await getDb();
  const term = query.trim();
  if (term.length < 2) return [];

  const blocked = await getBlockedIds(userId);
  const pattern = `%${term.toLowerCase()}%`;

  const rows = await db.all<{ id: string; username: string; avatar: string | null }>(
    `SELECT id, username, avatar FROM users
      WHERE deleted_at IS NULL
        AND id <> ?
        AND (LOWER(username) LIKE ? OR UPPER(friend_code) = ?)
      ORDER BY username ASC
      LIMIT 20`,
    [userId, pattern, term.toUpperCase()],
  );

  const results: SearchResult[] = [];
  for (const row of rows) {
    if (blocked.includes(row.id)) continue;
    const link = await db.get<{ requester_id: string; recipient_id: string; status: string }>(
      `SELECT requester_id, recipient_id, status FROM friendships
        WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)`,
      [userId, row.id, row.id, userId],
    );
    let relation: SearchResult['relation'] = 'none';
    if (link?.status === 'accepted') relation = 'friends';
    else if (link?.status === 'pending') {
      relation = link.requester_id === userId ? 'pending_outgoing' : 'pending_incoming';
    } else if (link?.status === 'blocked') relation = 'blocked';
    results.push({ userId: row.id, username: row.username, avatar: row.avatar, relation });
  }
  return results;
}

export interface PublicProfile {
  userId: string;
  username: string;
  avatar: string | null;
  joinedAt: string;
  currentStreak: number;
  longestStreak: number;
  personalBest: number;
  lifetime: number;
  today: number;
  week: number;
  month: number;
  averageDaily: number;
  activeDays: number;
  ranking: number | null;
  friendCount: number;
  isSelf: boolean;
  isFriend: boolean;
  /** Only ever populated for your own profile. */
  friendCode: string | null;
}

/**
 * Profile for another user. Throws nothing - returns null when the viewer is
 * not allowed to see this person (blocked, or simply not friends yet).
 */
export async function getPublicProfile(
  viewerId: string,
  targetId: string,
  dayKey: string,
): Promise<PublicProfile | PublicProfileLimited | null> {
  const db = await getDb();
  const blocked = await getBlockedIds(viewerId);
  if (blocked.includes(targetId)) return null;

  const row = await db.get<{
    id: string;
    username: string;
    avatar: string | null;
    created_at: string;
    friend_code: string;
    current_streak: number;
    longest_streak: number;
    personal_best: number;
    lifetime_pushups: number;
    avg_daily_pushups: number;
    active_days: number;
  }>('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [targetId]);
  if (!row) return null;

  const isSelf = viewerId === targetId;
  const isFriend = isSelf ? true : await areFriends(viewerId, targetId);
  const stats = await getUserStats(targetId, dayKey);

  if (!isFriend) {
    // Someone you have not added yet sees only a public summary. No streak, no
    // daily numbers - just enough to decide whether to add them.
    return {
      userId: row.id,
      username: row.username,
      avatar: row.avatar,
      joinedAt: row.created_at,
      lifetime: stats.lifetime,
      personalBest: stats.personalBest,
      isSelf: false,
      isFriend: false,
      friendCode: null,
      limited: true,
    } as PublicProfileLimited;
  }

  const leaderboard = await buildLeaderboard(viewerId, dayKey, 'today');
  const rank = leaderboard.entries.findIndex((e) => e.userId === targetId);
  const friendIds = await getFriendIds(targetId);

  return {
    userId: row.id,
    username: row.username,
    avatar: row.avatar,
    joinedAt: row.created_at,
    currentStreak: stats.currentStreak,
    longestStreak: stats.longestStreak,
    personalBest: stats.personalBest,
    lifetime: stats.lifetime,
    today: stats.today,
    week: stats.week,
    month: stats.month,
    averageDaily: stats.averageDaily,
    activeDays: stats.activeDays,
    ranking: rank >= 0 ? rank + 1 : null,
    friendCount: friendIds.length,
    isSelf,
    isFriend,
    friendCode: isSelf ? row.friend_code : null,
  };
}

export interface PublicProfileLimited {
  userId: string;
  username: string;
  avatar: string | null;
  joinedAt: string;
  lifetime: number;
  personalBest: number;
  isSelf: false;
  isFriend: false;
  friendCode: null;
  limited: true;
}

export function isLimitedProfile(
  profile: PublicProfile | PublicProfileLimited,
): profile is PublicProfileLimited {
  return (profile as PublicProfileLimited).limited === true;
}

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

export async function findUserByFriendCode(code: string): Promise<{ id: string; username: string; avatar: string | null } | null> {
  const db = await getDb();
  const row = await db.get<{ id: string; username: string; avatar: string | null }>(
    'SELECT id, username, avatar FROM users WHERE friend_code = ? AND deleted_at IS NULL',
    [code.toUpperCase()],
  );
  return row ?? null;
}

/**
 * Called right after sign-up when the user arrived through an invite link.
 *
 * The two accounts become friends IMMEDIATELY rather than waiting for the
 * inviter to accept. Sharing your personal invite link is explicit consent to
 * be added, and making people approve a request they themselves triggered is
 * friction with no security benefit.
 *
 * The one exception is a blocked relationship: if the inviter has blocked this
 * person (or vice versa) the link does nothing, so blocking cannot be bypassed
 * by re-registering.
 */
export async function acceptInvite(newUserId: string, inviterCode: string): Promise<RequestOutcome> {
  const db = await getDb();
  const inviter = await findUserByFriendCode(inviterCode);
  if (!inviter) return { ok: false, error: 'That invite link is no longer valid.' };
  if (inviter.id === newUserId) return { ok: false, error: "You can't invite yourself." };

  const existing = await db.get<{ id: string; status: string }>(
    `SELECT id, status FROM friendships
      WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)`,
    [newUserId, inviter.id, inviter.id, newUserId],
  );

  if (existing) {
    if (existing.status === 'blocked') {
      return { ok: false, error: 'That invite link is not available.' };
    }
    if (existing.status === 'accepted') return { ok: true, status: 'already_friends' };
    // A pending request already exists in one direction - just complete it.
    await db.run('UPDATE friendships SET status = ?, updated_at = ? WHERE id = ?', [
      'accepted', nowIso(), existing.id,
    ]);
    await notify(inviter.id, 'friend_accepted', `Someone joined with your invite link - you're now friends!`, '🤝');
    return { ok: true, status: 'accepted' };
  }

  await db.run(
    `INSERT INTO friendships (id, requester_id, recipient_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'accepted', ?, ?)`,
    [newId(), newUserId, inviter.id, nowIso(), nowIso()],
  );
  await notify(
    inviter.id,
    'friend_invite_used',
    `${(await username(newUserId)) ?? 'Someone'} joined with your invite link - you're now friends!`,
    '🤝',
  );
  return { ok: true, status: 'accepted' };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function notify(
  userId: string,
  type: string,
  message: string,
  icon: string | null = null,
): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO notifications (id, user_id, type, message, icon, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [newId(), userId, type, message, icon, nowIso()],
  );
}

export async function listNotifications(userId: string, limit = 30): Promise<Array<{
  id: string;
  type: string;
  message: string;
  icon: string | null;
  createdAt: string;
  read: boolean;
}>> {
  const db = await getDb();
  const rows = await db.all<{ id: string; type: string; message: string; icon: string | null; created_at: string; read_at: string | null }>(
    'SELECT id, type, message, icon, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    message: row.message,
    icon: row.icon,
    createdAt: row.created_at,
    read: row.read_at !== null,
  }));
}

export async function markNotificationsRead(userId: string): Promise<void> {
  const db = await getDb();
  await db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [nowIso(), userId]);
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  const db = await getDb();
  const row = await db.get<{ total: number | string | null }>(
    'SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND read_at IS NULL',
    [userId],
  );
  return num(row?.total);
}

/**
 * Tells your friends when you overtake them today. Deliberately rate-limited:
 * at most one "passed you" notification per friend per 6 hours, so this can
 * never turn into spam.
 */
export async function notifyFriendsOfOvertake(userId: string, dayKey: string): Promise<void> {
  const db = await getDb();
  const me = await db.get<{ username: string; notify_enabled: number | boolean }>(
    'SELECT username, notify_enabled FROM users WHERE id = ?',
    [userId],
  );
  if (!me) return;

  const leaderboard = await buildLeaderboard(userId, dayKey, 'today');
  const self = leaderboard.entries.find((e) => e.isSelf);
  if (!self || self.total === 0) return;

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  for (const entry of leaderboard.entries) {
    if (entry.isSelf) continue;
    if (entry.total === 0) continue; // never gloat at someone who has not started
    if (self.total <= entry.total) continue;

    const recent = await db.get<{ id: string }>(
      `SELECT id FROM notifications
        WHERE user_id = ? AND type = 'overtaken' AND message LIKE ? AND created_at > ?
        LIMIT 1`,
      [entry.userId, `%${me.username}%`, sixHoursAgo],
    );
    if (recent) continue;

    const target = await db.get<{ notify_enabled: number | boolean }>(
      'SELECT notify_enabled FROM users WHERE id = ?',
      [entry.userId],
    );
    if (target && num(target.notify_enabled) === 0) continue;

    await notify(entry.userId, 'overtaken', `💪 ${me.username} just passed you!`, '💪');
  }
}

export type { UserStats };
