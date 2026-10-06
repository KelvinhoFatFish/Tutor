'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ApiError, apiSend } from '@/lib/client/api';
import { useSession, type SessionUser } from '@/lib/client/session';
import { useToast } from '@/components/Toast';
import { usePasskeySupport } from '@/components/BiometricConsent';
import AuthFrame from '@/components/AuthFrame';

/**
 * LOG IN
 * ======
 * Two ways in, side by side:
 *   1. The passkey button — one tap, then Face ID / Windows Hello.
 *   2. Email + password, which always works, everywhere.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<AuthFrame><p className="text-sm text-slate-400">Loading…</p></AuthFrame>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useSession();
  const { push } = useToast();
  const passkeySupported = usePasskeySupport();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextPath = params.get('next');

  const finish = async (user: SessionUser | null) => {
    await refresh();
    push(`Welcome back${user ? `, ${user.username}` : ''}! 💪`, 'success');
    router.replace(nextPath || (user && !user.onboarded ? '/onboarding' : '/dashboard'));
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await apiSend<{ user: SessionUser }>('/api/auth/login', 'POST', { email, password });
      await finish(data.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not sign you in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitPasskey = async () => {
    setPasskeyBusy(true);
    setError(null);
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const options = await apiSend<Record<string, unknown>>('/api/auth/passkey/login', 'POST', {
        email: email || undefined,
      });
      const assertion = await startAuthentication({ optionsJSON: options as never });
      const data = await apiSend<{ user: SessionUser }>('/api/auth/passkey/login/verify', 'POST', {
        response: assertion,
      });
      await finish(data.user);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if ((err as { name?: string })?.name === 'NotAllowedError') {
        setError('That sign-in was cancelled or timed out. Try again, or use your password.');
      } else {
        setError('Passkey sign-in did not work on this device. Use your email and password instead.');
      }
    } finally {
      setPasskeyBusy(false);
    }
  };

  return (
    <AuthFrame>
      <h1 className="text-2xl font-extrabold">Welcome back</h1>
      <p className="mt-1 text-sm text-slate-400">Sign in to keep your streak alive.</p>

      {passkeySupported ? (
        <>
          <button
            type="button"
            onClick={() => void submitPasskey()}
            disabled={passkeyBusy || busy}
            className="btn btn-primary mt-6 w-full py-4 text-base"
          >
            {passkeyBusy ? 'Waiting for your device…' : '👤 Sign in with Face ID / Passkey'}
          </button>

          <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
            <span className="h-px flex-1 bg-white/10" />
            or use your password
            <span className="h-px flex-1 bg-white/10" />
          </div>
        </>
      ) : null}

      <form onSubmit={submitPassword} className={`flex flex-col gap-4 ${passkeySupported ? '' : 'mt-6'}`}>
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="input"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Your password"
          />
        </div>

        {error ? (
          <p className="rounded-xl border border-danger-500/40 bg-danger-500/10 px-3 py-2 text-sm text-danger-400">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn btn-secondary w-full py-3.5" disabled={busy || passkeyBusy}>
          {busy ? 'Signing in…' : 'Log In'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-400">
        New here?{' '}
        <Link href="/register" className="font-semibold text-volt-400 hover:underline">
          Create an account
        </Link>
      </p>

      <p className="mt-3 text-center text-xs text-slate-500">
        Forgotten your password? There is no reset email in this build — an administrator can reset it
        for you in the database. Passkey users can still sign in with their face or fingerprint.
      </p>
    </AuthFrame>
  );
}
