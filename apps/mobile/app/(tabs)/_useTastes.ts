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

   Race-safety:
   • Epoch counter: bumped by setTastesUser() and invalidateTastes().
     Every async completion captures the epoch at start; if the epoch
     has advanced by the time it resolves the result is discarded.
     Covers: slow cross-account fetch, pre-mutation fetch overwriting
     post-mutation data, concurrent cold-start hydration.
   • Serialized per-key write chain: all AsyncStorage setItem/removeItem
     calls for the same key are chained through a promise so they execute
     in order.  A setItem re-checks epoch+key immediately before the
     actual write and becomes a no-op if either has changed — preventing
     a delayed setItem from resurrecting data that a removeItem already
     erased.
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
/**
 * Epoch counter — incremented by setTastesUser() and invalidateTastes().
 * Every async completion must re-check the epoch it captured at start and
 * silently discard if it no longer matches.
 */
let epoch = 0

type Listener = (items: Taste[]) => void
const listeners = new Set<Listener>()

const STORAGE_PREFIX = 'yon_tastes:'

function storageKey(): string {
  return `${STORAGE_PREFIX}${userId ?? 'anon'}`
}

function emit(items: Taste[]): void {
  for (const l of listeners) l(items)
}

// ----------------------------------------------------------------
// Serialized per-key AsyncStorage write chain (finding: stale write resurrection)
//
// All setItem and removeItem calls for a given storage key are chained
// through this map so they execute in arrival order.  A queued setItem
// re-checks the epoch+key pair immediately before the actual write; if
// either has changed (epoch advanced by invalidate/user-switch, or key
// changed by user-switch) the write is skipped and becomes a no-op.
// This prevents a slow setItem from resurrecting data that a subsequent
// removeItem already erased.
// ----------------------------------------------------------------

const pendingWrites = new Map<string, Promise<void>>()

/**
 * Append work to the serialized write chain for `key`.
 * `work` receives no arguments — capture everything it needs in its closure.
 * The chain never throws (errors are swallowed) so every appended item runs.
 */
function enqueueWrite(key: string, work: () => Promise<void>): Promise<void> {
  const prev = pendingWrites.get(key) ?? Promise.resolve()
  const next = prev.then(work).catch(() => {
    // best-effort — swallow so the chain never stalls.
  })
  pendingWrites.set(key, next)
  return next
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

/**
 * Enqueue a best-effort persist of `items` under `key`.
 * The write is a no-op if `capturedEpoch` no longer matches the current
 * epoch or if `key` is no longer the active storage key for this user —
 * both checks happen immediately before the actual setItem so no stale
 * write can land after a removeItem.
 */
function writePersisted(
  items: Taste[],
  key: string,
  capturedEpoch: number,
): void {
  void enqueueWrite(key, async () => {
    // Re-check epoch and key at write time, not at enqueue time.
    if (epoch !== capturedEpoch || storageKey() !== key) return
    await AsyncStorage.setItem(key, JSON.stringify(items))
  })
}

/**
 * Enqueue a removal of `key` from AsyncStorage.
 * Joining the same per-key chain ensures this runs after any already-queued
 * setItem for the same key, so the removal always wins.
 */
function removePersistedKey(key: string): Promise<void> {
  return enqueueWrite(key, async () => {
    await AsyncStorage.removeItem(key)
  })
}

/**
 * Fetch from the network, deduping concurrent callers. Updates cache,
 * notifies subscribers, and writes through to AsyncStorage.
 * The result is ONLY committed when the epoch at call-time still matches
 * the current epoch, preventing stale fetches from overwriting fresh data.
 */
function revalidate(): Promise<Taste[]> {
  if (inFlight) return inFlight
  const capturedEpoch = epoch
  const capturedKey = storageKey()
  inFlight = listTastes()
    .then((data) => {
      if (epoch !== capturedEpoch) return data // epoch changed — discard
      cache = data
      emit(data)
      writePersisted(data, capturedKey, capturedEpoch)
      return data
    })
    .finally(() => {
      if (epoch === capturedEpoch) inFlight = null
    })
  return inFlight
}

// ----------------------------------------------------------------
// Public module API
// ----------------------------------------------------------------

/**
 * Drop the cache and refetch. Call after a create/update/delete so every
 * mounted view reflects the change. Returns the fresh list.
 * Bumps the epoch so any previously-issued in-flight fetch cannot
 * overwrite the result of the new one.
 */
export function invalidateTastes(): Promise<Taste[]> {
  cache = null
  hydrated = false
  epoch++
  inFlight = null
  return revalidate()
}

/** Synchronous read-only lookup into the shared in-memory cache. */
export function getCachedTaste(id: string): Taste | undefined {
  return cache?.find((t) => t.id === id)
}

/**
 * Point the cache at a (new) user and clear any prior in-memory state.
 * Called by AuthProvider on sign-in / sign-out so the namespaced storage
 * key and cache never leak across accounts.
 * Bumps the epoch so any in-flight fetch for the previous user is
 * discarded. Immediately emits [] to all mounted subscribers so they
 * clear the previous account's items without waiting for a fetch.
 */
export function setTastesUser(id: string | null): void {
  if (id === userId) return
  userId = id
  cache = null
  hydrated = false
  epoch++
  inFlight = null
  // Notify every mounted view to clear immediately — they must not show a
  // prior account's data while the new account's fetch is in flight.
  emit([])
}

/** Remove the persisted list for the current user (logout cleanup). */
export async function clearPersistedTastes(): Promise<void> {
  const key = storageKey()
  cache = null
  hydrated = false
  epoch++
  inFlight = null
  // Join the per-key write chain so the removal runs after any queued
  // setItem for this key — the removal always lands last.
  await removePersistedKey(key)
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
      const capturedEpoch = epoch
      ;(async () => {
        if (!hydrated && epoch === capturedEpoch) {
          hydrated = true
          const persisted = await readPersisted()
          // Guard: epoch may have advanced while AsyncStorage was reading.
          if (persisted && cache === null && epoch === capturedEpoch) {
            cache = persisted
            // Emit to ALL subscribers so concurrent cold-start views all get
            // the persisted snapshot, not just the hook that won the race.
            emit(persisted)
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
