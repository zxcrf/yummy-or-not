/* ============================================================
   YUMMY OR NOT — AuthProvider (React Native + RN Web)
   Holds the signed-in session and persists the bearer token across
   launches. The shared api-client keeps the token in module memory and
   sets it on a successful login/verify/register; this provider's job is
   to (a) reload that token on startup, (b) capture a freshly-issued one
   after refresh(), and (c) clear it on sign-out.

   Token persistence is Platform-gated exactly like I18nProvider so the
   web bundle never pulls the SecureStore native module and native never
   touches `window`. Storage key: `yon_token`.
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Platform } from 'react-native'
import { Image } from 'expo-image'
import {
  getAuthToken,
  getMe,
  logout,
  setAuthToken,
  type ProviderStatus,
  type User,
} from '@yon/shared'
import { clearPersistedTastes, setTastesUser } from '@/app/(tabs)/_useTastes'
import { clearTagsCache, setTagsUser } from '@/app/(tabs)/_useTags'

// ----------------------------------------------------------------
// Context shape
// ----------------------------------------------------------------

interface AuthContextValue {
  user: User | null
  providers: ProviderStatus[]
  loading: boolean
  /** Re-fetch the session; persists the current in-memory token on success. */
  refresh: () => Promise<void>
  /** Revoke the session and clear the persisted token. */
  signOut: () => Promise<void>
  /** Optimistically merge fields into the in-memory user without a network round-trip. */
  patchUser: (partial: Partial<User>) => void
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  providers: [],
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
  patchUser: () => {},
})

// ----------------------------------------------------------------
// Persistence — Platform-gated read/write of the stored bearer token.
// ----------------------------------------------------------------

const STORAGE_KEY = 'yon_token'

/** Read the persisted token (or null). Async to accommodate native secure storage. */
async function readStoredToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store')
    return await SecureStore.getItemAsync(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Persist the token (or remove it when null). Best-effort. */
function writeStoredToken(token: string | null): void {
  try {
    if (Platform.OS === 'web') {
      if (token) globalThis.localStorage?.setItem(STORAGE_KEY, token)
      else globalThis.localStorage?.removeItem(STORAGE_KEY)
      return
    }
    // Use require() so jest moduleNameMapper can intercept it (dynamic
    // import() bypasses the mapper and requires --experimental-vm-modules).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store')
    void (token
      ? SecureStore.setItemAsync(STORAGE_KEY, token)
      : SecureStore.deleteItemAsync(STORAGE_KEY))
  } catch {
    // ignore — persistence is best-effort.
  }
}

// ----------------------------------------------------------------
// Provider
// ----------------------------------------------------------------

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const { user, providers } = await getMe()
      // Scope the shared taste + tag caches to this account before any view reads them.
      setTastesUser(user?.id ?? null)
      setTagsUser(user?.id ?? null)
      setUser(user)
      setProviders(providers)
      // Capture the token a just-completed login put in memory.
      writeStoredToken(getAuthToken())
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Bootstrap: handle OAuth hash return (web) → else load persisted token,
  // then refresh the session.
  useEffect(() => {
    let active = true
    ;(async () => {
      if (Platform.OS === 'web') {
        const hash = globalThis.location?.hash ?? ''
        const match = hash.match(/[#&]token=([^&]+)/)
        if (match) {
          const token = decodeURIComponent(match[1])
          setAuthToken(token)
          writeStoredToken(token)
          // Strip the hash so the token isn't left in the URL bar / history.
          globalThis.history?.replaceState(
            null,
            '',
            globalThis.location.pathname + globalThis.location.search,
          )
          if (active) await refresh()
          return
        }
      }
      const stored = await readStoredToken()
      if (stored) setAuthToken(stored)
      if (active) await refresh()
    })()
    return () => {
      active = false
    }
  }, [refresh])

  const patchUser = useCallback((partial: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...partial } : prev))
  }, [])

  const signOut = useCallback(async () => {
    // Server-side revocation is best-effort: a network failure must never
    // leave private data in local caches, so all cleanup runs in finally.
    try {
      await logout()
    } catch {
      // ignore — proceed to local cleanup regardless.
    } finally {
      writeStoredToken(null)
      setAuthToken(null)
      // Purge cached taste + tag data + photos so the next account starts clean.
      await clearPersistedTastes()
      setTastesUser(null)
      clearTagsCache()
      try {
        await Promise.all([Image.clearDiskCache(), Image.clearMemoryCache()])
      } catch {
        // best-effort — cache clearing must never block sign-out.
      }
      setUser(null)
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, providers, loading, refresh, signOut, patchUser }),
    [user, providers, loading, refresh, signOut, patchUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ----------------------------------------------------------------
// Hook
// ----------------------------------------------------------------

/** Returns the auth session + actions. Must be used inside <AuthProvider>. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
