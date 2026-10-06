import { requireUser } from '@/lib/auth';
import { guard, json } from '@/lib/api';
import { searchUsers } from '@/lib/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Search by username (partial match) or by exact 6-character friend code.
 * Email addresses are never searchable and never returned.
 */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const url = new URL(request.url);
    const query = url.searchParams.get('q') ?? '';
    const results = await searchUsers(user.id, query);
    return json({ results });
  });
}
