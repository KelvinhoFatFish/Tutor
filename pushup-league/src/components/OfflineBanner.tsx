'use client';

import { useEffect, useState } from 'react';
import { pendingCount } from '@/lib/client/offline';

/**
 * A thin banner that appears only when there is something to say about the
 * connection: you are offline, or finished workouts are waiting to upload.
 *
 * Keeping the user informed here is what makes offline counting trustworthy -
 * they can see that their reps are safe on the device.
 */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    setPending(pendingCount());

    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    const onQueue = () => setPending(pendingCount());

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pushup-league:queue-changed', onQueue);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pushup-league:queue-changed', onQueue);
    };
  }, []);

  useEffect(() => {
    setSyncing(offline === false && pending > 0);
  }, [offline, pending]);

  if (!offline && pending === 0) return null;

  return (
    <div
      className={`flex items-center justify-center gap-2 px-3 py-2 text-center text-xs font-semibold ${
        offline ? 'bg-flame-500/15 text-flame-400' : 'bg-sky-500/15 text-sky-400'
      }`}
      role="status"
    >
      {offline ? (
        <>
          <span aria-hidden="true">📴</span>
          You&apos;re offline. Push-ups are being counted and saved on this device.
          {pending > 0 ? ` ${pending} workout${pending === 1 ? '' : 's'} waiting to upload.` : ''}
        </>
      ) : (
        <>
          <span aria-hidden="true">{syncing ? '🔄' : '☁️'}</span>
          {syncing
            ? `Uploading ${pending} saved workout${pending === 1 ? '' : 's'}...`
            : `${pending} workout${pending === 1 ? '' : 's'} waiting to upload.`}
        </>
      )}
    </div>
  );
}
