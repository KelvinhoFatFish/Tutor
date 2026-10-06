'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet, apiSend } from '@/lib/client/api';
import { useSession } from '@/lib/client/session';
import { useToast } from '@/components/Toast';
import AuthFrame from '@/components/AuthFrame';
import Avatar from '@/components/Avatar';

interface InvitePreview {
  valid: boolean;
  code?: string;
  inviter?: { username: string; avatar: string | null };
  alreadyFriends?: boolean;
  isSelf?: boolean;
  error?: string;
}

/**
 * INVITE LANDING PAGE — /invite/ABC123
 * ====================================
 * "Alex invited you to PushUp League 💪" plus one button.
 *
 * If the visitor is already signed in we connect them immediately. If they are
 * new, the code travels with them into the registration form so the friendship
 * is created the moment their account exists.
 */
export default function InvitePage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const { user, loading, refresh } = useSession();
  const { push } = useToast();

  const code = String(params?.code ?? '').toUpperCase();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setPreview(await apiGet<InvitePreview>(`/api/invite/${code}`));
      } catch {
        setPreview({ valid: false, error: 'That invite link is no longer valid.' });
      }
    })();
  }, [code]);

  const joinAsExistingUser = async () => {
    if (!preview?.code) return;
    setBusy(true);
    try {
      const result = await apiSend<{ status: string }>('/api/friends', 'POST', {
        friendCode: preview.code,
      });
      await refresh();
      push(
        result.status === 'accepted'
          ? `You and ${preview.inviter?.username} are now friends! 🤝`
          : result.status === 'already_friends'
            ? `You and ${preview.inviter?.username} are already friends.`
            : `Friend request sent to ${preview.inviter?.username}.`,
        'success',
      );
      router.replace('/dashboard');
    } catch {
      push('We could not connect you. Try adding them from the Friends page.', 'error');
      router.replace('/friends');
    } finally {
      setBusy(false);
    }
  };

  if (!preview) {
    return (
      <AuthFrame>
        <p className="text-sm text-slate-400">Checking that invite…</p>
      </AuthFrame>
    );
  }

  if (!preview.valid || !preview.inviter) {
    return (
      <AuthFrame>
        <h1 className="text-2xl font-extrabold">Invite not found</h1>
        <p className="mt-2 text-sm text-slate-400">
          {preview.error ?? 'That invite link is no longer valid.'}
        </p>
        <Link href="/register" className="btn btn-primary mt-6 w-full py-3.5">
          Create an account anyway
        </Link>
        <Link href="/" className="btn btn-ghost mt-2 w-full">
          Back to the start
        </Link>
      </AuthFrame>
    );
  }

  const inviter = preview.inviter;

  return (
    <AuthFrame>
      <div className="text-center">
        <div className="flex justify-center">
          <Avatar username={inviter.username} avatar={inviter.avatar} size={84} ring />
        </div>

        <h1 className="mt-5 text-2xl font-extrabold">
          {inviter.username} invited you to PushUp League 💪
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          You will be added as friends automatically. Then the competition starts.
        </p>
      </div>

      {preview.isSelf ? (
        <>
          <p className="mt-6 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-400">
            This is your own invite link. Send it to a friend instead!
          </p>
          <Link href="/dashboard" className="btn btn-secondary mt-4 w-full py-3.5">
            Back to dashboard
          </Link>
        </>
      ) : loading ? (
        <p className="mt-6 text-center text-sm text-slate-400">Checking your session…</p>
      ) : user ? (
        <>
          {preview.alreadyFriends ? (
            <p className="mt-6 rounded-xl border border-volt-500/30 bg-volt-500/10 px-3 py-2 text-center text-sm text-volt-400">
              You and {inviter.username} are already friends ✓
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-primary mt-6 w-full py-4 text-base"
            disabled={busy || preview.alreadyFriends}
            onClick={() => void joinAsExistingUser()}
          >
            {busy ? 'Connecting…' : preview.alreadyFriends ? 'Already friends' : 'Join the Competition'}
          </button>
          <Link href="/dashboard" className="btn btn-ghost mt-2 w-full text-sm">
            Go to my dashboard
          </Link>
        </>
      ) : (
        <>
          <Link
            href={`/register?invite=${preview.code}`}
            className="btn btn-primary mt-6 w-full py-4 text-base"
          >
            Join the Competition
          </Link>
          <Link href={`/login?next=${encodeURIComponent(`/invite/${preview.code}`)}`} className="btn btn-ghost mt-2 w-full text-sm">
            I already have an account
          </Link>
        </>
      )}

      <p className="mt-6 text-center text-[11px] text-slate-500">
        Invite code {preview.code}. Shareable, not secret — it cannot be used to sign in as anyone.
      </p>
    </AuthFrame>
  );
}
