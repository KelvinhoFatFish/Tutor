import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { requireUser } from '@/lib/auth';
import { badRequest, guard, json, readJson } from '@/lib/api';
import { consumeChallenge, relyingParty, saveCredential } from '@/lib/webauthn';
import { getDb } from '@/lib/db';
import { validateMessage } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * STEP 2 of registering a passkey.
 *
 * Verifies the signed challenge and stores the resulting PUBLIC key. No
 * biometric data of any kind is stored - only a public key, which cannot be
 * used to impersonate anyone.
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response: unauthorized } = await requireUser();
    if (!user) return unauthorized;

    const body = await readJson<{ response?: RegistrationResponseJSON; label?: string }>(request);
    if (!body?.response) return badRequest('The device did not return a valid passkey response.');

    const { rpID, origin } = relyingParty(request);
    const clientData = decodeClientData(body.response.response.clientDataJSON);
    if (!clientData) return badRequest('That passkey response could not be read.');

    const challengeOk = await consumeChallenge(clientData.challenge, 'registration', user.id);
    if (!challengeOk) {
      return badRequest('That passkey request expired. Please try again.');
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: clientData.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch (error) {
      console.error('[passkey/register] verify failed', error);
      return badRequest(
        'We could not verify that passkey. If you are testing locally, make sure you opened the app at http://localhost:3000.',
      );
    }

    if (!verification.verified || !verification.registrationInfo) {
      return badRequest('That passkey could not be verified.');
    }

    const info = verification.registrationInfo;
    await saveCredential({
      userId: user.id,
      credentialId: info.credential.id,
      publicKey: info.credential.publicKey,
      counter: info.credential.counter,
      transports: info.credential.transports as string[] | undefined,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      label: validateMessage(body.label, 60) || null,
    });

    const db = await getDb();
    await db.run('UPDATE users SET face_auth_enabled = 1, biometric_consent_at = COALESCE(biometric_consent_at, ?) WHERE id = ?', [
      new Date().toISOString(), user.id,
    ]);

    return json({ ok: true, deviceType: info.credentialDeviceType });
  });
}

/** Reads the base64url `clientDataJSON` the browser sent, to recover the challenge. */
function decodeClientData(clientDataJSON: string): { challenge: string } | null {
  try {
    const decoded = Buffer.from(clientDataJSON, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (typeof parsed?.challenge !== 'string') return null;
    return { challenge: parsed.challenge };
  } catch {
    return null;
  }
}
