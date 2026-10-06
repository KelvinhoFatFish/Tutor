import Link from 'next/link';

export const metadata = {
  title: 'Privacy notice — PushUp League',
  description: 'What PushUp League does with your camera, your biometrics and your data.',
};

/**
 * PRIVACY NOTICE (placeholder-before-launch wording)
 * ==================================================
 * Honest and specific. It says what is processed, where, and what is stored -
 * including the limits of biometric sign-in, because overstating that would be
 * the single most misleading thing this app could do.
 *
 * TODO before you launch publicly: replace the contact line below with your own
 * email address, and have a lawyer review this if you operate commercially.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
        ← Back
      </Link>

      <h1 className="mt-5 text-3xl font-extrabold">Privacy notice</h1>
      <p className="mt-2 text-sm text-slate-400">
        Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} ·
        Placeholder text — review before launching publicly.
      </p>

      <Section title="The short version">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Your camera is used <strong>only</strong> while you are on the workout screen, and only
            with your permission.
          </li>
          <li>
            Pose detection runs <strong>inside your browser</strong>. Your video is never uploaded,
            streamed or recorded by us.
          </li>
          <li>
            Biometric sign-in happens <strong>on your device</strong>. We store a public key, not your
            face.
          </li>
          <li>
            The only thing that reaches our server is your <strong>finished rep count</strong>.
          </li>
        </ul>
      </Section>

      <Section title="Camera and video">
        <p>
          PushUp League asks for camera access so it can see your body position and count push-ups.
          The pose model (MediaPipe Pose) runs locally in your browser. Frames are analysed in memory
          and immediately discarded. We do not record, store, upload or transmit video, and there is
          no code in the app that could do so.
        </p>
        <p className="mt-3">
          You can revoke camera access at any time in your browser or operating system settings. The
          app will simply stop being able to count reps.
        </p>
      </Section>

      <Section title="Biometric sign-in (passkeys)">
        <p>
          If you enable it, signing in uses a <strong>passkey</strong>. Your phone or laptop asks its
          own secure hardware to verify that it is you — Face ID, Windows Hello, or your fingerprint.
          That check happens entirely on your device.
        </p>
        <p className="mt-3">
          We never receive or store your face, a face image, or a face template. What we store is a
          cryptographic <strong>public key</strong>. A public key can only verify signatures; it
          cannot be used to sign in as you, even if our database were stolen.
        </p>
        <p className="mt-3 font-semibold text-flame-400">An honest limitation</p>
        <p>
          Biometric sign-in is a strong convenience layer, but no authentication method is perfect.
          It confirms that whoever is holding your unlocked device is the person enrolled on it. It
          is not a guarantee of identity, and it is not the same thing as a face-recognition system
          that compares your face against a stored image. Keep your password safe and treat your
          unlocked device as you would your house keys.
        </p>
        <p className="mt-3">
          You can delete your biometric data at any time from{' '}
          <strong>Settings → Privacy → Delete my biometric data</strong>. Your account and your
          email/password login keep working afterwards.
        </p>
      </Section>

      <Section title="What we store">
        <ul className="list-disc space-y-2 pl-5">
          <li>Your username, email address and a salted password hash (never the password itself).</li>
          <li>Your push-up sessions: start and end time, rep count, and a quality score.</li>
          <li>Your daily totals, streaks and unlocked achievements.</li>
          <li>Friend connections and challenge memberships.</li>
          <li>Public keys for any passkeys you registered.</li>
        </ul>
      </Section>

      <Section title="What other people can see">
        <p>
          Your <strong>username</strong>, <strong>avatar</strong>, push-up totals, streak, personal
          best and rank are visible to the friends you accept. People who are not your friends see
          only your username, avatar and lifetime total.
        </p>
        <p className="mt-3">
          Your <strong>email address is never shown</strong> to anyone, is not searchable, and is
          never included in a leaderboard or profile response.
        </p>
      </Section>

      <Section title="Your controls">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Delete your biometric data</strong> — Settings → Privacy. Removes every passkey.
          </li>
          <li>
            <strong>Delete your account</strong> — Settings → Danger zone. Permanently erases your
            profile, sessions, daily totals, friendships and achievements.
          </li>
          <li>
            <strong>Turn notifications off</strong> — Settings. Nothing is ever sent by email or push
            notification; these are in-app messages only.
          </li>
        </ul>
      </Section>

      <Section title="Security">
        <ul className="list-disc space-y-2 pl-5">
          <li>Passwords are hashed with scrypt and a per-user random salt.</li>
          <li>
            Sessions use an opaque random token in an <code>httpOnly</code> cookie; only a hash of the
            token is stored.
          </li>
          <li>Every API route scopes its reads and writes to the signed-in user from the session.</li>
          <li>Camera access requires HTTPS (or localhost during development).</li>
          <li>
            Workout uploads are checked server-side against humanly possible rep rates, and flagged
            sessions do not count.
          </li>
        </ul>
      </Section>

      <Section title="Contact">
        <p>
          Questions or data requests: <strong>replace-this-with-your-email@example.com</strong>.
        </p>
      </Section>

      <div className="mt-8 flex gap-3">
        <Link href="/" className="btn btn-secondary">
          Back to the app
        </Link>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card mt-5 p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-3 text-sm leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}
