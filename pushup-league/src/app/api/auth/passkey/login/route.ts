import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { guard, json, readJson } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getCredentialsForUser, parseTransports, relyingParty, saveChallenge } from '@/lib/webauthn';
import { normaliseEmail } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * STEP 1 of signing in with a passkey.
 *
 * If the user typed their email first we can narrow the request to their
 * registered devices. If they did not, we ask for a "discoverable" passkey -
 * the device itself offers the right account, which is what makes the
 * one-tap "Sign in with Face ID" button possible.
 *
 * Note there is no way to enumerate accounts here: passing an email that is not
 * registered simply produces an empty credential list.
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const body = await readJson<{ email?: string }>(request);
    const { rpID } = relyingParty(request);

    let allowCredentials: Array<{ id: string; transports?: never }> = [];

    const email = normaliseEmail(body?.email);
    if (email) {
      const db = await getDb();
      const user = await db.get<{ id: string }>(
        'SELECT id FROM users WHERE email_lower = ? AND deleted_at IS NULL',
        [email],
      );
      if (user) {
        const credentials = await getCredentialsForUser(user.id);
        allowCredentials = credentials.map((cred) => ({
          id: cred.credential_id,
          transports: parseTransports(cred.transports) as never,
        }));
      }
      // An unknown email intentionally falls through with an empty list, so an
      // attacker cannot use this endpoint to discover valid addresses.
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'preferred',
    });

    await saveChallenge(options.challenge, 'authentication', null);
    return json(options);
  });
}
