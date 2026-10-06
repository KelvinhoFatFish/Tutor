'use client';

import Link from 'next/link';

/** The centred card used by the login, register and onboarding screens. */
export default function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="card card-raised w-full max-w-md p-6 animate-rise sm:p-7">
        <Link href="/" className="mb-6 inline-flex items-center gap-2 font-extrabold tracking-tight">
          <span aria-hidden="true">💪</span>
          <span className="text-sm">
            PUSHUP<span className="text-volt-500">LEAGUE</span>
          </span>
        </Link>
        {children}
      </div>
    </main>
  );
}
