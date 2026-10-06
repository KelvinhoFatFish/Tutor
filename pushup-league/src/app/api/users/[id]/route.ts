import { requireUser } from '@/lib/auth';
import { badRequest, guard, json } from '@/lib/api';
import { sanitizeDayKey } from '@/lib/stats';
import { getPublicProfile, isLimitedProfile } from '@/lib/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Another user's profile.
 *
 * Two levels of visibility:
 *   - Friends (and yourself) see streaks, daily numbers and ranking.
 *   - Everyone else sees only a public summary, so friend codes and daily
 *     activity are not exposed to strangers.
 *
 * With either level, the email address is never included - `getPublicProfile`
 * does not even select that column.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const { id } = await context.params;
    const url = new URL(request.url);
    const dayKey = sanitizeDayKey(url.searchParams.get('day'));

    const profile = await getPublicProfile(user.id, id, dayKey);
    if (!profile) return badRequest('That profile is not available.', 404);

    return json({ profile, limited: isLimitedProfile(profile) });
  });
}
