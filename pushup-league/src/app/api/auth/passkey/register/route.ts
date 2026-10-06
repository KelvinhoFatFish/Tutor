import { generateRegistrationOptions } from '@simplewebauthn/server';
import { requireUser } from '@/lib/auth';
import { guard, json } from '@/lib/api';
import { getCredentialsForUser, parseTransports, relyingParty, saveChallenge } from '@/lib/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * STEP 1 of registering a passkey.
 *
 * Produces the challenge the device must sign. The device shows its biometric
 * prompt (Face ID / Windows Hello / fingerprint) entirely on its own - we never
 * see the face, only the signed result in step 2.
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const { rpID } = relyingParty(request);
    const existing = await getCredentialsForUser(user.id);

    const options = await generateRegistrationOptions({
      rpName: 'PushUp League',
      rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: user.username,
      attestationType: 'none',
      // Stops the same device being registered twice.
      excludeCredentials: existing.map((cred) => ({
        id: cred.credential_id,
        transports: parseTransports(cred.transports) as never,
      })),
      authenticatorSelection: {
        // "preferred" (not "required") so the flow still works on devices
        // without a built-in biometric reader - e.g. a laptop with a USB key.
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    await saveChallenge(options.challenge, 'registration', user.id);
    return json(options);
  });
}
