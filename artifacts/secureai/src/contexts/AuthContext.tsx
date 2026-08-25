import { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { useGetCurrentUser, User, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
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
      queryKey: getGetCurrentUserQueryKey(),
      retry: false,
      refetchOnWindowFocus: false,
    }
  });

  const [tempToken, setTempToken] = useState<string | null>(null);
  const [requiresFaceVerification, setRequiresFaceVerification] = useState(false);
  const [location, setLocation] = useLocation();

  // Route guard:
  // - Unauthenticated users on protected routes → login page
  // - Authenticated users on public routes → dashboard
  // - Authenticated users with neither factor enrolled → /enroll
  //   (either face or passkey satisfies MFA — see requireMfaEnrolled.ts)
  useEffect(() => {
    if (!isLoading) {
      const isPublicRoute = location === '/' || location === '/register' || location === '/forgot-password' || location === '/reset-password';
      const isEnrollRoute = location === '/enroll';
      const mfaComplete = !!user && (user.faceEnrolled || user.passkeyEnrolled);

      if (!user && !isPublicRoute && !requiresFaceVerification) {
        setLocation('/');
      } else if (user && isPublicRoute && !requiresFaceVerification) {
        // Always send freshly-logged-in, not-fully-enrolled users to enroll first
        setLocation(mfaComplete ? '/dashboard' : '/enroll');
      } else if (user && !mfaComplete && !isEnrollRoute && !isPublicRoute) {
        // Authenticated but MFA enrollment incomplete — block access to all other routes
        setLocation('/enroll');
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
