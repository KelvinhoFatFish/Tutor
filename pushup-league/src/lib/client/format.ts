/**
 * FORMATTING HELPERS
 * Kept in one place so every screen shows numbers and dates the same way.
 */

export function formatNumber(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US');
}

/** 4238 -> "4,238"   |   12400 -> "12.4k" for tight spaces like leaderboards. */
export function formatCompact(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) < 10000) return n.toLocaleString('en-US');
  if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/**
 * The user's own calendar date, as YYYY-MM-DD.
 * Sending this to the server is what makes "today" mean *your* today.
 */
export function localDayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDayShort(dayKey: string): string {
  const date = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dayKey;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/**
 * A very rough calorie estimate. We label it clearly as an estimate in the UI
 * because it depends on body weight, tempo and depth, none of which we know.
 * ~0.5 kcal per push-up is a commonly quoted mid-range figure.
 */
export function estimateCalories(reps: number): number {
  return Math.round(reps * 0.5);
}

/** Turns a username into a stable colour, used for avatar fallbacks. */
export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  return `hsl(${hash} 78% 52%)`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
