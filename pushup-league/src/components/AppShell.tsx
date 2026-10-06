'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/lib/client/session';
import OfflineBanner from './OfflineBanner';
import Avatar from './Avatar';

/**
 * The frame around every signed-in screen: the top bar, the navigation and the
 * "you must be signed in" guard.
 *
 * Navigation is a bottom tab bar on phones (thumb reach) and a horizontal bar
 * in the header on tablets and desktops. The big green PUSH-UPS button sits in
 * the middle of the tab bar because it is the one thing you do every day.
 */

const NAV = [
  { href: '/dashboard', label: 'Home', icon: '🏠' },
  { href: '/leaderboard', label: 'Ranks', icon: '🏆' },
  { href: '/friends', label: 'Friends', icon: '👥' },
  { href: '/challenges', label: 'Battles', icon: '🔥' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Remember where they were headed so we can send them back after login.
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!user.onboarded && pathname !== '/onboarding') {
      router.replace('/onboarding');
    }
  }, [user, loading, pathname, router]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-volt-500" />
          <p className="text-sm text-slate-400">Loading PushUp League…</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-dvh">
      <OfflineBanner />

      <header className="sticky top-0 z-40 border-b border-white/6 bg-ink-950/80 backdrop-blur-xl safe-top">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2 font-extrabold tracking-tight">
            <span aria-hidden="true">💪</span>
            <span className="text-sm sm:text-base">
              PUSHUP<span className="text-volt-500">LEAGUE</span>
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                    active ? 'bg-volt-500/15 text-volt-400' : 'text-slate-400 hover:bg-white/6 hover:text-slate-100'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <Link href="/profile" className="ml-auto md:ml-2" aria-label="Your profile">
            <Avatar username={user.username} avatar={user.avatar} size={34} />
          </Link>
        </div>
      </header>

      {/* pb-28 leaves room for the fixed tab bar on phones. */}
      <main className="mx-auto w-full max-w-3xl px-4 pt-4 pb-28 md:pb-10">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-ink-950/92 backdrop-blur-xl md:hidden"
        aria-label="Main"
      >
        <div className="mx-auto flex w-full max-w-3xl items-end justify-around px-2 pt-1.5 safe-bottom">
          {NAV.slice(0, 2).map((item) => (
            <NavTab key={item.href} {...item} active={pathname === item.href} />
          ))}

          <Link
            href="/workout"
            className="-mt-6 flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full bg-gradient-to-br from-volt-500 to-volt-600 text-ink-950 shadow-[0_14px_34px_-10px_rgba(43,255,136,0.85)] active:scale-95 transition"
            aria-label="Start a push-up session"
          >
            <span className="text-2xl leading-none" aria-hidden="true">
              💪
            </span>
            <span className="mt-0.5 text-[9px] font-extrabold tracking-wide">PUSH-UPS</span>
          </Link>

          {NAV.slice(2).map((item) => (
            <NavTab key={item.href} {...item} active={pathname === item.href} />
          ))}
        </div>
      </nav>
    </div>
  );
}

function NavTab({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex min-w-14 flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-bold transition ${
        active ? 'text-volt-400' : 'text-slate-500'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="text-lg leading-none" aria-hidden="true">
        {icon}
      </span>
      {label}
    </Link>
  );
}
