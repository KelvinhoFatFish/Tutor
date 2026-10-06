'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * TOASTS
 * ======
 * Small pop-up messages ("Friend request sent", "Invalid rep", "Saved offline").
 * Screen readers announce them because the container is an aria-live region.
 */

export type ToastTone = 'success' | 'error' | 'info' | 'warn';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  icon?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, tone?: ToastTone, icon?: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastState | null>(null);

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'border-volt-500/40 bg-volt-500/12 text-volt-400',
  error: 'border-danger-500/40 bg-danger-500/12 text-danger-400',
  info: 'border-sky-500/40 bg-sky-500/12 text-sky-400',
  warn: 'border-flame-500/40 bg-flame-500/12 text-flame-400',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = 'info', icon?: string) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current.slice(-2), { id, message, tone, icon }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 5200 : 3400);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3 safe-top"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className={`pointer-events-auto w-full max-w-sm rounded-2xl border px-4 py-3 text-left text-sm font-semibold shadow-2xl backdrop-blur-xl animate-rise ${TONE_STYLES[toast.tone]}`}
          >
            {toast.icon ? <span className="mr-1.5">{toast.icon}</span> : null}
            {toast.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
