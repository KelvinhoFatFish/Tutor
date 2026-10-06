import { destroyCurrentSession } from '@/lib/auth';
import { guard, json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Signs the user out by deleting the session row and clearing the cookie. */
export async function POST(): Promise<Response> {
  return guard(async () => {
    await destroyCurrentSession();
    return json({ ok: true });
  });
}
