import { requireUser } from '@/lib/auth';
import { badRequest, guard, json } from '@/lib/api';
import { sanitizeDayKey } from '@/lib/stats';
import { deleteChallenge, getChallenge, joinChallenge, leaveChallenge } from '@/lib/challenges';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Full detail for one challenge, including the live ranking. */
export async function GET(request: Request, context: Context): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const { id } = await context.params;
    const url = new URL(request.url);
    const dayKey = sanitizeDayKey(url.searchParams.get('day'));

    const challenge = await getChallenge(id, user.id, dayKey);
    if (!challenge) return badRequest('That challenge could not be found.', 404);
    return json({ challenge });
  });
}

/** Join or leave a challenge. */
export async function POST(request: Request, context: Context): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const { id } = await context.params;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'leave') {
      await leaveChallenge(id, user.id);
      return json({ ok: true, left: true });
    }

    await joinChallenge(id, user.id);
    return json({ ok: true, joined: true });
  });
}

/** Only the creator can delete a challenge. */
export async function DELETE(_request: Request, context: Context): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const { id } = await context.params;
    const deleted = await deleteChallenge(id, user.id);
    if (!deleted) return badRequest('Only the person who created a challenge can delete it.', 403);
    return json({ ok: true });
  });
}
