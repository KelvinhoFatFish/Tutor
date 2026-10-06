'use client';

import { useEffect, useState } from 'react';

/**
 * PLAIN-LANGUAGE BIOMETRIC CONSENT
 * ================================
 * Shown before anyone sets up a passkey, and required during registration.
 *
 * We deliberately do not call this "face recognition". What actually happens is
 * that the device's own secure hardware verifies its owner and then signs a
 * challenge. This app never receives, stores or compares a face image or a face
 * template. Saying so precisely matters, because "biometric login" and "face
 * recognition" are not the same thing and the difference is the whole privacy
 * story.
 */
export default function BiometricConsent({
  checked,
  onChange,
  id = 'biometric-consent',
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  id?: string;
}) {
  return (
    <div className="card p-4 text-sm">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-volt-500"
        />
        <label htmlFor={id} className="cursor-pointer select-none">
          <span className="font-bold">Enable biometric sign-in (face / fingerprint)</span>
          <span className="mt-1.5 block text-slate-300">
            If you turn this on, this device can check that it is really you when you sign in — using
            Face ID, Windows Hello or your fingerprint.
          </span>
        </label>
      </div>

      <ul className="mt-3 space-y-1.5 pl-8 text-xs text-slate-400">
        <li>
          <strong className="text-slate-300">Your face never leaves your device.</strong> The check
          happens inside your phone or laptop, not on our server.
        </li>
        <li>
          <strong className="text-slate-300">We store a public key, nothing else.</strong> No photo,
          no face scan, no face template. That key can only confirm signatures — it cannot be used
          to sign in as you if it leaked.
        </li>
        <li>
          <strong className="text-slate-300">You can remove it any time</strong> in Settings →
          Privacy. Your email and password will keep working.
        </li>
        <li>
          <strong className="text-slate-300">It is not perfect.</strong> Biometric sign-in is a
          strong convenience layer, not a guarantee. Keep your password safe.
        </li>
      </ul>
    </div>
  );
}

/** Small helper so pages can tell whether this device supports passkeys at all. */
export function usePasskeySupport(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { browserSupportsWebAuthn } = await import('@simplewebauthn/browser');
        if (!cancelled) setSupported(browserSupportsWebAuthn());
      } catch {
        if (!cancelled) setSupported(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return supported;
}
