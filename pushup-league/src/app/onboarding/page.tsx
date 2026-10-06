'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, apiSend } from '@/lib/client/api';
import { useSession, type SessionUser } from '@/lib/client/session';
import { useToast } from '@/components/Toast';
import AvatarPicker from '@/components/AvatarPicker';
import AuthFrame from '@/components/AuthFrame';
import BiometricConsent, { usePasskeySupport } from '@/components/BiometricConsent';
import ShareCard from '@/components/ShareCard';

/**
 * ONBOARDING
 * ==========
 * Five short steps:
 *   1. Welcome
 *   2. Username + picture
 *   3. Face / fingerprint sign-in (skippable)
 *   4. Add friends (skippable)
 *   5. Start the first push-up session
 *
 * Only step 2 is required. Everything else can be done later, because a
 * sign-up flow that demands five things before you see the app is how you lose
 * people at the door.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading, refresh, setUser } = useSession();
  const { push } = useToast();
  const passkeySupported = usePasskeySupport();

  const [step, setStep] = useState(0);
  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    setUsername((current) => current || user.username);
    setAvatar((current) => current || user.avatar || '');
    setConsent((current) => current || Boolean(user.biometric_consent_at));
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-slate-400">Loading…</div>
    );
  }

  const save = async (patch: Record<string, unknown>, quiet = false) => {
    const data = await apiSend<{ user: SessionUser }>('/api/account', 'PATCH', patch);
    setUser(data.user);
    await refresh();
    if (!quiet) push('Saved ✓', 'success');
    return data.user;
  };

  const finish = async () => {
    setBusy(true);
    try {
      await save({ onboarded: true }, true);
      router.replace('/workout?first=1');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  const steps = [
    // 0 - welcome
    <div key="welcome" className="text-center">
      <div className="text-6xl animate-flame" aria-hidden="true">
        💪
      </div>
      <h1 className="mt-4 text-3xl font-extrabold">Welcome to PushUp League 💪</h1>
      <p className="mt-3 text-slate-300">
        Every rep counts. Beat your friends one push-up at a time.
      </p>
      <ul className="mx-auto mt-6 max-w-xs space-y-2 text-left text-sm text-slate-400">
        <li className="flex gap-2">
          <span aria-hidden="true">🎥</span> Your camera counts your push-ups automatically.
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true">🔒</span> The video never leaves your device. Ever.
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true">🏆</span> Your reps land on your friends&apos; leaderboard instantly.
        </li>
      </ul>
      <button type="button" className="btn btn-primary mt-8 w-full py-4 text-base" onClick={() => setStep(1)}>
        Start My First Challenge
      </button>
    </div>,

    // 1 - username + picture
    <div key="profile">
      <h2 className="text-2xl font-extrabold">Make it yours</h2>
      <p className="mt-1 text-sm text-slate-400">This is what your friends will see.</p>

      <div className="mt-5 flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="ob-username">
            Username
          </label>
          <input
            id="ob-username"
            className="input"
            value={username}
            maxLength={20}
            minLength={3}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>

        <AvatarPicker username={username} value={avatar || null} onChange={setAvatar} />
      </div>

      {error ? <p className="mt-3 text-sm text-danger-400">{error}</p> : null}

      <div className="mt-6 flex gap-3">
        <button type="button" className="btn btn-ghost" onClick={() => setStep(0)}>
          Back
        </button>
        <button
          type="button"
          className="btn btn-primary flex-1 py-3.5"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await save({ username, avatar }, true);
              setStep(2);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Could not save that.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </div>,

    // 2 - face / fingerprint sign-in
    <div key="biometric">
      <h2 className="text-2xl font-extrabold">Sign in with your face</h2>
      <p className="mt-1 text-sm text-slate-400">
        Optional, but it makes logging in on this device a single tap.
      </p>

      {passkeySupported ? (
        <>
          <div className="mt-5">
            <BiometricConsent checked={consent} onChange={setConsent} />
          </div>

          {error ? <p className="mt-3 text-sm text-danger-400">{error}</p> : null}

          <button
            type="button"
            className="btn btn-primary mt-4 w-full py-4 text-base"
            disabled={busy || !consent}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const { startRegistration } = await import('@simplewebauthn/browser');
                const options = await apiSend<Record<string, unknown>>(
                  '/api/auth/passkey/register',
                  'POST',
                );
                const attestation = await startRegistration({ optionsJSON: options as never });
                await apiSend('/api/auth/passkey/register/verify', 'POST', {
                  response: attestation,
                  label: deviceLabel(),
                });
                await save({ biometricConsent: true }, true);
                push('Face sign-in is set up! 🔐', 'success');
                setStep(3);
              } catch (err) {
                if (err instanceof ApiError) setError(err.message);
                else if ((err as { name?: string })?.name === 'NotAllowedError') {
                  setError('Setup was cancelled. You can try again, or skip this step.');
                } else {
                  setError('This device could not set up a passkey. You can skip this step.');
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Waiting for your device…' : '👤 Set up face sign-in'}
          </button>
        </>
      ) : (
        <p className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
          This browser or device does not support passkeys, so there is nothing to set up here. Your
          email and password work perfectly well — you can add a passkey later on a phone or laptop
          that supports it.
        </p>
      )}

      <div className="mt-5 flex gap-3">
        <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
          Back
        </button>
        <button type="button" className="btn btn-secondary flex-1 py-3.5" onClick={() => setStep(3)}>
          Skip for now
        </button>
      </div>
    </div>,

    // 3 - add friends
    <div key="friends">
      <h2 className="text-2xl font-extrabold">Add some friends</h2>
      <p className="mt-1 text-sm text-slate-400">
        A leaderboard with one person on it is just a mirror. Send your link.
      </p>

      <div className="mt-5">
        <ShareCard username={user.username} friendCode={user.friend_code} />
      </div>

      <div className="mt-5 flex gap-3">
        <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>
          Back
        </button>
        <button type="button" className="btn btn-secondary flex-1 py-3.5" onClick={() => setStep(4)}>
          Next
        </button>
      </div>
    </div>,

    // 4 - first workout
    <div key="go" className="text-center">
      <div className="text-5xl" aria-hidden="true">
        🎥
      </div>
      <h2 className="mt-4 text-2xl font-extrabold">Let&apos;s get you counted</h2>
      <p className="mt-2 text-sm text-slate-400">
        Next you will place your phone so your whole body is in shot, then do your first push-ups.
        The app counts them for you.
      </p>

      <div className="card mt-5 p-4 text-left text-sm">
        <p className="font-bold">Quick tips</p>
        <ul className="mt-2 space-y-1.5 text-slate-300">
          <li>📱 Prop your phone on the floor, level with your shoulders.</li>
          <li>↔️ Film yourself from the side if you can — it reads the angles best.</li>
          <li>💡 Face a window or turn a light on; the camera needs to see your joints.</li>
          <li>🧍 Keep your whole body in the picture, head to feet.</li>
        </ul>
      </div>

      {error ? <p className="mt-3 text-sm text-danger-400">{error}</p> : null}

      <button
        type="button"
        className="btn btn-primary mt-5 w-full py-4 text-base"
        disabled={busy}
        onClick={() => void finish()}
      >
        {busy ? 'Starting…' : 'DO PUSH-UPS 💪'}
      </button>

      <Link href="/dashboard" className="btn btn-ghost mt-2 w-full text-sm">
        I&apos;ll do it later
      </Link>
    </div>,
  ];

  return (
    <AuthFrame>
      {/* Progress dots */}
      <div className="mb-6 flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {steps.map((_, index) => (
          <span
            key={index}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              index <= step ? 'bg-volt-500' : 'bg-white/12'
            }`}
          />
        ))}
      </div>

      {steps[step]}
    </AuthFrame>
  );
}

function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'This device';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone / iPad';
  if (/Android/.test(ua)) return 'Android device';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'This device';
}
