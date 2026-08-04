import { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { useGetCurrentUser, User, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  tempToken: string | null;
  setTempToken: (token: string | null) => void;
  requiresFaceVerification: boolean;
  setRequiresFaceVerification: (val: boolean) => void;
  refetchUser: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading, refetch } = useGetCurrentUser({
    query: {
      retry: false,
      refetchOnWindowFocus: false,
    }
  });

  const [tempToken, setTempToken] = useState<string | null>(null);
  const [requiresFaceVerification, setRequiresFaceVerification] = useState(false);
  const [location, setLocation] = useLocation();

  // Basic protection: if we are not loading, don't have a user, and are on a protected route -> /
  useEffect(() => {
    if (!isLoading) {
      const isPublicRoute = location === '/' || location === '/register';
      if (!user && !isPublicRoute && !requiresFaceVerification) {
        setLocation('/');
      } else if (user && isPublicRoute && !requiresFaceVerification) {
        setLocation('/dashboard');
      }
    }
  }, [user, isLoading, location, setLocation, requiresFaceVerification]);

  return (
    <AuthContext.Provider
      value={{
        user: user || null,
        isLoading,
        tempToken,
        setTempToken,
        requiresFaceVerification,
        setRequiresFaceVerification,
        refetchUser: refetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
