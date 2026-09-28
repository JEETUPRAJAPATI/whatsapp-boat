import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';

const AppContext = createContext(null);

/** Toast ids only need to be unique within a session. */
let toastSeq = 0;

/**
 * Global app state: who is signed in, the WhatsApp connection banner, the
 * chosen theme, and toasts.
 *
 * Anything page-specific stays in the page - this holds only what genuinely
 * has to be shared across the shell.
 */
export function AppProvider({ children }) {
  const [booting, setBooting] = useState(true);
  const [status, setStatus] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('wa-catalog-theme') || 'light';
    } catch {
      return 'light';
    }
  });

  const timers = useRef(new Map());

  // ---------------------------------------------------------------- toasts

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (text, kind = 'success', { duration } = {}) => {
      const id = ++toastSeq;
      setToasts((current) => [...current, { id, text: String(text), kind }]);

      // Errors linger: the operator may need to read a Meta message carefully.
      const ms = duration ?? (kind === 'error' ? 7000 : 3800);
      timers.current.set(
        id,
        setTimeout(() => dismissToast(id), ms),
      );
      return id;
    },
    [dismissToast],
  );

  /** Every catch block in the app funnels through here. */
  const toastError = useCallback(
    (err, fallback = 'Something went wrong.') => {
      const message = err?.message || fallback;
      toast(message, 'error');
      return message;
    },
    [toast],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach(clearTimeout);
      map.clear();
    };
  }, []);

  // ----------------------------------------------------------------- theme

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('wa-catalog-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await api.status();
      setStatus(next);
      return next;
    } catch {
      // A status failure must never blank the screen; the banner just goes quiet.
      return null;
    }
  }, []);

  /** Boot: load whatever the shell needs before the first paint. */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await refreshStatus();
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshStatus]);

  const value = useMemo(
    () => ({
      booting,
      status,
      theme,
      toasts,
      toggleTheme,
      refreshStatus,
      toast,
      toastError,
      dismissToast,
    }),
    [booting, status, theme, toasts, toggleTheme, refreshStatus, toast, toastError, dismissToast],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
