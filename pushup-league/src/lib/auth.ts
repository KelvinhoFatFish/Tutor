import 'server-only';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { getDb, newId, nowIso, bool } from './db';

/**
 * AUTHENTICATION
 * --------------
 * Two independent ways to sign in:
 *
 *   1. Email + password. The password is never stored. We store a slow,
 *      salted hash (scrypt) so that even if the database leaked, the original
 *      passwords could not be read back out.
 *
 *   2. Passkeys (WebAuthn). This is the "face login" path. When your phone or
 *      laptop supports it, Face ID / Windows Hello / Android face unlock
 *      verifies *you* on *your device*. The face itself never leaves the
 *      device and no face image is ever sent to or stored on our server. The
 *      server only stores a public key, which is useless on its own.
 *
 * Sessions are opaque random tokens. Only a hash of the token is stored in the
 * database, so a database leak cannot be turned into a logged-in session.
 */

export const SESSION_COOKIE = 'pul_session';
const SESSION_DAYS = 30;

// ---------------------------------------------------------------------------
// Passwords (scrypt, from Node's built-in crypto - no extra dependency)
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS, (err, key) => {
      if (err) reject(err);
      else resolve(key as Buffer);
    });
  });
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, expected.length, SCRYPT_PARAMS, (err, key) => {
      if (err) reject(err);
      else resolve(key as Buffer);
    });
  });
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
  friend_code: string;
  face_auth_enabled: boolean;
  biometric_consent_at: string | null;
  created_at: string;
  current_streak: number;
  longest_streak: number;
  lifetime_pushups: number;
  personal_best: number;
  avg_daily_pushups: number;
  active_days: number;
  last_workout_date: string | null;
  onboarded: boolean;
  notify_enabled: boolean;
  notify_frequency: string;
}

interface UserRow {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
  friend_code: string;
  face_auth_enabled: number | boolean;
  biometric_consent_at: string | null;
  created_at: string;
  current_streak: number;
  longest_streak: number;
  lifetime_pushups: number;
  personal_best: number;
  avg_daily_pushups: number;
  active_days: number;
  last_workout_date: string | null;
  onboarded: number | boolean;
  notify_enabled: number | boolean;
  notify_frequency: string;
}

export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    avatar: row.avatar,
    friend_code: row.friend_code,
    face_auth_enabled: bool(row.face_auth_enabled),
    biometric_consent_at: row.biometric_consent_at,
    created_at: row.created_at,
    current_streak: Number(row.current_streak ?? 0),
    longest_streak: Number(row.longest_streak ?? 0),
    lifetime_pushups: Number(row.lifetime_pushups ?? 0),
    personal_best: Number(row.personal_best ?? 0),
    avg_daily_pushups: Number(row.avg_daily_pushups ?? 0),
    active_days: Number(row.active_days ?? 0),
    last_workout_date: row.last_workout_date,
    onboarded: bool(row.onboarded),
    notify_enabled: bool(row.notify_enabled),
    notify_frequency: row.notify_frequency ?? 'normal',
  };
}

export async function createSession(userId: string, userAgent?: string | null): Promise<string> {
  const db = await getDb();
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.run(
    `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [newId(), userId, hashToken(token), nowIso(), expires.toISOString(), userAgent?.slice(0, 200) ?? null],
  );
  // Opportunistic cleanup of expired rows.
  await db.run('DELETE FROM auth_sessions WHERE expires_at < ?', [nowIso()]);
  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true, // JavaScript in the browser cannot read it (helps stop XSS theft)
    sameSite: 'lax', // blocks most cross-site request forgery
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.run('DELETE FROM auth_sessions WHERE token_hash = ?', [hashToken(token)]);
  }
  await clearSessionCookie();
}

/** Returns the signed-in user, or null. Never throws for "not signed in". */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const session = await db.get<{ user_id: string; expires_at: string }>(
    'SELECT user_id, expires_at FROM auth_sessions WHERE token_hash = ?',
    [hashToken(token)],
  );
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await db.run('DELETE FROM auth_sessions WHERE token_hash = ?', [hashToken(token)]);
    return null;
  }

  const row = await db.get<UserRow>('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [
    session.user_id,
  ]);
  if (!row) return null;
  return toSessionUser(row);
}

/** For API routes: returns the user or a ready-to-send 401 response. */
export async function requireUser(): Promise<
  { user: SessionUser; response: null } | { user: null; response: Response }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      user: null,
      response: Response.json({ error: 'You need to be signed in to do that.' }, { status: 401 }),
    };
  }
  return { user, response: null };
}
