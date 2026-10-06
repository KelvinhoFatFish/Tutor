'use client';

import { avatarColor, initials } from '@/lib/client/format';

/**
 * A user's picture. Accepts three kinds of value:
 *   - a data: URL (an uploaded photo),
 *   - a single emoji (the quick picker on the profile screen),
 *   - nothing, in which case we draw their initials on a colour derived from
 *     their name so everyone still looks distinct.
 */
export default function Avatar({
  username,
  avatar,
  size = 40,
  ring = false,
  className = '',
}: {
  username: string;
  avatar?: string | null;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  const isImage = typeof avatar === 'string' && avatar.startsWith('data:image/');
  const isEmoji = typeof avatar === 'string' && avatar.length > 0 && !isImage;

  const style: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * (isEmoji ? 0.5 : 0.38)),
    background: `linear-gradient(140deg, ${avatarColor(username)}, ${avatarColor(username + 'x')})`,
  };

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-ink-950 select-none ${
        ring ? 'ring-2 ring-volt-500/60 ring-offset-2 ring-offset-ink-950' : ''
      } ${className}`}
      style={style}
      aria-hidden="true"
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar as string} alt="" className="h-full w-full object-cover" />
      ) : isEmoji ? (
        <span>{avatar}</span>
      ) : (
        <span>{initials(username)}</span>
      )}
    </span>
  );
}
