import React, { createContext, useContext, useCallback, useEffect, useState, ReactNode } from 'react';
import { AppUser, getMe, primeCsrfCookie } from '../lib/api';

interface AuthContextValue {
  user: AppUser | null;
  isLoading: boolean;
  refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refetchUser = useCallback(async () => {
    const current = await getMe();
    setUser(current);
  }, []);

  useEffect(() => {
    (async () => {
      await primeCsrfCookie();
      await refetchUser();
      setIsLoading(false);
    })();
  }, [refetchUser]);

  return <AuthContext.Provider value={{ user, isLoading, refetchUser }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
