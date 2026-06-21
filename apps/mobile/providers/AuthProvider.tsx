/* ============================================================
   YUMMY OR NOT — AuthProvider (React Native, mobile-only)
   Holds the signed-in session and persists the bearer token across
   launches. The shared api-client keeps the token in module memory and
   sets it on a successful login/verify/register; this provider's job is
   to (a) reload that token on startup, (b) capture a freshly-issued one
   after refresh(), and (c) clear it on sign-out.

   Token persistence uses expo-secure-store only. Storage key: `yon_token`.

   Cold-start optimization (口味 snapshot):
   Previously the app blocked on a full splash until getMe() resolved
   (~2s over the network) before painting anything. Now, when a stored
   token AND a persisted session snapshot both exist, we OPTIMISTICALLY
   paint the signed-in app from cache immediately (loading → false within
   a frame) and revalidate getMe() in the background. The home page
   (LibraryView) likewise hydrates its own persisted taste list, so the
   user sees their last-known 口味 right away while the latest data syncs.

   Snapshot safety:
   • The user/providers snapshot is persisted in AsyncStorage (key
     `yon_user`) on every successful refresh, and removed on sign-out /
     signed-out revalidate.
   • A background revalidate only tears down the optimistic session on a
     DEFINITIVE auth rejection (401/403) or an explicit signed-out
     response (user: null). A transient failure (offline, 5xx) keeps the
     cached session so going offline doesn't bounce the user to login.
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
import AsyncStorage from '@react-native-async-storage/async-storage'
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
import { setTastersUser } from '@/app/(tabs)/_useTasters'
import { setActiveTasterUser, clearActiveTaster } from '@/app/(tabs)/_useActiveTaster'

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

/** Read the persisted token (or null). */
async function readStoredToken(): Promise<string | null> {
  try {
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
    // Use require() so jest moduleNameMapper can intercept it (dynamic
    // import() bypasses the mapper and requires --experimental-vm-modules).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store')
    if (token) {
      void SecureStore.setItemAsync(STORAGE_KEY, token)
    }
    // Writes are fire-and-forget (best-effort). Deletions must be awaited via
    // deleteStoredToken() so a fast app-kill after sign-out can't restore the
    // old token on next launch.
  } catch {
    // ignore — persistence is best-effort.
  }
}

/** Await deletion of the persisted token. Throws only if SecureStore is unavailable. */
async function deleteStoredToken(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store')
    await SecureStore.deleteItemAsync(STORAGE_KEY)
  } catch {
    // ignore — if SecureStore is unavailable the token will be gone on next
    // launch when readStoredToken() returns null.
  }
}

// ----------------------------------------------------------------
// Session snapshot — the user + providers persisted in AsyncStorage so the
// app can paint the signed-in UI on cold start before getMe() returns.
// Non-secret (it's the user's own profile, scoped to this device and cleared
// on sign-out); the bearer token stays in SecureStore.
// ----------------------------------------------------------------

const USER_KEY = 'yon_user'

interface SessionSnapshot {
  user: User
  providers: ProviderStatus[]
}

/** Read the persisted session snapshot (or null). Best-effort. */
async function readStoredSession(): Promise<SessionSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SessionSnapshot> | null
    // Only trust a snapshot that carries a concrete user id — the id scopes
    // every per-account cache, so a malformed snapshot must not be used.
    if (parsed && parsed.user && typeof parsed.user.id === 'string') {
      return {
        user: parsed.user as User,
        providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      }
    }
    return null
  } catch {
    return null
  }
}

/** Persist the session snapshot. Best-effort, fire-and-forget. */
function writeStoredSession(snapshot: SessionSnapshot): void {
  void AsyncStorage.setItem(USER_KEY, JSON.stringify(snapshot)).catch(() => {
    // ignore — the snapshot is an optimization, not a source of truth.
  })
}

/** Remove the persisted session snapshot (sign-out / signed-out revalidate). */
function clearStoredSession(): void {
  void AsyncStorage.removeItem(USER_KEY).catch(() => {
    // ignore — best-effort.
  })
}

/**
 * Whether a getMe() rejection is a DEFINITIVE auth failure (the token is bad
 * or forbidden) versus a transient one (offline, server 5xx). apiFetch throws
 * Error('http_<status>') for non-2xx, or a fetch TypeError on network failure.
 * Only a 401/403 means "this session is no longer valid" — everything else is
 * treated as transient so a flaky network never bounces a signed-in user to
 * the login screen during an optimistic cold start.
 */
function isAuthError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : ''
  return msg === 'http_401' || msg === 'http_403'
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

  /**
   * Apply a resolved session to React state + scope every per-account cache to
   * the user. Must run before any view reads those caches so the namespaced
   * storage keys (and emitted clears) point at the right account.
   */
  const applySession = useCallback(
    (nextUser: User | null, nextProviders: ProviderStatus[]) => {
      setTastesUser(nextUser?.id ?? null)
      setTagsUser(nextUser?.id ?? null)
      setTastersUser(nextUser?.id ?? null)
      setActiveTasterUser(nextUser?.id ?? null)
      setUser(nextUser)
      setProviders(nextProviders)
    },
    [],
  )

  const refresh = useCallback(
    async (opts?: { background?: boolean }) => {
      try {
        const { user, providers } = await getMe()
        applySession(user, providers)
        // Capture the token a just-completed login put in memory.
        writeStoredToken(getAuthToken())
        // Keep the cold-start snapshot in sync with the latest session.
        if (user) writeStoredSession({ user, providers })
        else clearStoredSession()
      } catch (e) {
        // A background revalidate runs while an optimistic (cached) session is
        // already painted. A transient failure must NOT tear it down — only a
        // definitive auth rejection signs the user out. A foreground refresh
        // (no cached session on screen) clears on any failure as before.
        if (opts?.background && !isAuthError(e)) return
        applySession(null, [])
        clearStoredSession()
      } finally {
        setLoading(false)
      }
    },
    [applySession],
  )

  // Bootstrap: load the persisted token, then either paint optimistically from
  // the cached snapshot (revalidating in the background) or block on getMe().
  useEffect(() => {
    let active = true
    ;(async () => {
      const stored = await readStoredToken()
      if (!stored) {
        // No token → definitely signed out; resolve the gate immediately.
        if (active) await refresh()
        return
      }
      setAuthToken(stored)
      // Optimistic cold start: paint the last-known session right away and
      // revalidate quietly. Skips the ~2s splash so the home page (and its
      // persisted 口味 list) appear within a frame.
      const snapshot = await readStoredSession()
      if (!active) return
      if (snapshot) {
        applySession(snapshot.user, snapshot.providers)
        setLoading(false)
        void refresh({ background: true })
        return
      }
      // Token but no snapshot (first launch after login, or a client upgraded
      // before snapshots existed) → fall back to the blocking refresh.
      await refresh()
    })()
    return () => {
      active = false
    }
  }, [refresh, applySession])

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
      // Await the deletion so a fast app-kill after sign-out cannot restore
      // the old token on next launch (fire-and-forget deletion race).
      await deleteStoredToken()
      setAuthToken(null)
      // Drop the cold-start session snapshot so the next launch can't paint
      // this account's profile optimistically after sign-out.
      clearStoredSession()
      // Purge cached taste + tag data + photos so the next account starts clean.
      await clearPersistedTastes()
      setTastesUser(null)
      clearTagsCache()
      setTastersUser(null)
      await clearActiveTaster()
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
