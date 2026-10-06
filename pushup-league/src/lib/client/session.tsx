'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiGet, apiSend } from './api';
import { installOfflineSync } from './offline';

/**
 * SESSION CONTEXT
 * ===============
 * Holds the signed-in user for the whole app. One fetch to /api/auth/me on
 * start-up, then every screen reads from here instead of asking again.
 *
 * The browser never sees a password, a session token or any biometric data -
 * just the profile fields the API chooses to return.
 */

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
  friend_code: string;
  face_auth_enabled: boolean;
  biometric_consent_at: string | null;
  created_at: string;
  current_streak: number;
  longest_streak: number;
  lifetime_pushups: number;
  personal_best: number;
  avg_daily_pushups: number;
  active_days: number;
  last_workout_date: string | null;
  onboarded: boolean;
  notify_enabled: boolean;
  notify_frequency: string;
}

interface SessionState {
  user: SessionUser | null;
  passkeyCount: number;
  loading: boolean;
  /** Re-reads the session from the server. */
  refresh: () => Promise<SessionUser | null>;
  /** Replaces the cached user without a round trip. */
  setUser: (user: SessionUser | null) => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [passkeyCount, setPasskeyCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<{ user: SessionUser | null; passkeyCount?: number }>('/api/auth/me');
      setUserState(data.user);
      setPasskeyCount(data.passkeyCount ?? 0);
      return data.user;
    } catch {
      setUserState(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Any finished workout that could not be uploaded earlier gets retried as
  // soon as the connection comes back.
  useEffect(() => {
    return installOfflineSync(() => {
      void refresh();
      window.dispatchEvent(new CustomEvent('pushup-league:stats-stale'));
    });
  }, [refresh]);

  const setUser = useCallback((next: SessionUser | null) => {
    setUserState(next);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiSend('/api/auth/logout', 'POST');
    } finally {
      setUserState(null);
      setPasskeyCount(0);
    }
  }, []);

  const value = useMemo<SessionState>(
    () => ({ user, passkeyCount, loading, refresh, setUser, logout }),
    [user, passkeyCount, loading, refresh, setUser, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}
