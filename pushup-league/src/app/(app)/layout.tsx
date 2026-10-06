import AppShell from '@/components/AppShell';

/**
 * Every signed-in screen lives under this route group, so the header, the tab
 * bar and the sign-in guard are defined exactly once.
 *
 * The workout screen deliberately sits OUTSIDE this group: it needs the whole
 * screen for the camera and no navigation in the way.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
