/**
 * REP FEEDBACK: SOUND AND HAPTICS
 * ===============================
 * A short, pleasant blip plus a vibration when a push-up is counted. Both are
 * optional and can be switched off in Settings.
 *
 * The sound is generated with the Web Audio API rather than shipping an audio
 * file: no download, no network request, and it cannot be blocked by an
 * autoplay policy once the user has interacted with the page.
 */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  if (audioContext.state === 'suspended') void audioContext.resume();
  return audioContext;
}

export function unlockAudio(): void {
  getAudioContext();
}

export interface FeedbackOptions {
  sound: boolean;
  haptics: boolean;
}

/** Plays the "rep counted" blip. */
export function playRepSound(kind: 'count' | 'invalid' = 'count'): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  if (kind === 'count') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.exponentialRampToValueAtTime(1050, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  } else {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.1, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  }

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.26);
}

/** A little three-note fanfare for the end of a workout. */
export function playFinishSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((frequency, index) => {
    const start = ctx.currentTime + index * 0.11;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.34);
  });
}

export function vibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw when the page is not visible - harmless.
  }
}

/** Countdown tick used by the 3-2-1-GO sequence. */
export function playCountdownTick(final = false): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(final ? 880 : 440, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.13, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (final ? 0.4 : 0.14));
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.45);
}

/** Reads the user's feedback preferences out of localStorage. */
export function loadFeedbackPrefs(): FeedbackOptions {
  if (typeof window === 'undefined') return { sound: true, haptics: true };
  try {
    const raw = window.localStorage.getItem('pushup-league.feedback');
    if (!raw) return { sound: true, haptics: true };
    const parsed = JSON.parse(raw) as Partial<FeedbackOptions>;
    return { sound: parsed.sound !== false, haptics: parsed.haptics !== false };
  } catch {
    return { sound: true, haptics: true };
  }
}

export function saveFeedbackPrefs(prefs: FeedbackOptions): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('pushup-league.feedback', JSON.stringify(prefs));
  } catch {
    // ignore
  }
}
