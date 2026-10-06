/**
 * CLIENT-SIDE API HELPERS
 * -----------------------
 * Every screen talks to the app through these two functions, so error handling
 * and "you need to sign in" behaviour is consistent everywhere.
 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function messageFrom(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const value = (payload as { error?: unknown }).error;
    if (typeof value === 'string' && value) return value;
  }
  return fallback;
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
  });
  const payload = await parse(response);
  if (!response.ok) {
    throw new ApiError(messageFrom(payload, `Request failed (${response.status})`), response.status);
  }
  return payload as T;
}

export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await parse(response);
  if (!response.ok) {
    throw new ApiError(messageFrom(payload, `Request failed (${response.status})`), response.status);
  }
  return payload as T;
}
