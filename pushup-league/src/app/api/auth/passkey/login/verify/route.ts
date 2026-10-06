import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { createSession, setSessionCookie, toSessionUser } from '@/lib/auth';
import { badRequest, guard, json, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import {
  consumeChallenge,
  fromBase64Url,
  getCredentialById,
  parseTransports,
  relyingParty,
  updateCredentialCounter,
} from '@/lib/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * STEP 2 of passkey sign-in: check the device's signature and open a session.
 *
 * The fingerprint/face check already happened on the device. All this endpoint
 * does is confirm the device signed OUR challenge with the private key that
 * matches the public key we stored at registration.
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const body = await readJson<{ response?: AuthenticationResponseJSON }>(request);
    if (!body?.response?.id) return badRequest('The device did not return a valid sign-in response.');

    const credentialRow = await getCredentialById(body.response.id);
    if (!credentialRow) {
      return badRequest(
        'That passkey is not registered on this site. Try signing in with your email and password instead.',
        401,
      );
    }

    const clientData = decodeClientData(body.response.response.clientDataJSON);
    if (!clientData) return badRequest('That sign-in response could not be read.');

    const challengeOk = await consumeChallenge(clientData.challenge, 'authentication', null);
    if (!challengeOk) return badRequest('That sign-in request expired. Please try again.');

    const { rpID, origin } = relyingParty(request);

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: clientData.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
        credential: {
          id: credentialRow.credential_id,
          publicKey: fromBase64Url(credentialRow.public_key),
          counter: Number(credentialRow.counter ?? 0),
          transports: parseTransports(credentialRow.transports) as never,
        },
      });
    } catch (error) {
      console.error('[passkey/login] verify failed', error);
      return badRequest('We could not verify that passkey.', 401);
    }

    if (!verification.verified) return badRequest('We could not verify that passkey.', 401);

    await updateCredentialCounter(credentialRow.credential_id, verification.authenticationInfo.newCounter);

    const db = await getDb();
    const userRow = await db.get<Parameters<typeof toSessionUser>[0]>(
      'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL',
      [credentialRow.user_id],
    );
    if (!userRow) return badRequest('That account is no longer available.', 401);

    const token = await createSession(userRow.id, request.headers.get('user-agent'));
    await setSessionCookie(token);

    return json({ user: toSessionUser(userRow) });
  });
}

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
