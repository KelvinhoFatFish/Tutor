import { guard, json } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { areFriends, findUserByFriendCode } from '@/lib/social';
import { normaliseFriendCode } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ code: string }> };

/**
 * Public preview of an invite link: /invite/ABC123
 *
 * Returns only the inviter's display name and avatar, which is exactly what the
 * invite screen needs to say "Alex invited you to PushUp League 💪". The code is
 * a shareable secret, not a credential - it cannot be used to sign in as anyone.
 */
export async function GET(_request: Request, context: Context): Promise<Response> {
  return guard(async () => {
    const { code } = await context.params;
    const normalised = normaliseFriendCode(code);

    if (normalised.length !== 6) {
      return json({ valid: false, error: 'That invite link does not look right.' }, { status: 404 });
    }

    const inviter = await findUserByFriendCode(normalised);
    if (!inviter) {
      return json({ valid: false, error: 'That invite link is no longer valid.' }, { status: 404 });
    }

    // If you are already signed in we can tell the UI whether you are already
    // friends, so the button can say "You're already friends" instead.
    const viewer = await getCurrentUser();
    const alreadyFriends = viewer ? await areFriends(viewer.id, inviter.id) : false;

    return json({
      valid: true,
      code: normalised,
      inviter: { username: inviter.username, avatar: inviter.avatar },
      alreadyFriends,
      isSelf: viewer?.id === inviter.id,
    });
  });
}
