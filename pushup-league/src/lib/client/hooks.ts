'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from './api';
import { localDayKey } from './format';
import type { LeaderboardEntry } from '@/components/LeaderboardList';

/**
 * DATA HOOKS
 * ==========
 * Small wrappers around `apiGet` that also know when to refresh: when the tab
 * becomes visible again, and whenever the app announces that stats have changed
 * (a finished workout, or an offline queue that just uploaded).
 */

function useRefreshable<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const result = await apiGet<T>(path);
      if (mounted.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : 'Could not load that.');
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    const onStale = () => void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('pushup-league:stats-stale', onStale);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pushup-league:stats-stale', onStale);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { data, loading, error, reload: load, setData };
}

export interface StatsResponse {
  dayKey: string;
  stats: {
    today: number;
    week: number;
    month: number;
    lifetime: number;
    currentStreak: number;
    longestStreak: number;
    personalBest: number;
    averageDaily: number;
    activeDays: number;
    lastWorkoutDay: string | null;
    todaySeries: Array<{ day: string; count: number; label: string }>;
    weekTotal: number;
    yesterdayTotal: number;
    deltaVsYesterday: number;
    activeDaysThisMonth: number;
  };
  achievements: {
    unlocked: Array<{ code: string; name: string; description: string; icon: string; unlocked_at: string | null }>;
    locked: Array<{ code: string; name: string; description: string; icon: string; progress: number; threshold: number }>;
  };
  leaderboard: LeaderboardResponse;
}

export interface LeaderboardResponse {
  range: 'today' | 'week' | 'month' | 'all';
  entries: LeaderboardEntry[];
  selfRank: number | null;
  selfTotal: number;
  message: string | null;
  friendCount: number;
}

export function useStats() {
  return useRefreshable<StatsResponse>(`/api/stats?day=${localDayKey()}`);
}

export function useLeaderboard(range: 'today' | 'week' | 'month' | 'all') {
  return useRefreshable<LeaderboardResponse>(`/api/leaderboard?range=${range}&day=${localDayKey()}`, [range]);
}

export interface FriendRow {
  userId: string;
  username: string;
  avatar: string | null;
  today: number;
  week: number;
  month: number;
  lifetime: number;
  currentStreak: number;
  personalBest: number;
}

export interface FriendsResponse {
  dayKey: string;
  friends: FriendRow[];
  incoming: Array<{
    friendshipId: string;
    userId: string;
    username: string;
    avatar: string | null;
    createdAt: string;
    direction: 'incoming' | 'outgoing';
  }>;
  outgoing: Array<{
    friendshipId: string;
    userId: string;
    username: string;
    avatar: string | null;
    createdAt: string;
    direction: 'incoming' | 'outgoing';
  }>;
  friendCode: string;
}

export function useFriends() {
  return useRefreshable<FriendsResponse>(`/api/friends?day=${localDayKey()}`);
}

export interface ChallengeParticipant {
  userId: string;
  username: string;
  avatar: string | null;
  pushups: number;
  isSelf: boolean;
  rank: number;
  progress: number;
}

export interface ChallengeView {
  id: string;
  name: string;
  description: string | null;
  type: 'total' | 'first_to';
  target: number | null;
  startDate: string;
  endDate: string;
  createdBy: string;
  isCreator: boolean;
  isParticipant: boolean;
  participants: ChallengeParticipant[];
  totalPushups: number;
  daysRemaining: number;
  daysTotal: number;
  daysElapsed: number;
  status: 'upcoming' | 'active' | 'finished';
  selfRank: number | null;
  message: string | null;
  winner: string | null;
}

export interface ChallengesResponse {
  dayKey: string;
  challenges: ChallengeView[];
  friends: Array<{ userId: string; username: string; avatar: string | null }>;
}

export function useChallenges() {
  return useRefreshable<ChallengesResponse>(`/api/challenges?day=${localDayKey()}`);
}

export interface NotificationsResponse {
  notifications: Array<{
    id: string;
    type: string;
    message: string;
    icon: string | null;
    createdAt: string;
    read: boolean;
  }>;
  unread: number;
  enabled: boolean;
  frequency: string;
}

export function useNotifications() {
  return useRefreshable<NotificationsResponse>('/api/notifications');
}
