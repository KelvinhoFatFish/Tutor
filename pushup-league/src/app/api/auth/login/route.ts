import { getDb } from '@/lib/db';
import { createSession, setSessionCookie, toSessionUser, verifyPassword } from '@/lib/auth';
import { badRequest, guard, json, readJson } from '@/lib/api';
import { normaliseEmail } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Email + password sign-in. This is the fallback for anyone whose device does
 * not support passkeys, or who simply prefers a password.
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const body = await readJson<{ email?: string; password?: string }>(request);
    if (!body) return badRequest('We could not read that request. Please try again.');

    const email = normaliseEmail(body.email);
    const password = String(body.password ?? '');
    if (!email || !password) return badRequest('Enter your email and password.');

    const db = await getDb();
    const row = await db.get<Parameters<typeof toSessionUser>[0] & { password_hash: string | null }>(
      'SELECT * FROM users WHERE email_lower = ? AND deleted_at IS NULL',
      [email],
    );

    // Always run the hash comparison, even when the account does not exist, so
    // the response time does not reveal which emails are registered.
    const stored = row?.password_hash ?? null;
    const valid = await verifyPassword(password, stored);

    if (!row || !valid) {
      return badRequest('That email and password combination did not work.', 401);
    }

    const token = await createSession(row.id, request.headers.get('user-agent'));
    await setSessionCookie(token);

    return json({ user: toSessionUser(row) });
  });
}
