/**
 * Global app context: authentication state + shared data cache.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

interface AppState {
  // Auth
  authenticated: boolean | null; // null = still checking
  initialized: boolean;
  temporary: boolean; // true while the sign-in password is the temporary one
  temporaryPassword: string | undefined; // shown on first-run page when the system ships uninitialised with a temp code
  authError: string | null;
  // 'cloudflare-access' when sign-in is handled by Cloudflare Access (Zero Trust)
  authProvider: 'password' | 'cloudflare-access';
  userEmail: string;
  checking: boolean;
  login: (password: string) => Promise<void>;
  initSystem: (password: string, temporary?: boolean) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;

  // Setup
  setup: Record<string, any> | null;
  refreshSetup: () => Promise<void>;

  // Global refresh for cross-page consistency
  refreshAll: () => Promise<void>;

  // Toast notifications
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  toasts: { id: number; message: string; type: string }[];
  dismissToast: (id: number) => void;
}

const AppContext = createContext<AppState | null>(null);

let toastSeq = 0;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | undefined>(undefined);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authProvider, setAuthProvider] = useState<'password' | 'cloudflare-access'>('password');
  const [userEmail, setUserEmail] = useState('');
  const [checking, setChecking] = useState(false);
  const [setup, setSetup] = useState<Record<string, any> | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string; type: string }[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const refreshSetup = useCallback(async () => {
    try {
      const s = await api.setup.get();
      setSetup(s);
    } catch {
      /* setup may not exist yet - fine */
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await refreshSetup();
  }, [refreshSetup]);

  // On mount: check session status
  useEffect(() => {
    (async () => {
      try {
        const status = await api.auth.status();
        setInitialized(status.initialized);
        setTemporary(!!status.temporary);
        setTemporaryPassword(status.temporary_password);
        setAuthProvider(status.provider === 'cloudflare-access' ? 'cloudflare-access' : 'password');
        setUserEmail(status.email || '');
        if (status.initialized) {
          try {
            await api.auth.check();
            setAuthenticated(true);
            await refreshAll();
          } catch {
            setAuthenticated(false);
          }
        } else {
          setAuthenticated(false);
        }
      } catch {
        // Backend unreachable - show login anyway so the user sees an error state
        setAuthenticated(false);
        setAuthError('Could not reach the server. Check your connection.');
      }
    })();
  }, [refreshAll]);

  const refreshAuthStatus = useCallback(async () => {
    try {
      const status = await api.auth.status();
      setInitialized(status.initialized);
      setTemporary(!!status.temporary);
      setTemporaryPassword(status.temporary_password);
    } catch {
      /* ignore */
    }
  }, []);

  const login = useCallback(async (password: string) => {
    setChecking(true);
    setAuthError(null);
    try {
      await api.auth.login(password);
      setAuthenticated(true);
      await refreshAll();
      await refreshAuthStatus();
    } catch (e: any) {
      setAuthError(e.message || 'Login failed');
      throw e;
    } finally {
      setChecking(false);
    }
  }, [refreshAll, refreshAuthStatus]);

  const initSystem = useCallback(async (password: string, temporary = false) => {
    setChecking(true);
    setAuthError(null);
    try {
      await api.auth.init(password, temporary);
      setInitialized(true);
      setTemporary(temporary);
      setAuthenticated(true);
      await refreshAll();
    } catch (e: any) {
      setAuthError(e.message || 'Initialisation failed');
      throw e;
    } finally {
      setChecking(false);
    }
  }, [refreshAll]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api.auth.changePassword(currentPassword, newPassword);
    setTemporary(false);
    await refreshAuthStatus();
  }, [refreshAuthStatus]);

  const logout = useCallback(async () => {
    let logoutUrl: string | undefined;
    try {
      logoutUrl = (await api.auth.logout())?.logout_url;
    } catch {
      /* ignore */
    }
    setAuthenticated(false);
    setSetup(null);
    // Cloudflare Access: the browser itself has to visit the logout URL to
    // drop the Access cookie, otherwise the next request signs straight back in.
    if (logoutUrl) window.location.assign(logoutUrl);
  }, []);

  // Any API 401/403 (expired session, Cloudflare edge block) bounces the app
  // back to the login screen — not just the mount-time check.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onAuthFailed = () => setAuthenticated(false);
    window.addEventListener('app:auth-failed', onAuthFailed);
    return () => window.removeEventListener('app:auth-failed', onAuthFailed);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      authenticated,
      initialized,
      temporary,
      temporaryPassword,
      authError,
      authProvider,
      userEmail,
      checking,
      login,
      initSystem,
      changePassword,
      logout,
      setup,
      refreshSetup,
      refreshAll,
      showToast,
      toasts,
      dismissToast,
    }),
    [authenticated, initialized, temporary, temporaryPassword, authError, authProvider, userEmail, checking, login, initSystem, changePassword, logout, setup, refreshSetup, refreshAll, showToast, toasts, dismissToast]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}