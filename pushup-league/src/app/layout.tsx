import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SessionProvider } from '@/lib/client/session';
import { ToastProvider } from '@/components/Toast';

export const metadata: Metadata = {
  title: 'PushUp League 💪',
  description:
    'Your friends are counting. Are you? Automatic push-up counting with your camera, daily streaks and friend leaderboards.',
  applicationName: 'PushUp League',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'PushUp League',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  // The camera is only ever used after an explicit permission prompt, and the
  // video never leaves the device, so there is nothing here to index.
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#04070c',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
