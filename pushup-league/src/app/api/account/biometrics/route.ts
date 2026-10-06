import { requireUser } from '@/lib/auth';
import { guard, json } from '@/lib/api';
import { deleteBiometricData } from '@/lib/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Delete my biometric data" - required by the privacy section of the brief.
 *
 * Removes every passkey and any stored face template. The account itself and
 * the email + password login stay exactly as they were, so this is always a
 * safe thing to press.
 */
export async function DELETE(): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const result = await deleteBiometricData(user.id);
    return json({
      ok: true,
      removed: result.removed,
      message:
        result.removed === 0
          ? 'There was no biometric data stored for your account.'
          : `Removed ${result.removed} passkey(s). You can still sign in with your email and password.`,
    });
  });
}
