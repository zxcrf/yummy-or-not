/* ============================================================
   YUMMY OR NOT — useTastes (shared SWR data source)
   Single source of truth for the taste list across every surface
   (Library, Recall, Stats, You). Three layers:

     1. Module-level in-memory cache + in-flight dedupe — many views
        mounting at once trigger exactly one listTastes() network call.
     2. AsyncStorage stale-while-revalidate — cold start paints the
        persisted list immediately, then revalidates in the background
        and writes the fresh result back.
     3. A subscriber set so a write (create/update/delete) anywhere can
        call invalidateTastes() and every mounted view refetches.

   The persisted image URL fields are volatile (the presigned query
   rotates every request). Components rely on expo-image's stable
   cacheKey (Taste.imageKey) to hit the on-disk cache; a cache MISS on a
   rotated URL simply heals on the next revalidate, with a placeholder
   covering the gap.

   The storage key is namespaced by user id so switching accounts never
   shows another user's list. setTastesUser() is called by AuthProvider.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { listTastes, type Taste } from '@yon/shared'

// ----------------------------------------------------------------
// Module state — shared across every hook consumer.
// ----------------------------------------------------------------

let cache: Taste[] | null = null
let inFlight: Promise<Taste[]> | null = null
let hydrated = false
/** Current user id (or null when signed out). Scopes the storage key. */
let userId: string | null = null

type Listener = (items: Taste[]) => void
const listeners = new Set<Listener>()

const STORAGE_PREFIX = 'yon_tastes:'

function storageKey(): string {
  return `${STORAGE_PREFIX}${userId ?? 'anon'}`
}

function emit(items: Taste[]): void {
  for (const l of listeners) l(items)
}

/** Best-effort read of the persisted list for the current user. */
async function readPersisted(): Promise<Taste[] | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey())
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Taste[]) : null
  } catch {
    return null
  }
}

/** Best-effort persist of the list for the current user. */
async function writePersisted(items: Taste[]): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(), JSON.stringify(items))
  } catch {
    // ignore — persistence is best-effort.
  }
}

/** Fetch from the network, deduping concurrent callers. Updates cache,
 *  notifies subscribers, and writes through to AsyncStorage. */
function revalidate(): Promise<Taste[]> {
  if (inFlight) return inFlight
  inFlight = listTastes()
    .then((data) => {
      cache = data
      emit(data)
      void writePersisted(data)
      return data
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

// ----------------------------------------------------------------
// Public module API
// ----------------------------------------------------------------

/** Drop the cache and refetch. Call after a create/update/delete so every
 *  mounted view reflects the change. Returns the fresh list. */
export function invalidateTastes(): Promise<Taste[]> {
  cache = null
  hydrated = false
  inFlight = null
  return revalidate()
}

/** Point the cache at a (new) user and clear any prior in-memory state.
 *  Called by AuthProvider on sign-in / sign-out so the namespaced storage
 *  key and cache never leak across accounts. */
export function setTastesUser(id: string | null): void {
  if (id === userId) return
  userId = id
  cache = null
  hydrated = false
  inFlight = null
}

/** Remove the persisted list for the current user (logout cleanup). */
export async function clearPersistedTastes(): Promise<void> {
  const key = storageKey()
  cache = null
  hydrated = false
  inFlight = null
  try {
    await AsyncStorage.removeItem(key)
  } catch {
    // ignore — best-effort.
  }
}

// ----------------------------------------------------------------
// Hooks
// ----------------------------------------------------------------

interface RefreshableTastes {
  items: Taste[]
  /** True until the first paintable data (cache, persisted, or network). */
  loading: boolean
  /** Force a network revalidate (pull-to-refresh). */
  refresh: () => Promise<void>
}

/**
 * Subscribe to the shared taste list with stale-while-revalidate semantics:
 * paints the in-memory cache (or persisted snapshot) immediately, then
 * revalidates in the background.
 */
export function useRefreshableTastes(): RefreshableTastes {
  const [items, setItems] = useState<Taste[]>(() => cache ?? [])
  const [loading, setLoading] = useState(() => cache === null)
  const mounted = useRef(false)

  const refresh = useCallback(async () => {
    try {
      await revalidate()
    } catch {
      // leave the last-good list in place on failure.
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    const listener: Listener = (next) => {
      if (mounted.current) {
        setItems(next)
        setLoading(false)
      }
    }
    listeners.add(listener)

    // Already have a warm cache → paint it and revalidate quietly.
    if (cache !== null) {
      setItems(cache)
      setLoading(false)
      void revalidate()
    } else {
      // Cold start: hydrate from AsyncStorage first (once), then revalidate.
      ;(async () => {
        if (!hydrated) {
          hydrated = true
          const persisted = await readPersisted()
          if (persisted && cache === null) {
            cache = persisted
            if (mounted.current) {
              setItems(persisted)
              setLoading(false)
            }
          }
        }
        try {
          await revalidate()
        } catch {
          // network failed — keep persisted/empty list; stop the spinner.
          if (mounted.current) setLoading(false)
        }
      })()
    }

    return () => {
      mounted.current = false
      listeners.delete(listener)
    }
  }, [])

  return { items, loading, refresh }
}

/** Returns the current taste list; empty until loaded or on failure. */
export function useTastes(): Taste[] {
  return useRefreshableTastes().items
}
