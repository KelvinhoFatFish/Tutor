import { requireUser } from '@/lib/auth';
import { badRequest, guard, json, readJson } from '@/lib/api';
import { respondToRequest } from '@/lib/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Accept or reject a friend request.
 *
 * `respondToRequest` checks in the database that you are the *recipient* of
 * that specific pending request, so nobody can accept a request on someone
 * else's behalf by guessing an id.
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const body = await readJson<{ friendshipId?: string; action?: 'accept' | 'reject' }>(request);
    if (!body?.friendshipId) return badRequest('That friend request could not be found.');
    if (body.action !== 'accept' && body.action !== 'reject') {
      return badRequest('Choose either accept or reject.');
    }

    const result = await respondToRequest(user.id, body.friendshipId, body.action);
    if (!result.ok) return badRequest(result.error ?? 'That did not work.');
    return json({ ok: true, action: body.action });
  });
}
