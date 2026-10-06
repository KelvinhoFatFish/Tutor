'use client';

import { useEffect, useState } from 'react';
import { useToast } from './Toast';

/**
 * INVITE / SHARE
 * ==============
 * Gives every user a unique invite link. Opening it drops the visitor on the
 * registration screen with the code attached, and the two accounts are
 * connected automatically once they sign up - no typing usernames.
 *
 * On phones we use the native share sheet (the same one you get in Photos),
 * with WhatsApp / email / copy-link fallbacks everywhere else.
 */
export default function ShareCard({
  username,
  friendCode,
  compact = false,
}: {
  username: string;
  friendCode: string;
  compact?: boolean;
}) {
  const { push } = useToast();
  const [origin, setOrigin] = useState('');
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  const link = origin ? `${origin}/invite/${friendCode}` : '';
  const message = `💪 I'm challenging you to PushUp League. Let's see who can do more push-ups! Join me: ${link}`;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      push(`${label} copied ✓`, 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      push('Your browser blocked the clipboard. Long-press the link to copy it.', 'warn');
    }
  };

  const share = async () => {
    if (!canShare) {
      await copy(message, 'Invite message');
      return;
    }
    try {
      await navigator.share({ title: 'PushUp League', text: message, url: link });
    } catch (error) {
      // The user dismissing the share sheet throws - that is not an error.
      if ((error as { name?: string })?.name !== 'AbortError') {
        push('Sharing did not work. Copy the link instead.', 'warn');
      }
    }
  };

  return (
    <div className={`card ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-center gap-2">
        <span className="text-lg" aria-hidden="true">
          🔗
        </span>
        <h3 className="font-bold">Invite a friend</h3>
      </div>

      <p className="mt-1 text-xs text-slate-400">
        Anyone who opens this link and signs up becomes your friend automatically.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-xl border border-white/10 bg-ink-950/60 px-3 py-2.5 text-xs text-volt-400">
          {link || 'Loading…'}
        </code>
        <button
          type="button"
          className="btn btn-secondary shrink-0 px-3 py-2.5 text-xs"
          onClick={() => void copy(link, 'Link')}
        >
          {copied ? '✓' : 'Copy'}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button type="button" className="btn btn-primary px-3 py-2.5 text-xs" onClick={() => void share()}>
          📤 {canShare ? 'Share' : 'Share text'}
        </button>
        <a
          className="btn btn-secondary px-3 py-2.5 text-xs"
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          💬 WhatsApp
        </a>
        <a
          className="btn btn-secondary px-3 py-2.5 text-xs"
          href={`sms:?&body=${encodeURIComponent(message)}`}
        >
          ✉️ Messages
        </a>
        <a
          className="btn btn-secondary px-3 py-2.5 text-xs"
          href={`mailto:?subject=${encodeURIComponent('PushUp League challenge')}&body=${encodeURIComponent(message)}`}
        >
          📧 Email
        </a>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
        <div>
          <p className="text-[11px] font-semibold text-slate-400">Your friend code</p>
          <p className="font-mono text-lg font-extrabold tracking-[0.2em] text-volt-400">{friendCode}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost px-3 py-2 text-xs"
          onClick={() => void copy(friendCode, 'Friend code')}
        >
          Copy code
        </button>
      </div>

      {!compact ? (
        <p className="mt-3 text-[11px] text-slate-500">
          Your friend code is shareable. It is not a password and cannot be used to sign in as {username}.
        </p>
      ) : null}
    </div>
  );
}
