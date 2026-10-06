/**
 * OFFLINE SUPPORT
 * ===============
 * The push-up counter runs entirely on the device, so a dropping connection
 * must never cost you repetitions.
 *
 * How it works:
 *   1. A workout gets its id the moment it starts.
 *   2. When the workout ends we try to upload it immediately.
 *   3. If the upload fails (no signal, server asleep) the finished session is
 *      written to localStorage and retried automatically.
 *   4. Because the server treats the session id as a primary key, retrying is
 *      always safe - the same workout can never be counted twice.
 */

export interface QueuedSession {
  id: string;
  startedAt: string;
  endedAt: string;
  reps: number;
  invalidReps: number;
  validationScore: number;
  dayKey: string;
  device: string;
  queuedAt: string;
}

const QUEUE_KEY = 'pushup-league.pending-sessions.v1';

function read(): QueuedSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedSession[]) : [];
  } catch {
    return [];
  }
}

function write(queue: QueuedSession[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(0, 50)));
  } catch {
    // Storage full or blocked (private browsing). Nothing we can do, and the
    // in-memory copy still works for this session.
  }
  notify();
}

function notify(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('pushup-league:queue-changed'));
}

export function pendingSessions(): QueuedSession[] {
  return read();
}

export function pendingCount(): number {
  return read().length;
}

export function enqueueSession(session: QueuedSession): void {
  const queue = read();
  if (queue.some((item) => item.id === session.id)) return;
  queue.push(session);
  write(queue);
}

export function removeSession(id: string): void {
  write(read().filter((item) => item.id !== id));
}

/**
 * Tries to upload everything waiting in the queue.
 * Returns how many were accepted. Safe to call as often as you like.
 */
export async function flushQueue(): Promise<{ sent: number; remaining: number }> {
  if (typeof window === 'undefined') return { sent: 0, remaining: 0 };
  if (!navigator.onLine) return { sent: 0, remaining: pendingCount() };

  const queue = read();
  let sent = 0;

  for (const session of queue) {
    try {
      const response = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      });

      // 4xx means the server will never accept this session (bad data), so we
      // drop it rather than retrying forever. 5xx and network errors are kept.
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        removeSession(session.id);
        if (response.ok) sent += 1;
      } else {
        break;
      }
    } catch {
      break; // still offline
    }
  }

  return { sent, remaining: pendingCount() };
}

/** Registers listeners that flush the queue whenever the connection returns. */
export function installOfflineSync(onFlushed?: (result: { sent: number; remaining: number }) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const run = async () => {
    const result = await flushQueue();
    if (result.sent > 0) onFlushed?.(result);
  };

  const handleOnline = () => void run();
  window.addEventListener('online', handleOnline);
  // Also try once on load, in case the app was closed while offline.
  void run();

  return () => window.removeEventListener('online', handleOnline);
}
