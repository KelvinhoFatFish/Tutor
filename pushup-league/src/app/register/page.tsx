'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ApiError, apiGet, apiSend } from '@/lib/client/api';
import { useSession, type SessionUser } from '@/lib/client/session';
import { useToast } from '@/components/Toast';
import BiometricConsent from '@/components/BiometricConsent';
import AuthFrame from '@/components/AuthFrame';

/**
 * CREATE ACCOUNT
 * ==============
 * If the visitor arrived through an invite link (`/invite/ABC123`) we carry the
 * code through and connect the two accounts the moment sign-up succeeds, so
 * nobody has to type a username to find their friend.
 */
export default function RegisterPage() {
  return (
    <Suspense fallback={<AuthFrame><p className="text-sm text-slate-400">Loading…</p></AuthFrame>}>
      <RegisterForm />
    </Suspense>
  );
}

interface InvitePreview {
  valid: boolean;
  inviter?: { username: string; avatar: string | null };
  alreadyFriends?: boolean;
  isSelf?: boolean;
}

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useSession();
  const { push } = useToast();

  const inviteCode = (params.get('invite') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const [invite, setInvite] = useState<InvitePreview | null>(null);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (inviteCode.length !== 6) return;
    void (async () => {
      try {
        setInvite(await apiGet<InvitePreview>(`/api/invite/${inviteCode}`));
      } catch {
        setInvite({ valid: false });
      }
    })();
  }, [inviteCode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await apiSend<{ user: SessionUser; invited: boolean }>('/api/auth/register', 'POST', {
        username,
        email,
        password,
        inviteCode: inviteCode || undefined,
        biometricConsent: consent,
      });
      await refresh();
      if (data.invited) push('You are now connected as friends! 🤝', 'success');
      push(`Welcome to PushUp League, ${data.user.username}! 💪`, 'success');
      router.replace('/onboarding');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not create your account.');
    } finally {
      setBusy(false);
    }
  };

  const passwordHint =
    password.length === 0
      ? null
      : password.length < 8
        ? `${8 - password.length} more character${8 - password.length === 1 ? '' : 's'} needed`
        : 'Looks good ✓';

  return (
    <AuthFrame>
      {invite?.valid && invite.inviter ? (
        <div className="mb-5 rounded-2xl border border-volt-500/30 bg-volt-500/10 p-4">
          <p className="font-bold text-volt-400">
            {invite.inviter.username} invited you to PushUp League 💪
          </p>
          <p className="mt-1 text-xs text-slate-300">
            Create your account and you will be friends automatically.
          </p>
        </div>
      ) : null}

      <h1 className="text-2xl font-extrabold">Create your account</h1>
      <p className="mt-1 text-sm text-slate-400">Free, and takes about twenty seconds.</p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className="input"
            required
            minLength={3}
            maxLength={20}
            autoComplete="nickname"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="e.g. AlexTheMachine"
          />
          <p className="mt-1 text-xs text-slate-500">
            This is what your friends will see on the leaderboard.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="input"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
          <p className="mt-1 text-xs text-slate-500">
            Never shown to other users. Used only to sign in.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="input"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
          />
          {passwordHint ? (
            <p
              className={`mt-1 text-xs ${
                password.length >= 8 ? 'text-volt-400' : 'text-slate-500'
              }`}
            >
              {passwordHint}
            </p>
          ) : null}
        </div>

        <BiometricConsent checked={consent} onChange={setConsent} />

        {error ? (
          <p className="rounded-xl border border-danger-500/40 bg-danger-500/10 px-3 py-2 text-sm text-danger-400">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn btn-primary w-full py-4 text-base" disabled={busy}>
          {busy ? 'Creating your account…' : 'Create Account 💪'}
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-slate-500">
        By creating an account you agree to the{' '}
        <Link href="/privacy" className="underline hover:text-slate-300">
          privacy notice
        </Link>
        .
      </p>

      <p className="mt-4 text-center text-sm text-slate-400">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-volt-400 hover:underline">
          Log in
        </Link>
      </p>
    </AuthFrame>
  );
}
