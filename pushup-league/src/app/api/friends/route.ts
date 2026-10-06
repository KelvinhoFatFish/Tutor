import { requireUser } from '@/lib/auth';
import { badRequest, guard, json, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { sanitizeDayKey } from '@/lib/stats';
import {
  blockUser,
  getFriendSummaries,
  getPendingRequests,
  removeFriend,
  searchUsers,
  sendFriendRequest,
  unblockUser,
} from '@/lib/social';
import { normaliseFriendCode, validateUsername } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Friends list (with their totals) plus any pending requests. */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const url = new URL(request.url);
    const dayKey = sanitizeDayKey(url.searchParams.get('day'));

    const [friends, requests] = await Promise.all([
      getFriendSummaries(user.id, dayKey),
      getPendingRequests(user.id),
    ]);

    return json({
      dayKey,
      friends,
      incoming: requests.filter((r) => r.direction === 'incoming'),
      outgoing: requests.filter((r) => r.direction === 'outgoing'),
      friendCode: user.friend_code,
    });
  });
}

/**
 * Sends a friend request. You can add someone by username, by their 6-character
 * friend code, or by user id (used by invite links).
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const body = await readJson<{ userId?: string; username?: string; friendCode?: string }>(request);
    if (!body) return badRequest('We could not read that request.');

    const db = await getDb();
    let targetId: string | null = null;

    if (body.userId) {
      targetId = String(body.userId);
    } else if (body.friendCode) {
      const code = normaliseFriendCode(body.friendCode);
      const found = await db.get<{ id: string }>(
        'SELECT id FROM users WHERE friend_code = ? AND deleted_at IS NULL',
        [code],
      );
      if (found) targetId = found.id;
      else return badRequest('No one has that friend code. Double-check the six characters.');
    } else if (body.username) {
      const username = validateUsername(body.username);
      if (!username.ok) return badRequest(username.error!);
      const found = await db.get<{ id: string }>(
        'SELECT id FROM users WHERE username_lower = ? AND deleted_at IS NULL',
        [username.value!.toLowerCase()],
      );
      if (found) targetId = found.id;
      else return badRequest('We could not find anyone with that username.');
    } else {
      return badRequest('Enter a username or a friend code.');
    }

    const outcome = await sendFriendRequest(user.id, targetId);
    if (!outcome.ok) return badRequest(outcome.error);
    return json({ ok: true, status: outcome.status });
  });
}

/** Removes a friend (or cancels an outgoing request, or declines one). */
export async function DELETE(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    if (!userId) return badRequest('Which friend would you like to remove?');

    await removeFriend(user.id, userId);
    return json({ ok: true });
  });
}

/** Blocks or unblocks someone. `?action=unblock` reverses it. */
export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const body = await readJson<{ userId?: string; action?: 'block' | 'unblock' }>(request);
    if (!body?.userId) return badRequest('Which user?');

    if (body.action === 'unblock') {
      await unblockUser(user.id, body.userId);
      return json({ ok: true, blocked: false });
    }
    await blockUser(user.id, body.userId);
    return json({ ok: true, blocked: true });
  });
}

/** Search for people to add. Also exposed via /api/friends/search. */
export async function PUT(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const body = await readJson<{ query?: string }>(request);
    const results = await searchUsers(user.id, String(body?.query ?? ''));
    return json({ results });
  });
}
