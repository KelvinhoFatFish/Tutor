'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, apiGet, apiSend } from '@/lib/client/api';
import { useSession, type SessionUser } from '@/lib/client/session';
import { useToast } from '@/components/Toast';
import AvatarPicker from '@/components/AvatarPicker';
import BiometricConsent, { usePasskeySupport } from '@/components/BiometricConsent';
import {
  loadFeedbackPrefs,
  playRepSound,
  saveFeedbackPrefs,
  unlockAudio,
  vibrate,
} from '@/lib/client/feedback';
import { pendingCount } from '@/lib/client/offline';

/**
 * SETTINGS
 * ========
 * Everything the brief asks users to be able to control:
 *   - their profile
 *   - whether reps make a sound or a buzz
 *   - notifications
 *   - their passkeys ("biometric data")
 *   - deleting their account
 */
export default function SettingsPage() {
  const { user, refresh, setUser, logout } = useSession();
  const { push } = useToast();
  const passkeySupported = usePasskeySupport();
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState('');
  const [saving, setSaving] = useState(false);

  const [feedback, setFeedback] = useState({ sound: true, haptics: true });
  const [passkeys, setPasskeys] = useState<Array<{ label: string | null; deviceType: string | null; createdAt: string; lastUsedAt: string | null }>>([]);
  const [pending, setPending] = useState(0);
  const [deleteText, setDeleteText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setUsername(user.username);
    setAvatar(user.avatar ?? '');
    setFeedback(loadFeedbackPrefs());
    setPending(pendingCount());
  }, [user]);

  const loadPasskeys = async () => {
    try {
      const payload = await apiGet<{ credentials: typeof passkeys }>('/api/auth/passkey');
      setPasskeys(payload.credentials);
    } catch {
      setPasskeys([]);
    }
  };

  useEffect(() => {
    void loadPasskeys();
  }, []);

  if (!user) return null;

  const saveProfile = async () => {
    setSaving(true);
    try {
      const payload = await apiSend<{ user: SessionUser }>('/api/account', 'PATCH', { username, avatar });
      setUser(payload.user);
      await refresh();
      push('Profile saved ✓', 'success');
    } catch (error) {
      push(error instanceof ApiError ? error.message : 'Could not save that.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleFeedback = (key: 'sound' | 'haptics') => {
    const next = { ...feedback, [key]: !feedback[key] };
    setFeedback(next);
    saveFeedbackPrefs(next);
    if (key === 'sound' && next.sound) {
      unlockAudio();
      playRepSound('count');
    }
    if (key === 'haptics' && next.haptics) vibrate(40);
  };

  const updateNotifications = async (patch: { notifyEnabled?: boolean; notifyFrequency?: string }) => {
    try {
      const payload = await apiSend<{ user: SessionUser }>('/api/account', 'PATCH', patch);
      setUser(payload.user);
      push('Notification settings saved ✓', 'success');
    } catch {
      push('Could not save that.', 'error');
    }
  };

  const addPasskey = async () => {
    setBusy('passkey-add');
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const options = await apiSend<Record<string, unknown>>('/api/auth/passkey/register', 'POST');
      const attestation = await startRegistration({ optionsJSON: options as never });
      await apiSend('/api/auth/passkey/register/verify', 'POST', {
        response: attestation,
        label: deviceLabel(),
      });
      push('New passkey added 🔐', 'success');
      await loadPasskeys();
      await refresh();
    } catch (error) {
      if (error instanceof ApiError) push(error.message, 'error');
      else push('Passkey setup was cancelled or is not supported on this device.', 'warn');
    } finally {
      setBusy(null);
    }
  };

  const deleteBiometrics = async () => {
    if (!window.confirm('Delete every passkey on this account? You will still be able to sign in with your email and password.')) return;
    setBusy('biometric-delete');
    try {
      const payload = await apiSend<{ message: string }>('/api/account/biometrics', 'DELETE');
      push(payload.message, 'success');
      await loadPasskeys();
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    if (deleteText.trim().toUpperCase() !== 'DELETE') {
      push('Type DELETE in the box to confirm.', 'warn');
      return;
    }
    setBusy('account-delete');
    try {
      await apiSend('/api/account', 'DELETE', { confirm: 'DELETE' });
      setUser(null);
      push('Your account and all of your data have been erased.', 'info');
      router.replace('/');
    } catch (error) {
      push(error instanceof ApiError ? error.message : 'Could not delete the account.', 'error');
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-rise">
      <h1 className="text-xl font-extrabold sm:text-2xl">Settings ⚙️</h1>

      {/* ---------- Profile ---------- */}
      <section className="card p-5">
        <h2 className="font-bold">Profile</h2>
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="set-username">Username</label>
            <input
              id="set-username"
              className="input"
              value={username}
              minLength={3}
              maxLength={20}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <AvatarPicker username={username} value={avatar || null} onChange={setAvatar} />
        </div>
        <button type="button" className="btn btn-primary mt-4 w-full py-3" onClick={() => void saveProfile()} disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </section>

      {/* ---------- Feedback ---------- */}
      <section className="card p-5">
        <h2 className="font-bold">During a workout</h2>
        <p className="mt-1 text-xs text-slate-400">These are saved on this device only.</p>
        <div className="mt-3 flex flex-col gap-2">
          <Toggle
            label="Sound when a rep counts"
            detail="A short blip each time a push-up is counted."
            checked={feedback.sound}
            onChange={() => toggleFeedback('sound')}
          />
          <Toggle
            label="Vibration"
            detail="A small buzz on phones that support it."
            checked={feedback.haptics}
            onChange={() => toggleFeedback('haptics')}
          />
        </div>
      </section>

      {/* ---------- Notifications ---------- */}
      <section className="card p-5">
        <h2 className="font-bold">Notifications</h2>
        <p className="mt-1 text-xs text-slate-400">
          These are in-app messages only. Nothing is sent by email, and nothing is ever pushed to
          your phone without your permission.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          <Toggle
            label="Let friends&apos; results notify me"
            detail="A short message when somebody overtakes you, or adds you to a battle."
            checked={user.notify_enabled}
            onChange={() => void updateNotifications({ notifyEnabled: !user.notify_enabled })}
          />
        </div>

        <div className="mt-4">
          <label className="label" htmlFor="freq">How often</label>
          <select
            id="freq"
            className="input"
            value={user.notify_frequency}
            onChange={(event) => void updateNotifications({ notifyFrequency: event.target.value })}
          >
            <option value="off">Off — never notify me</option>
            <option value="minimal">Minimal — only when I am overtaken</option>
            <option value="normal">Normal — overtakes, battles and milestones</option>
            <option value="chatty">Chatty — everything</option>
          </select>
          <p className="mt-1.5 text-xs text-slate-500">
            We rate-limit overtake messages to at most one per friend every six hours, so this can
            never flood you.
          </p>
        </div>
      </section>

      {/* ---------- Offline queue ---------- */}
      <section className="card p-5">
        <h2 className="font-bold">Offline workouts</h2>
        <p className="mt-1 text-xs text-slate-400">
          Finished sessions are stored on this device until they reach the server. Because each
          workout has a unique id, retrying can never double-count your reps.
        </p>
        <p className="mt-3 text-sm">
          {pending === 0
            ? '✅ Everything is uploaded.'
            : `⏳ ${pending} workout${pending === 1 ? '' : 's'} waiting to upload.`}
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn btn-secondary px-4 py-2 text-xs" onClick={() => setPending(pendingCount())}>
            Refresh count
          </button>
          <button
            type="button"
            className="btn btn-secondary px-4 py-2 text-xs"
            onClick={async () => {
              const { flushQueue } = await import('@/lib/client/offline');
              const result = await flushQueue();
              setPending(result.remaining);
              push(result.sent > 0 ? `Uploaded ${result.sent} workout(s) ✓` : 'Nothing to upload right now.', 'info');
              window.dispatchEvent(new CustomEvent('pushup-league:stats-stale'));
            }}
          >
            Sync now
          </button>
        </div>
      </section>

      {/* ---------- Privacy / biometrics ---------- */}
      <section className="card p-5">
        <h2 className="font-bold">Privacy &amp; biometric data</h2>

        <div className="mt-3 rounded-2xl border border-white/8 bg-white/4 p-3 text-xs text-slate-300">
          <p>
            Your camera feed is processed on this device and never uploaded. Biometric sign-in
            happens inside your device&apos;s secure hardware — we store a public key, never a face
            image or face template.
          </p>
          <Link href="/privacy" className="mt-2 inline-block font-semibold text-volt-400 hover:underline">
            Read the full privacy notice →
          </Link>
        </div>

        <div className="mt-4">
          <p className="label">Registered passkeys</p>
          {passkeys.length === 0 ? (
            <p className="text-sm text-slate-400">None yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {passkeys.map((passkey, index) => (
                <li key={index} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/4 px-3 py-2">
                  <span className="text-sm font-semibold">{passkey.label ?? 'Passkey'}</span>
                  <span className="text-xs text-slate-500">
                    {passkey.lastUsedAt ? `Last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}` : 'Never used'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {passkeySupported ? (
            <button type="button" className="btn btn-secondary flex-1 py-2.5 text-sm" onClick={() => void addPasskey()} disabled={busy === 'passkey-add'}>
              {busy === 'passkey-add' ? 'Waiting…' : '🔐 Add a passkey'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-danger flex-1 py-2.5 text-sm"
            onClick={() => void deleteBiometrics()}
            disabled={busy === 'biometric-delete'}
          >
            Delete my biometric data
          </button>
        </div>

        {!user.biometric_consent_at ? (
          <div className="mt-4">
            <BiometricConsent
              id="settings-consent"
              checked={false}
              onChange={async (value) => {
                if (!value) return;
                await apiSend('/api/account', 'PATCH', { biometricConsent: true });
                await refresh();
                push('Consent recorded ✓', 'success');
              }}
            />
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">
            You gave biometric consent on{' '}
            {new Date(user.biometric_consent_at).toLocaleDateString('en-US', {
              year: 'numeric', month: 'long', day: 'numeric',
            })}
            .
          </p>
        )}
      </section>

      {/* ---------- Account ---------- */}
      <section className="card p-5">
        <h2 className="font-bold">Account</h2>
        <p className="mt-1 text-sm text-slate-400">Signed in as {user.email}</p>
        <p className="mt-1 text-xs text-slate-500">
          Your friend code is <span className="font-mono font-bold text-volt-400">{user.friend_code}</span>
        </p>

        <button
          type="button"
          className="btn btn-secondary mt-4 w-full py-3"
          onClick={async () => {
            await logout();
            router.replace('/');
          }}
        >
          Log out
        </button>
      </section>

      {/* ---------- Danger zone ---------- */}
      <section className="card border-danger-500/25 p-5">
        <h2 className="font-bold text-danger-400">Danger zone</h2>
        <p className="mt-1 text-sm text-slate-400">
          Deleting your account permanently erases your profile, every workout, your daily totals,
          your friendships, your challenges and your achievements. This cannot be undone.
        </p>

        <label className="label mt-4" htmlFor="delete-confirm">
          Type DELETE to confirm
        </label>
        <input
          id="delete-confirm"
          className="input"
          value={deleteText}
          onChange={(event) => setDeleteText(event.target.value)}
          placeholder="DELETE"
          autoComplete="off"
        />

        <button
          type="button"
          className="btn btn-danger mt-3 w-full py-3"
          onClick={() => void deleteAccount()}
          disabled={busy === 'account-delete' || deleteText.trim().toUpperCase() !== 'DELETE'}
        >
          {busy === 'account-delete' ? 'Deleting…' : 'Delete my account permanently'}
        </button>
      </section>
    </div>
  );
}

function Toggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="flex w-full items-center gap-3 rounded-2xl border border-white/8 bg-white/4 px-3 py-3 text-left transition hover:bg-white/8"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-slate-400">{detail}</span>
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-volt-500' : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? 'left-[1.4rem]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
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
