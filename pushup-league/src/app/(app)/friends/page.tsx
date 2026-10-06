'use client';

import { useState } from 'react';
import { useFriends, type FriendRow } from '@/lib/client/hooks';
import { ApiError, apiGet, apiSend } from '@/lib/client/api';
import { useToast } from '@/components/Toast';
import Avatar from '@/components/Avatar';
import ShareCard from '@/components/ShareCard';
import { formatCompact, formatDay, formatNumber, timeAgo } from '@/lib/client/format';
import { useSession } from '@/lib/client/session';

/**
 * FRIENDS
 * =======
 * Search, requests, your friend list, and a friend's profile when you tap them.
 *
 * Note what is missing: an email address appears nowhere, because the API never
 * returns one.
 */

interface SearchResult {
  userId: string;
  username: string;
  avatar: string | null;
  relation: 'none' | 'pending_outgoing' | 'pending_incoming' | 'friends' | 'blocked';
}

export default function FriendsPage() {
  const { user } = useSession();
  const { data, loading, reload } = useFriends();
  const { push } = useToast();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<FriendRow | null>(null);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) {
      push('Type at least 2 characters, or paste a 6-character friend code.', 'warn');
      return;
    }
    setSearching(true);
    try {
      const payload = await apiGet<{ results: SearchResult[] }>(
        `/api/friends/search?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(payload.results);
      if (payload.results.length === 0) push('Nobody matched that. Check the spelling or the code.', 'info');
    } catch (error) {
      push(error instanceof ApiError ? error.message : 'Search failed.', 'error');
    } finally {
      setSearching(false);
    }
  };

  const addFriend = async (result: SearchResult) => {
    setBusyId(result.userId);
    try {
      const payload = await apiSend<{ status: string }>('/api/friends', 'POST', { userId: result.userId });
      push(
        payload.status === 'accepted'
          ? `You and ${result.username} are now friends! 🤝`
          : payload.status === 'already_friends'
            ? 'You are already friends.'
            : `Friend request sent to ${result.username}.`,
        'success',
      );
      await reload();
      setResults((current) =>
        (current ?? []).map((item) =>
          item.userId === result.userId
            ? { ...item, relation: payload.status === 'accepted' ? 'friends' : 'pending_outgoing' }
            : item,
        ),
      );
    } catch (error) {
      push(error instanceof ApiError ? error.message : 'Could not send that request.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const respond = async (friendshipId: string, action: 'accept' | 'reject') => {
    setBusyId(friendshipId);
    try {
      await apiSend('/api/friends/respond', 'POST', { friendshipId, action });
      push(action === 'accept' ? 'Friend added! 🤝' : 'Request declined.', 'success');
      await reload();
    } catch (error) {
      push(error instanceof ApiError ? error.message : 'That did not work.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const cancelRequest = async (userId: string) => {
    setBusyId(userId);
    try {
      await apiSend(`/api/friends?userId=${userId}`, 'DELETE');
      push('Request cancelled.', 'info');
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const removeFriend = async (friend: FriendRow) => {
    if (!window.confirm(`Remove ${friend.username} from your friends?`)) return;
    setBusyId(friend.userId);
    try {
      await apiSend(`/api/friends?userId=${friend.userId}`, 'DELETE');
      push(`${friend.username} removed.`, 'info');
      setSelected(null);
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const blockUser = async (userId: string, username: string) => {
    if (!window.confirm(`Block ${username}? They will not be able to find you or contact you.`)) return;
    setBusyId(userId);
    try {
      await apiSend('/api/friends', 'PATCH', { userId, action: 'block' });
      push(`${username} blocked.`, 'info');
      setSelected(null);
      await reload();
      setResults((current) => (current ?? []).filter((item) => item.userId !== userId));
    } finally {
      setBusyId(null);
    }
  };

  if (loading || !data) {
    return (
      <div className="flex flex-col gap-3">
        <div className="skeleton h-8 w-40" />
        <div className="skeleton h-32 w-full rounded-3xl" />
        <div className="skeleton h-64 w-full rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-rise">
      <div>
        <h1 className="text-xl font-extrabold sm:text-2xl">Friends 👥</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          {data.friends.length} friend{data.friends.length === 1 ? '' : 's'}
        </p>
      </div>

      {/* ---------- Incoming requests ---------- */}
      {data.incoming.length > 0 ? (
        <section className="card p-4">
          <h2 className="font-bold">
            Friend requests
            <span className="ml-2 rounded-full bg-volt-500 px-2 py-0.5 text-xs text-ink-950">
              {data.incoming.length}
            </span>
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {data.incoming.map((request) => (
              <li key={request.friendshipId} className="flex items-center gap-3">
                <Avatar username={request.username} avatar={request.avatar} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{request.username}</p>
                  <p className="text-xs text-slate-500">{timeAgo(request.createdAt)}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary px-3 py-1.5 text-xs"
                  disabled={busyId === request.friendshipId}
                  onClick={() => void respond(request.friendshipId, 'accept')}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="btn btn-ghost px-3 py-1.5 text-xs"
                  disabled={busyId === request.friendshipId}
                  onClick={() => void respond(request.friendshipId, 'reject')}
                >
                  Reject
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---------- Search ---------- */}
      <section className="card p-4">
        <h2 className="font-bold">Add a friend</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Search by username, or paste a 6-character friend code.
        </p>
        <form onSubmit={search} className="mt-3 flex gap-2">
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Username or ABC123"
            autoCapitalize="characters"
            aria-label="Search for a friend"
          />
          <button type="submit" className="btn btn-secondary shrink-0 px-4" disabled={searching}>
            {searching ? '…' : '🔍'}
          </button>
        </form>

        {results ? (
          results.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              Nobody found. Ask your friend for their invite link instead — it is the easiest way.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {results.map((result) => (
                <li key={result.userId} className="flex items-center gap-3">
                  <Avatar username={result.username} avatar={result.avatar} size={38} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{result.username}</span>

                  {result.relation === 'friends' ? (
                    <span className="chip text-volt-400">Friends ✓</span>
                  ) : result.relation === 'pending_outgoing' ? (
                    <button
                      type="button"
                      className="btn btn-ghost px-3 py-1.5 text-xs"
                      disabled={busyId === result.userId}
                      onClick={() => void cancelRequest(result.userId)}
                    >
                      Cancel request
                    </button>
                  ) : result.relation === 'pending_incoming' ? (
                    <span className="chip text-flame-400">Wants to add you</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary px-3 py-1.5 text-xs"
                      disabled={busyId === result.userId}
                      onClick={() => void addFriend(result)}
                    >
                      + Add
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>

      {/* ---------- Outgoing requests ---------- */}
      {data.outgoing.length > 0 ? (
        <section className="card p-4">
          <h2 className="font-bold">Sent requests</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {data.outgoing.map((request) => (
              <li key={request.friendshipId} className="flex items-center gap-3">
                <Avatar username={request.username} avatar={request.avatar} size={34} />
                <span className="min-w-0 flex-1 truncate text-sm">{request.username}</span>
                <span className="text-xs text-slate-500">Waiting…</span>
                <button
                  type="button"
                  className="btn btn-ghost px-3 py-1.5 text-xs"
                  disabled={busyId === request.userId}
                  onClick={() => void cancelRequest(request.userId)}
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---------- Friend list ---------- */}
      <section className="card p-4">
        <h2 className="font-bold">Your friends</h2>
        {data.friends.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-white/12 px-4 py-6 text-center text-sm text-slate-400">
            No friends yet. Share your invite link below — anyone who joins with it is added
            automatically.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {data.friends.map((friend) => (
              <li key={friend.userId}>
                <button
                  type="button"
                  onClick={() => setSelected(friend)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5 text-left transition hover:bg-white/8"
                >
                  <Avatar username={friend.username} avatar={friend.avatar} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{friend.username}</span>
                    <span className="block text-xs text-slate-400">
                      {friend.currentStreak > 0 ? `🔥 ${friend.currentStreak} day streak · ` : ''}
                      Lifetime {formatCompact(friend.lifetime)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[10px] font-semibold text-slate-500">TODAY</span>
                    <span className="block font-extrabold tabular">{formatCompact(friend.today)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {user ? <ShareCard username={user.username} friendCode={data.friendCode} /> : null}

      {/* ---------- Friend profile sheet ---------- */}
      {selected ? (
        <FriendSheet
          friend={selected}
          onClose={() => setSelected(null)}
          onRemove={() => void removeFriend(selected)}
          onBlock={() => void blockUser(selected.userId, selected.username)}
          busy={busyId === selected.userId}
        />
      ) : null}
    </div>
  );
}

function FriendSheet({
  friend,
  onClose,
  onRemove,
  onBlock,
  busy,
}: {
  friend: FriendRow;
  onClose: () => void;
  onRemove: () => void;
  onBlock: () => void;
  busy: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/70 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${friend.username}'s profile`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="card card-raised w-full max-w-md rounded-b-none p-5 animate-rise sm:rounded-3xl">
        <div className="flex items-center gap-4">
          <Avatar username={friend.username} avatar={friend.avatar} size={64} ring />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-extrabold">{friend.username}</h2>
            <p className="text-sm text-slate-400">
              {friend.currentStreak > 0 ? `🔥 ${friend.currentStreak} day streak` : 'No active streak'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost px-3 py-1.5" aria-label="Close">
            ✕
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2">
          <SheetStat label="Today" value={friend.today} accent />
          <SheetStat label="This week" value={friend.week} />
          <SheetStat label="This month" value={friend.month} />
          <SheetStat label="Lifetime" value={friend.lifetime} />
          <SheetStat label="Personal best" value={friend.personalBest} />
        </dl>

        <div className="mt-5 flex gap-2">
          <button type="button" className="btn btn-danger flex-1 py-2.5 text-sm" onClick={onRemove} disabled={busy}>
            Remove friend
          </button>
          <button type="button" className="btn btn-ghost flex-1 py-2.5 text-sm" onClick={onBlock} disabled={busy}>
            Block
          </button>
        </div>

        <p className="mt-3 text-center text-[11px] text-slate-500">
          Joined {formatDay(new Date().toISOString())} · email addresses are never shared
        </p>
      </div>
    </div>
  );
}

function SheetStat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5">
      <dt className="text-[11px] font-semibold text-slate-400">{label}</dt>
      <dd className={`stat-number mt-0.5 text-2xl ${accent ? 'text-volt-500' : ''}`}>
        {formatNumber(value)}
      </dd>
    </div>
  );
}
