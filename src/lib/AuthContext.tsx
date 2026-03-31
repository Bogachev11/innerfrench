"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";

const AUTH_KEY = "fp_authenticated";

type AuthCtx = {
  authenticated: boolean;
  loading: boolean;
  signIn: (password: string) => { error?: string };
  signOut: () => void;
};

const AuthContext = createContext<AuthCtx>({
  authenticated: false,
  loading: true,
  signIn: () => ({}),
  signOut: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(AUTH_KEY);
    if (stored === "true") {
      setAuthenticated(true);
    }
    setLoading(false);
  }, []);

  const signIn = useCallback((password: string) => {
    if (password === process.env.NEXT_PUBLIC_APP_PASSWORD) {
      setAuthenticated(true);
      localStorage.setItem(AUTH_KEY, "true");
      return {};
    }
    return { error: "Wrong password" };
  }, []);

  const signOut = useCallback(() => {
    setAuthenticated(false);
    localStorage.removeItem(AUTH_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ authenticated, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
