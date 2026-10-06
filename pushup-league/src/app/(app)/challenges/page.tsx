'use client';

import { useState } from 'react';
import { useChallenges, type ChallengeView } from '@/lib/client/hooks';
import { ApiError, apiSend } from '@/lib/client/api';
import { useToast } from '@/components/Toast';
import Avatar from '@/components/Avatar';
import ProgressBar from '@/components/ProgressBar';
import { formatDayShort, formatNumber, localDayKey } from '@/lib/client/format';

/**
 * CHALLENGES (a.k.a. Battles)
 * ===========================
 * Time-boxed competitions with your friends. Progress bars, live ranking and
 * a running commentary of how far behind the person above you are.
 */

const TEMPLATES = [
  { name: '100 Push-Up Weekend', days: 3, target: 100, type: 'total' as const, description: '100 push-ups before Monday.' },
  { name: '7-Day Push-Up Battle', days: 7, target: null, type: 'total' as const, description: 'Seven days. Most push-ups wins.' },
  { name: 'First to 500', days: 14, target: 500, type: 'first_to' as const, description: 'First person to 500 takes it.' },
  { name: '30-Day Challenge', days: 30, target: null, type: 'total' as const, description: 'A month of consistency.' },
];

export default function ChallengesPage() {
  const { data, loading, reload } = useChallenges();
  const { push } = useToast();
  const [creating, setCreating] = useState(false);

  if (loading || !data) {
    return (
      <div className="flex flex-col gap-3">
        <div className="skeleton h-8 w-40" />
        <div className="skeleton h-44 w-full rounded-3xl" />
        <div className="skeleton h-44 w-full rounded-3xl" />
      </div>
    );
  }

  const active = data.challenges.filter((c) => c.status === 'active');
  const upcoming = data.challenges.filter((c) => c.status === 'upcoming');
  const finished = data.challenges.filter((c) => c.status === 'finished');

  return (
    <div className="flex flex-col gap-4 animate-rise">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold sm:text-2xl">Battles 🔥</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            {active.length} active · {data.friends.length} friend
            {data.friends.length === 1 ? '' : 's'} available
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary shrink-0 px-4 py-2.5 text-sm"
          onClick={() => setCreating(true)}
          disabled={data.friends.length === 0}
          title={data.friends.length === 0 ? 'Add a friend first' : undefined}
        >
          + New battle
        </button>
      </div>

      {data.friends.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300">
          Battles are between friends, so add someone first — the Friends tab has your invite link.
        </p>
      ) : null}

      {data.challenges.length === 0 && data.friends.length > 0 ? (
        <div className="card p-6 text-center">
          <div className="text-4xl" aria-hidden="true">
            🔥
          </div>
          <p className="mt-3 font-bold">No battles yet</p>
          <p className="mt-1 text-sm text-slate-400">
            Start a 7-day battle and see who cracks first.
          </p>
          <button type="button" className="btn btn-primary mt-4 px-6 py-3" onClick={() => setCreating(true)}>
            Create your first battle
          </button>
        </div>
      ) : null}

      {[
        { title: 'Active', items: active },
        { title: 'Starting soon', items: upcoming },
        { title: 'Finished', items: finished },
      ]
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section key={group.title} className="flex flex-col gap-3">
            <h2 className="text-sm font-bold tracking-wider text-slate-400">{group.title.toUpperCase()}</h2>
            {group.items.map((challenge) => (
              <ChallengeCard key={challenge.id} challenge={challenge} onChanged={reload} />
            ))}
          </section>
        ))}

      {creating ? <CreateChallengeSheet onClose={() => setCreating(false)} onCreated={reload} friends={data.friends} /> : null}
    </div>
  );
}

function ChallengeCard({ challenge, onChanged }: { challenge: ChallengeView; onChanged: () => void }) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  const townDown = async (action: 'leave' | 'join') => {
    setBusy(true);
    try {
      await apiSend(`/api/challenges/${challenge.id}?action=${action}`, 'POST');
      push(action === 'leave' ? 'You left that battle.' : 'You joined the battle! 🔥', 'success');
      await onChanged();
    } catch (error) {
      push(error instanceof ApiError ? error.message : 'That did not work.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${challenge.name}" for everyone?`)) return;
    setBusy(true);
    try {
      await apiSend(`/api/challenges/${challenge.id}`, 'DELETE');
      push('Battle deleted.', 'info');
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const timeLabel =
    challenge.status === 'finished'
      ? 'Finished'
      : challenge.status === 'upcoming'
        ? `Starts ${formatDayShort(challenge.startDate)}`
        : challenge.daysRemaining === 0
          ? 'Last day!'
          : `${challenge.daysRemaining} day${challenge.daysRemaining === 1 ? '' : 's'} left`;

  return (
    <article className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-bold">
            {challenge.status === 'active' ? '🔥 ' : challenge.status === 'finished' ? '🏁 ' : '⏳ '}
            {challenge.name}
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {formatDayShort(challenge.startDate)} → {formatDayShort(challenge.endDate)} · {timeLabel}
            {challenge.target ? ` · target ${formatNumber(challenge.target)}` : ''}
          </p>
        </div>
        <span
          className={`chip shrink-0 ${
            challenge.status === 'active'
              ? 'border-volt-500/30 bg-volt-500/12 text-volt-400'
              : challenge.status === 'finished'
                ? 'text-slate-400'
                : 'border-sky-500/30 bg-sky-500/12 text-sky-400'
          }`}
        >
          {challenge.participants.length} player{challenge.participants.length === 1 ? '' : 's'}
        </span>
      </div>

      {challenge.description ? (
        <p className="mt-2 text-sm text-slate-300">{challenge.description}</p>
      ) : null}

      {/* Participants with progress bars */}
      <ul className="mt-4 flex flex-col gap-3">
        {challenge.participants.map((participant) => (
          <li key={participant.userId}>
            <div className="flex items-center gap-2.5">
              <span className="w-5 shrink-0 text-center text-xs font-bold text-slate-500 tabular">
                {participant.rank}
              </span>
              <Avatar username={participant.username} avatar={participant.avatar} size={28} />
              <span
                className={`min-w-0 flex-1 truncate text-sm ${
                  participant.isSelf ? 'font-bold text-volt-400' : 'font-semibold'
                }`}
              >
                {participant.isSelf ? 'You' : participant.username}
              </span>
              <span className="shrink-0 text-sm font-extrabold tabular">
                {formatNumber(participant.pushups)}
              </span>
            </div>
            <div className="mt-1.5 pl-[3.25rem]">
              <ProgressBar
                value={participant.progress}
                tone={participant.isSelf ? 'volt' : 'sky'}
                height={6}
                label={`${participant.username} progress`}
              />
            </div>
          </li>
        ))}
      </ul>

      {challenge.message ? (
        <p className="mt-3 rounded-xl border border-volt-500/25 bg-volt-500/8 px-3 py-2 text-sm font-semibold text-volt-400">
          {challenge.message}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>Total: {formatNumber(challenge.totalPushups)} push-ups</span>
        <div className="flex gap-2">
          {challenge.isParticipant && challenge.status !== 'finished' ? (
            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => void townDown('leave')} disabled={busy}>
              Leave
            </button>
          ) : null}
          {!challenge.isParticipant ? (
            <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => void townDown('join')} disabled={busy}>
              Join
            </button>
          ) : null}
          {challenge.isCreator ? (
            <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs text-danger-400" onClick={() => void remove()} disabled={busy}>
              Delete
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function CreateChallengeSheet({
  friends,
  onClose,
  onCreated,
}: {
  friends: Array<{ userId: string; username: string; avatar: string | null }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { push } = useToast();
  const today = localDayKey();

  const [template, setTemplate] = useState(TEMPLATES[1]);
  const [name, setName] = useState(TEMPLATES[1].name);
  const [description, setDescription] = useState(TEMPLATES[1].description);
  const [target, setTarget] = useState<string>(TEMPLATES[1].target ? String(TEMPLATES[1].target) : '');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, TEMPLATES[1].days - 1));
  const [selected, setSelected] = useState<string[]>(friends.map((f) => f.userId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyTemplate = (next: (typeof TEMPLATES)[number]) => {
    setTemplate(next);
    setName(next.name);
    setDescription(next.description);
    setTarget(next.target ? String(next.target) : '');
    setStartDate(today);
    setEndDate(addDays(today, next.days - 1));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('/api/challenges', 'POST', {
        name,
        description,
        type: template.type,
        target: target ? Number(target) : undefined,
        startDate,
        endDate,
        invitees: selected,
      });
      push(`${name} created! 🔥`, 'success');
      await onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create that battle.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink-950/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create a battle"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="card card-raised max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 animate-rise sm:rounded-3xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold">New battle 🔥</h2>
          <button type="button" onClick={onClose} className="btn btn-ghost px-3 py-1.5" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mt-4">
          <p className="label">Quick start</p>
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATES.map((item) => (
              <button
                key={item.name}
                type="button"
                onClick={() => applyTemplate(item)}
                className={`rounded-2xl border px-3 py-2.5 text-left text-xs transition ${
                  template.name === item.name
                    ? 'border-volt-500/60 bg-volt-500/12'
                    : 'border-white/10 bg-white/4 hover:bg-white/8'
                }`}
              >
                <span className="block font-bold">{item.name}</span>
                <span className="mt-0.5 block text-slate-400">{item.days} days</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="label" htmlFor="ch-name">Name</label>
            <input id="ch-name" className="input" value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <label className="label" htmlFor="ch-desc">Description (optional)</label>
            <input id="ch-desc" className="input" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ch-start">Starts</label>
              <input id="ch-start" type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ch-end">Ends</label>
              <input id="ch-end" type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="ch-target">Target push-ups (optional)</label>
            <input
              id="ch-target"
              type="number"
              min={1}
              className="input"
              value={target}
              placeholder="Leave empty for most-reps-wins"
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>

          <div>
            <p className="label">Who is in?</p>
            <ul className="flex flex-col gap-1.5">
              {friends.map((friend) => (
                <li key={friend.userId}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-volt-500"
                      checked={selected.includes(friend.userId)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, friend.userId]
                            : current.filter((id) => id !== friend.userId),
                        )
                      }
                    />
                    <Avatar username={friend.username} avatar={friend.avatar} size={28} />
                    <span className="text-sm font-semibold">{friend.username}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-danger-400">{error}</p> : null}

        <button type="submit" className="btn btn-primary mt-5 w-full py-3.5" disabled={busy}>
          {busy ? 'Creating…' : 'Create battle 🔥'}
        </button>
      </form>
    </div>
  );
}

function addDays(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDayKey(date);
}
