"use client";

/* Client auth context. Loads the current session on mount, exposes the signed-in
   user, the available social providers, and refresh/sign-out helpers. */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { User } from "@/lib/types";
import { getMe, logout as apiLogout, type ProviderStatus } from "@/lib/api-client";

interface AuthContextValue {
  user: User | null;
  providers: ProviderStatus[];
  loading: boolean;
  /** Re-fetch the session (call after a successful login). */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  providers: [],
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user, providers } = await getMe();
      setUser(user);
      setProviders(providers);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout().catch(() => {});
    setUser(null);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, providers, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
