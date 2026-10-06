/**
 * INPUT VALIDATION
 * ----------------
 * Every piece of data coming from a browser is treated as hostile until it has
 * been checked here. The API routes call these helpers before touching the DB.
 */

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'pushupleague',
  'pushup-league', 'me', 'you', 'null', 'undefined', 'api', 'settings',
]);

export function normaliseEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function validateEmail(raw: unknown): ValidationResult<string> {
  const email = normaliseEmail(raw);
  if (!email) return { ok: false, error: 'Email is required.' };
  if (email.length > 254) return { ok: false, error: 'That email address is too long.' };
  // Deliberately simple: a full RFC 5322 regex rejects valid addresses.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, error: 'That does not look like a valid email address.' };
  }
  return { ok: true, value: email };
}

export function normaliseUsername(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

export function validateUsername(raw: unknown): ValidationResult<string> {
  const username = normaliseUsername(raw);
  if (!username) return { ok: false, error: 'Username is required.' };
  if (username.length < 3) return { ok: false, error: 'Username must be at least 3 characters.' };
  if (username.length > 20) return { ok: false, error: 'Username must be 20 characters or fewer.' };
  if (!/^[a-zA-Z0-9 _.-]+$/.test(username)) {
    return {
      ok: false,
      error: 'Use only letters, numbers, spaces and _ . - in your username.',
    };
  }
  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    return { ok: false, error: 'That username is reserved. Please pick another.' };
  }
  return { ok: true, value: username };
}

export function validatePassword(raw: unknown): ValidationResult<string> {
  const password = String(raw ?? '');
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  if (password.length > 200) {
    return { ok: false, error: 'Password must be 200 characters or fewer.' };
  }
  return { ok: true, value: password };
}

/** Friend codes are 6 characters, uppercase, no ambiguous letters. */
export function normaliseFriendCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function validateFriendCode(raw: unknown): ValidationResult<string> {
  const code = normaliseFriendCode(raw);
  if (code.length !== 6) return { ok: false, error: 'Friend codes are exactly 6 characters.' };
  return { ok: true, value: code };
}

export function validateAvatar(raw: unknown): ValidationResult<string> {
  const avatar = String(raw ?? '').trim();
  if (!avatar) return { ok: true, value: '' };
  // Either a short emoji/initials string, or a small inline image.
  if (avatar.startsWith('data:image/')) {
    if (avatar.length > 400_000) {
      return { ok: false, error: 'That picture is too large. Please pick one under about 300 KB.' };
    }
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(avatar)) {
      return { ok: false, error: 'Unsupported image format.' };
    }
    return { ok: true, value: avatar };
  }
  if (avatar.length > 8) {
    return { ok: false, error: 'Avatar emoji must be a single character.' };
  }
  return { ok: true, value: avatar };
}

export function validateNumber(
  raw: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function validateIsoDate(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function validateMessage(raw: unknown, max = 500): string {
  return String(raw ?? '').trim().slice(0, max);
}
