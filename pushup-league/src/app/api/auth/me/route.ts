import { getCurrentUser } from '@/lib/auth';
import { guard, json } from '@/lib/api';
import { getDb, num } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Who am I?" - the first call the app makes on load. Also reports whether the
 * device has any passkeys registered, so the login screen knows whether to
 * offer the "Sign in with Face ID / Windows Hello" button.
 */
export async function GET(): Promise<Response> {
  return guard(async () => {
    const user = await getCurrentUser();
    if (!user) return json({ user: null });

    const db = await getDb();
    const credentialCount = await db.get<{ total: number | string | null }>(
      'SELECT COUNT(*) AS total FROM webauthn_credentials WHERE user_id = ?',
      [user.id],
    );

    return json({ user, passkeyCount: num(credentialCount?.total) });
  });
}
