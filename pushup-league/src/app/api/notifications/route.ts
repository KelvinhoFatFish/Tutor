import { requireUser } from '@/lib/auth';
import { guard, json } from '@/lib/api';
import { listNotifications, markNotificationsRead, unreadNotificationCount } from '@/lib/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Your notification feed. Only ever your own - scoped by session. */
export async function GET(): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;

    const [notifications, unread] = await Promise.all([
      listNotifications(user.id),
      unreadNotificationCount(user.id),
    ]);

    return json({
      notifications,
      unread,
      // The user's own preference decides whether the UI shows notification UI
      // at all. Nothing is ever sent by email or push.
      enabled: user.notify_enabled,
      frequency: user.notify_frequency,
    });
  });
}

/** Marks everything as read. */
export async function POST(): Promise<Response> {
  return guard(async () => {
    const { user, response } = await requireUser();
    if (!user) return response;
    await markNotificationsRead(user.id);
    return json({ ok: true });
  });
}
