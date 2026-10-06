'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/lib/client/session';

/**
 * THE FIRST SCREEN
 * ================
 * Deliberately almost empty. One logo, one line of attitude, two buttons.
 * Anyone who is already signed in is sent straight to their dashboard.
 */
export default function LandingPage() {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace(user.onboarded ? '/dashboard' : '/onboarding');
    }
  }, [user, loading, router]);

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-6 py-10 text-center">
      <div className="w-full max-w-md animate-rise">
        <div className="mb-6 text-6xl" aria-hidden="true">
          💪
        </div>

        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          PUSHUP
          <span className="bg-gradient-to-r from-volt-500 to-sky-500 bg-clip-text text-transparent">
            LEAGUE
          </span>
        </h1>

        <p className="mt-3 text-lg font-semibold text-slate-300">
          Your friends are counting. Are you?
        </p>

        <p className="mx-auto mt-3 max-w-sm text-sm text-slate-400">
          Point your camera at yourself and it counts your push-ups automatically. Every rep
          feeds your daily total, your streak and your place on the friend leaderboard.
        </p>

        <div className="mt-9 flex flex-col gap-3">
          <Link href="/register" className="btn btn-primary w-full py-4 text-base">
            Create Account
          </Link>
          <Link href="/login" className="btn btn-secondary w-full py-4 text-base">
            Log In
          </Link>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-3 text-left">
          <Feature icon="🎥" title="Camera counts" detail="MediaPipe pose detection, on your device." />
          <Feature icon="🔥" title="Daily streaks" detail="Beat your own best, then beat your friends." />
          <Feature icon="🏆" title="Friend ranks" detail="Today, this week, this month, all time." />
        </div>

        <p className="mt-9 text-xs text-slate-500">
          Your camera feed is processed on your device and is never uploaded.{' '}
          <Link href="/privacy" className="underline hover:text-slate-300">
            Privacy
          </Link>
        </p>

        {loading ? <p className="mt-4 text-xs text-slate-600">Checking your session…</p> : null}
      </div>
    </main>
  );
}

function Feature({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <div className="card p-3">
      <div className="text-xl" aria-hidden="true">
        {icon}
      </div>
      <p className="mt-1 text-xs font-bold">{title}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{detail}</p>
    </div>
  );
}
