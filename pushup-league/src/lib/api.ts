import 'server-only';

/**
 * Small helpers shared by every API route so each one stays short and readable.
 */

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

/** 400 with a message the UI can show directly to the user. */
export function badRequest(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export function serverError(message = 'Something went wrong on our side. Please try again.'): Response {
  return Response.json({ error: message }, { status: 500 });
}

/** Reads and parses a JSON body. Returns null instead of throwing on garbage. */
export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    const body = await request.json();
    if (body === null || typeof body !== 'object') return null;
    return body as T;
  } catch {
    return null;
  }
}

/** Wraps a handler so an unexpected crash becomes a clean 500, not a stack trace. */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    console.error('[api]', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (process.env.NODE_ENV !== 'production') {
      return Response.json({ error: `Server error: ${message}` }, { status: 500 });
    }
    return serverError();
  }
}
