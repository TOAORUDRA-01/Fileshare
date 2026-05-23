import { useState, useCallback } from 'react';
import { GoogleOAuthProvider, googleLogout } from '@react-oauth/google';
import { AuthContext } from './useAuth';
import type { AuthUser } from './useAuth';
import { LoginScreen } from './LoginScreen';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const ALLOWED_EMAIL = 'rudrachauhan526@gmail.com';
const STORAGE_KEY = 'qrbeam_auth_user';

/** Decode JWT payload — claims already validated by Google, safe for client use. */
function decodeJwt(token: string): { email: string; name: string; picture: string; email_verified: boolean } {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      const parsed: AuthUser = JSON.parse(stored);
      // Re-validate stored email in case whitelist changed
      return parsed.email === ALLOWED_EMAIL ? parsed : null;
    } catch {
      return null;
    }
  });
  const [unauthorizedEmail, setUnauthorizedEmail] = useState<string | null>(null);

  const handleSuccess = useCallback((credential: string) => {
    try {
      const claims = decodeJwt(credential);
      if (claims.email !== ALLOWED_EMAIL) {
        googleLogout();
        setUnauthorizedEmail(claims.email);
        return;
      }
      const authUser: AuthUser = {
        name: claims.name,
        email: claims.email,
        picture: claims.picture,
      };
      setUser(authUser);
      setUnauthorizedEmail(null);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
    } catch {
      setUnauthorizedEmail('unknown');
    }
  }, []);

  const signOut = useCallback(() => {
    googleLogout();
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <GoogleOAuthProvider clientId={CLIENT_ID}>
      <AuthContext.Provider value={{ user, signOut }}>
        {user ? (
          children
        ) : (
          <LoginScreen
            onSuccess={handleSuccess}
            unauthorizedEmail={unauthorizedEmail}
          />
        )}
      </AuthContext.Provider>
    </GoogleOAuthProvider>
  );
}
