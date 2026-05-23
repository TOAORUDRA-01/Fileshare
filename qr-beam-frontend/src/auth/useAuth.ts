import { createContext, useContext } from 'react';

export interface AuthUser {
  name: string;
  email: string;
  picture: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  signOut: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  signOut: () => {},
});

export const useAuth = () => useContext(AuthContext);
