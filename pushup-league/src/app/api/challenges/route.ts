import { requireUser } from '@/lib/auth';
import { badRequest, guard, json, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { sanitizeDayKey } from '@/lib/stats';
import { createChallenge, listChallenges, type ChallengeType } from '@/lib/challenges';
import { getFriendIds, notify } from '@/lib/social';
import { validateMessage } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lists the challenges you are part of, with live scoreboards.
 */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const url = new URL(request.url);
    const dayKey = sanitizeDayKey(url.searchParams.get('day'));
    const challenges = await listChallenges(user.id, dayKey);

    const friendIds = await getFriendIds(user.id);
    const db = await getDb();
    const friends: Array<{ userId: string; username: string; avatar: string | null }> = [];
    for (const id of friendIds) {
      const row = await db.get<{ id: string; username: string; avatar: string | null }>(
        'SELECT id, username, avatar FROM users WHERE id = ?',
        [id],
      );
      if (row) friends.push({ userId: row.id, username: row.username, avatar: row.avatar });
    }

    return json({ dayKey, challenges, friends });
  });
}

interface CreateBody {
  name?: string;
  description?: string;
  type?: ChallengeType;
  target?: number;
  startDate?: string;
  endDate?: string;
  invitees?: string[];
}

/**
 * Creates a challenge and invites friends to it.
 *
 * Only people who are actually your friends can be added, so this cannot be
 * used to spam strangers.
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const body = await readJson<CreateBody>(request);
    if (!body) return badRequest('We could not read that challenge.');

    const name = validateMessage(body.name, 60);
    if (name.length < 3) return badRequest('Give your challenge a name of at least 3 characters.');

    const type: ChallengeType = body.type === 'first_to' ? 'first_to' : 'total';

    const startDate = String(body.startDate ?? '').slice(0, 10);
    const endDate = String(body.endDate ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return badRequest('Please choose a start and end date.');
    }
    if (endDate < startDate) return badRequest('The end date must be on or after the start date.');

    const spanDays =
      Math.round(
        (new Date(`${endDate}T12:00:00`).getTime() - new Date(`${startDate}T12:00:00`).getTime()) / 86400000,
      ) + 1;
    if (spanDays > 365) return badRequest('Challenges can be at most one year long.');

    const targetRaw = Number(body.target);
    const target = Number.isFinite(targetRaw) && targetRaw > 0 ? Math.min(1_000_000, Math.round(targetRaw)) : null;

    // Only real friends can be invited.
    const friendIds = new Set(await getFriendIds(user.id));
    const invitees = (Array.isArray(body.invitees) ? body.invitees : [])
      .filter((id): id is string => typeof id === 'string' && friendIds.has(id));

    const challengeId = await createChallenge({
      creatorId: user.id,
      name,
      description: validateMessage(body.description, 300) || null,
      type,
      target,
      startDate,
      endDate,
      invitees,
    });

    for (const invitee of invitees) {
      await notify(invitee, 'challenge_invite', `🔥 ${user.username} added you to "${name}"`, '🔥');
    }

    return json({ ok: true, challengeId }, { status: 201 });
  });
}
