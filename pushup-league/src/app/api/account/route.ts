import { getDb, nowIso } from '@/lib/db';
import { clearSessionCookie, requireUser, toSessionUser } from '@/lib/auth';
import { badRequest, guard, json, readJson } from '@/lib/api';
import { validateAvatar, validateUsername } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Updates the signed-in user's own profile.
 *
 * Note there is no `userId` parameter anywhere: the row being changed is
 * determined by the session cookie alone. That is what makes it impossible for
 * one user to edit another user's profile, regardless of what the browser sends.
 */
export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const body = await readJson<{
      username?: string;
      avatar?: string;
      onboarded?: boolean;
      notifyEnabled?: boolean;
      notifyFrequency?: string;
      biometricConsent?: boolean;
    }>(request);
    if (!body) return badRequest('We could not read that request.');

    const db = await getDb();
    const updates: string[] = [];
    const params: unknown[] = [];

    if (body.username !== undefined) {
      const username = validateUsername(body.username);
      if (!username.ok) return badRequest(username.error!);
      const clash = await db.get<{ id: string }>(
        'SELECT id FROM users WHERE username_lower = ? AND id <> ? AND deleted_at IS NULL',
        [username.value!.toLowerCase(), user.id],
      );
      if (clash) return badRequest('That username is taken. Please choose another one.');
      updates.push('username = ?', 'username_lower = ?');
      params.push(username.value!, username.value!.toLowerCase());
    }

    if (body.avatar !== undefined) {
      const avatar = validateAvatar(body.avatar);
      if (!avatar.ok) return badRequest(avatar.error!);
      updates.push('avatar = ?');
      params.push(avatar.value || null);
    }

    if (body.onboarded !== undefined) {
      updates.push('onboarded = ?');
      params.push(body.onboarded ? 1 : 0);
    }

    if (body.notifyEnabled !== undefined) {
      updates.push('notify_enabled = ?');
      params.push(body.notifyEnabled ? 1 : 0);
    }

    if (body.notifyFrequency !== undefined) {
      const allowed = ['off', 'minimal', 'normal', 'chatty'];
      if (!allowed.includes(body.notifyFrequency)) return badRequest('Unknown notification frequency.');
      updates.push('notify_frequency = ?');
      params.push(body.notifyFrequency);
    }

    if (body.biometricConsent === true && !user.biometric_consent_at) {
      updates.push('biometric_consent_at = ?');
      params.push(nowIso());
    }

    if (updates.length > 0) {
      params.push(user.id);
      await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const row = await db.get<Parameters<typeof toSessionUser>[0]>('SELECT * FROM users WHERE id = ?', [user.id]);
    return json({ user: row ? toSessionUser(row) : null });
  });
}

/**
 * Permanently deletes the account and every trace of it.
 *
 * We do a real delete rather than a "hidden" flag, because the whole point of
 * this button is that your data is gone. The confirmation phrase is checked
 * here as well as in the UI so a stray click cannot wipe an account.
 */
export async function DELETE(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const body = await readJson<{ confirm?: string }>(request);
    if (String(body?.confirm ?? '').trim().toUpperCase() !== 'DELETE') {
      return badRequest('Type DELETE to confirm that you want to erase your account.');
    }

    const db = await getDb();

    // Order matters only for readability - there are no foreign keys, so we
    // clear every table that mentions this user.
    const statements: Array<[string, unknown[]]> = [
      ['DELETE FROM user_achievements WHERE user_id = ?', [user.id]],
      ['DELETE FROM notifications WHERE user_id = ?', [user.id]],
      ['DELETE FROM webauthn_credentials WHERE user_id = ?', [user.id]],
      ['DELETE FROM webauthn_challenges WHERE user_id = ?', [user.id]],
      ['DELETE FROM auth_sessions WHERE user_id = ?', [user.id]],
      ['DELETE FROM workout_sessions WHERE user_id = ?', [user.id]],
      ['DELETE FROM daily_stats WHERE user_id = ?', [user.id]],
      ['DELETE FROM challenge_participants WHERE user_id = ?', [user.id]],
      ['DELETE FROM challenges WHERE creator_id = ?', [user.id]],
      ['DELETE FROM friendships WHERE requester_id = ? OR recipient_id = ?', [user.id, user.id]],
      ['DELETE FROM users WHERE id = ?', [user.id]],
    ];
    for (const [sql, params] of statements) {
      await db.run(sql, params);
    }

    await clearSessionCookie();
    return json({ ok: true, deleted: true });
  });
}
