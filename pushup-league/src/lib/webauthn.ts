import 'server-only';
import { getDb, newId, nowIso } from './db';

/**
 * PASSKEYS / WEBAUTHN
 * ===================
 *
 * This is the app's "face login".
 *
 * When you sign in with a passkey, Face ID (iPhone), Windows Hello (PC) or
 * Android face unlock checks that it is really you. That check happens inside
 * your device's secure chip. The camera image never leaves your device, and
 * this server never receives a face image, a face template, or anything else
 * derived from your face.
 *
 * What we store is a *public key*: a random-looking string that can only verify
 * signatures, never create them. If our database leaked tomorrow, nobody could
 * sign in as you with it.
 *
 * A plain-language summary shown to users during setup lives in the UI, in
 * components/auth/BiometricConsent.tsx.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * Works out the "relying party" details from the incoming request.
 *
 * WebAuthn is tied to a domain: a passkey created on localhost is not valid on
 * pushupleague.com. Deriving these from the request means the app works on
 * localhost, on a preview URL and on your real domain without editing code.
 * Set WEBAUTHN_RP_ID / APP_ORIGIN only if you use a custom domain in front of
 * a differently-named host.
 */
export function relyingParty(request: Request): { rpID: string; origin: string } {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const hostname = host.split(':')[0];

  return {
    rpID: process.env.WEBAUTHN_RP_ID || hostname,
    origin: process.env.APP_ORIGIN || `${proto}://${host}`,
  };
}

export async function saveChallenge(
  challenge: string,
  kind: 'registration' | 'authentication',
  userId: string | null,
): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO webauthn_challenges (id, user_id, challenge, kind, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET created_at = excluded.created_at, expires_at = excluded.expires_at`,
    [challenge, userId, challenge, kind, nowIso(), new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()],
  );
  // Housekeeping: drop anything that has expired.
  await db.run('DELETE FROM webauthn_challenges WHERE expires_at < ?', [nowIso()]);
}

/**
 * Consumes a stored challenge. It is deleted on read, so a captured challenge
 * cannot be replayed a second time.
 */
export async function consumeChallenge(
  challenge: string,
  kind: 'registration' | 'authentication',
  userId: string | null,
): Promise<boolean> {
  const db = await getDb();
  const row = await db.get<{ id: string; user_id: string | null; expires_at: string }>(
    'SELECT id, user_id, expires_at FROM webauthn_challenges WHERE challenge = ? AND kind = ?',
    [challenge, kind],
  );
  if (!row) return false;
  await db.run('DELETE FROM webauthn_challenges WHERE id = ?', [row.id]);
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  if (row.user_id && userId && row.user_id !== userId) return false;
  return true;
}

// base64url <-> Uint8Array, used for the stored public key.
export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const buffer = Buffer.from(value, 'base64url');
  // Copy into a fresh ArrayBuffer-backed view (WebAuthn requires exactly that).
  const out = new Uint8Array(buffer.byteLength);
  out.set(buffer);
  return out;
}

export interface StoredCredential {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device_type: string | null;
  backed_up: number | boolean;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
}

export async function getCredentialsForUser(userId: string): Promise<StoredCredential[]> {
  const db = await getDb();
  return db.all<StoredCredential>(
    'SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
  );
}

export async function getCredentialById(credentialId: string): Promise<StoredCredential | null> {
  const db = await getDb();
  return db.get<StoredCredential>('SELECT * FROM webauthn_credentials WHERE credential_id = ?', [credentialId]);
}

export async function saveCredential(input: {
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
  deviceType?: string;
  backedUp?: boolean;
  label?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO webauthn_credentials
       (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, label, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (credential_id) DO NOTHING`,
    [
      newId(),
      input.userId,
      input.credentialId,
      toBase64Url(input.publicKey),
      input.counter,
      input.transports ? JSON.stringify(input.transports) : null,
      input.deviceType ?? null,
      input.backedUp ? 1 : 0,
      input.label ?? null,
      nowIso(),
      null,
    ],
  );
}

export async function updateCredentialCounter(credentialId: string, counter: number): Promise<void> {
  const db = await getDb();
  await db.run('UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE credential_id = ?', [
    counter, nowIso(), credentialId,
  ]);
}

export function parseTransports(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Deletes all biometric/passkey data for a user.
 * Used by the "Delete my biometric data" button in Settings. The account and
 * the email/password login keep working afterwards.
 */
export async function deleteBiometricData(userId: string): Promise<{ removed: number }> {
  const db = await getDb();
  const result = await db.run('DELETE FROM webauthn_credentials WHERE user_id = ?', [userId]);
  await db.run('DELETE FROM webauthn_challenges WHERE user_id = ?', [userId]);
  await db.run(
    'UPDATE users SET face_auth_enabled = 0, face_embedding = NULL WHERE id = ?',
    [userId],
  );
  return { removed: result.changes };
}
