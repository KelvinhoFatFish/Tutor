import { getDb, newId, newFriendCode, nowIso } from '@/lib/db';
import { createSession, hashPassword, setSessionCookie, toSessionUser, verifyPassword } from '@/lib/auth';
import { badRequest, guard, json, readJson } from '@/lib/api';
import {
  normaliseFriendCode,
  validateEmail,
  validatePassword,
  validateUsername,
} from '@/lib/validation';
import { acceptInvite } from '@/lib/social';
import { checkAchievements } from '@/lib/achievements';
import { todayKey } from '@/lib/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RegisterBody {
  email?: string;
  password?: string;
  username?: string;
  inviteCode?: string;
  /** Explicit consent to biometric processing. Required to be true. */
  biometricConsent?: boolean;
}

/**
 * Creates an account with email + password.
 *
 * If the person arrived through an invite link (`/invite/ABC123`) we also send
 * a friend request to whoever invited them, so the two are connected the moment
 * the account exists.
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const body = await readJson<RegisterBody>(request);
    if (!body) return badRequest('We could not read that request. Please try again.');

    const email = validateEmail(body.email);
    if (!email.ok) return badRequest(email.error!);

    const username = validateUsername(body.username);
    if (!username.ok) return badRequest(username.error!);

    const password = validatePassword(body.password);
    if (!password.ok) return badRequest(password.error!);

    const db = await getDb();

    const clash = await db.get<{ id: string }>(
      'SELECT id FROM users WHERE email_lower = ? AND deleted_at IS NULL',
      [email.value!.toLowerCase()],
    );
    if (clash) return badRequest('An account with that email already exists. Try logging in instead.');

    const nameClash = await db.get<{ id: string }>(
      'SELECT id FROM users WHERE username_lower = ? AND deleted_at IS NULL',
      [username.value!.toLowerCase()],
    );
    if (nameClash) return badRequest('That username is taken. Please choose another one.');

    const id = newId();
    const passwordHash = await hashPassword(password.value!);

    // Friend codes are 6 characters from a 32-letter alphabet, so collisions are
    // rare - but we still retry rather than fail the sign-up.
    let friendCode = newFriendCode();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const taken = await db.get<{ id: string }>('SELECT id FROM users WHERE friend_code = ?', [friendCode]);
      if (!taken) break;
      friendCode = newFriendCode();
    }

    await db.run(
      `INSERT INTO users
         (id, username, username_lower, email, email_lower, password_hash, avatar, friend_code,
          face_auth_enabled, biometric_consent_at, created_at, onboarded, notify_enabled, notify_frequency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 1, 'normal')`,
      [
        id,
        username.value!,
        username.value!.toLowerCase(),
        email.value!,
        email.value!.toLowerCase(),
        passwordHash,
        null,
        friendCode,
        body.biometricConsent ? nowIso() : null,
        nowIso(),
      ],
    );

    // Connect the invite if one was used. Failure here must not block sign-up.
    const inviteCode = normaliseFriendCode(body.inviteCode);
    let invited = false;
    if (inviteCode.length === 6) {
      try {
        const result = await acceptInvite(id, inviteCode);
        invited = result.ok;
      } catch (error) {
        console.error('[register] invite failed', error);
      }
    }

    const token = await createSession(id, request.headers.get('user-agent'));
    await setSessionCookie(token);

    try {
      await checkAchievements(id, todayKey());
    } catch (error) {
      console.error('[register] achievements failed', error);
    }

    const row = await db.get<Parameters<typeof toSessionUser>[0]>('SELECT * FROM users WHERE id = ?', [id]);

    return json({ user: row ? toSessionUser(row) : null, invited }, { status: 201 });
  });
}
