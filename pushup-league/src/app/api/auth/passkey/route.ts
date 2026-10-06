import { requireUser } from '@/lib/auth';
import { guard, json } from '@/lib/api';
import { deleteBiometricData, getCredentialsForUser } from '@/lib/webauthn';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lists the passkeys registered to this account.
 * The public key and credential id are deliberately never sent to the browser.
 */
export async function GET(): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const credentials = await getCredentialsForUser(user.id);
    return json({
      credentials: credentials.map((cred) => ({
        label: cred.label,
        deviceType: cred.device_type,
        backedUp: Boolean(cred.backed_up),
        createdAt: cred.created_at,
        lastUsedAt: cred.last_used_at,
      })),
    });
  });
}

/**
 * The "delete my biometric data" control.
 *
 * With `?all=1` every passkey is removed. With `?label=...` only one is.
 * Email + password login continues to work afterwards, so nobody can lock
 * themselves out by deleting their passkey.
 */
export async function DELETE(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const url = new URL(request.url);
    if (url.searchParams.get('all') === '1') {
      const result = await deleteBiometricData(user.id);
      return json({ ok: true, removed: result.removed });
    }

    const label = url.searchParams.get('label');
    if (!label) return json({ error: 'Specify which passkey to remove.' }, { status: 400 });

    const db = await getDb();
    const result = await db.run('DELETE FROM webauthn_credentials WHERE user_id = ? AND label = ?', [
      user.id, label,
    ]);
    return json({ ok: true, removed: result.changes });
  });
}
