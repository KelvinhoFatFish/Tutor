import { requireUser } from '@/lib/auth';
import { guard, json } from '@/lib/api';
import { getUserStats, sanitizeDayKey } from '@/lib/stats';
import { getUserAchievements } from '@/lib/achievements';
import { buildLeaderboard } from '@/lib/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Everything the dashboard and profile screens need, in one request:
 * today/week/month/lifetime totals, streaks, the 14-day chart series,
 * achievements and your current leaderboard position.
 *
 * The `day` query parameter is the browser's own local date, so someone in
 * another time zone still sees their own "today".
 */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const url = new URL(request.url);
    const dayKey = sanitizeDayKey(url.searchParams.get('day'));

    const stats = await getUserStats(user.id, dayKey);
    const achievements = await getUserAchievements(user.id, dayKey);
    const leaderboard = await buildLeaderboard(user.id, dayKey, 'today');

    return json({ dayKey, stats, achievements, leaderboard });
  });
}
