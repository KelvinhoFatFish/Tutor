import { requireUser } from '@/lib/auth';
import { guard, json } from '@/lib/api';
import { sanitizeDayKey } from '@/lib/stats';
import { buildLeaderboard, type LeaderboardRange } from '@/lib/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RANGES: LeaderboardRange[] = ['today', 'week', 'month', 'all'];

/**
 * The friend leaderboard. Only you and your accepted friends appear, so a
 * stranger can never see your numbers.
 */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const url = new URL(request.url);
    const requested = (url.searchParams.get('range') ?? 'today') as LeaderboardRange;
    const range = RANGES.includes(requested) ? requested : 'today';
    const dayKey = sanitizeDayKey(url.searchParams.get('day'));

    const leaderboard = await buildLeaderboard(user.id, dayKey, range);
    return json({ dayKey, ...leaderboard });
  });
}
