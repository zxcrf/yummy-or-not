/* ============================================================
   YUMMY OR NOT — useTasters (shared taster persona list, S3b)

   Module-level cache + subscriber pattern mirroring _useTastes. Three layers:

     1. Module-level in-memory cache + in-flight dedupe — many views mounting
        at once trigger exactly one getTasters() call.
     2. AsyncStorage stale-while-revalidate — cold start paints the persisted
        persona list immediately (so the top-right taster avatar and the
        family sheet show instantly instead of flashing '?' until the network
        returns), then revalidates and writes the fresh result back.
     3. A subscriber set so invalidateTasters() (after a create/rename/delete)
        refetches and every mounted view updates.

   The storage key is namespaced by account id (yon_tasters:<userId>) so a
   different account can never read another account's personas. setTastersUser()
   is called by AuthProvider on sign-in/sign-out; it no-ops on a repeated
   same-account call (mirrors setTastesUser) so the background session
   revalidate cannot wipe a freshly-fetched list.

   Race-safety: an epoch counter (bumped by setTastersUser / invalidateTasters /
   clearPersistedTasters) is captured at the start of every async op; if it has
   advanced by the time the op resolves the result is discarded, and persisted
   writes re-check epoch+key immediately before committing.
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getTasters, type Taster } from '@yon/shared'
import { getActiveTaster, setActiveTaster } from './_useActiveTaster'

// ----------------------------------------------------------------
// Module state — shared across every hook consumer.
// ----------------------------------------------------------------

let cache: Taster[] | null = null
let inFlight: Promise<Taster[]> | null = null
/** Current account id scoping the cache + storage key (null when signed out).
 *  Lets setTastersUser() no-op on a repeated same-account call so a background
 *  session revalidate cannot wipe a freshly-fetched persona list. */
let userId: string | null = null
/** True once a cold-start AsyncStorage hydration has been attempted for the
 *  current account, so it runs at most once per account. */
let hydrated = false
/** Bumped by setTastersUser() / invalidateTasters() / clearPersistedTasters()
 *  so an in-flight fetch or persisted write that resolves after the bump is
 *  discarded. */
let epoch = 0

type Listener = (items: Taster[]) => void
const listeners = new Set<Listener>()

const STORAGE_PREFIX = 'yon_tasters:'

function storageKey(): string {
  return `${STORAGE_PREFIX}${userId ?? 'anon'}`
}

/** Notify subscribers only (no active-taster reconciliation). */
function notify(items: Taster[]): void {
  for (const l of listeners) l(items)
}

/** Notify subscribers AND reconcile the active taster against the list. */
function emit(items: Taster[]): void {
  notify(items)
  reconcileActiveTaster(items)
}

/** If the persisted active-taster id no longer appears in the current taster
 *  list (e.g. deleted from another session or another device), reset to the
 *  self default so the next new-taste POST does not carry a dangling id that
 *  the server rejects as `invalid_taster`.
 *
 *  _useActiveTaster does not import _useTasters, so the dependency is
 *  one-directional — no circular module reference. */
function reconcileActiveTaster(items: Taster[]): void {
  const currentActive = getActiveTaster()
  if (currentActive === null) return // already on self — nothing to do
  const stillPresent = items.some((t) => !t.isSelf && t.id === currentActive)
  if (!stillPresent) {
    void setActiveTaster(null)
  }
}

/** Best-effort read of the persisted persona list for the current account. */
async function readPersisted(): Promise<Taster[] | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey())
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Taster[]) : null
  } catch {
    return null
  }
}

/** Best-effort persist of `items` under `key`. No-ops if the epoch advanced or
 *  the active key changed before the write commits (account switch / logout). */
function writePersisted(items: Taster[], key: string, capturedEpoch: number): void {
  void (async () => {
    try {
      if (epoch !== capturedEpoch || storageKey() !== key) return
      await AsyncStorage.setItem(key, JSON.stringify(items))
    } catch {
      // best-effort — persistence is an optimization.
    }
  })()
}

function revalidate(): Promise<Taster[]> {
  if (inFlight) return inFlight
  const capturedEpoch = epoch
  const capturedKey = storageKey()
  inFlight = getTasters()
    .then((data) => {
      if (epoch !== capturedEpoch) return data // epoch advanced — discard
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

/** Point the cache at a (new) account and clear prior in-memory state. Call on
 *  sign-in / sign-out so personas never leak across accounts.
 *
 *  No-ops when the account is unchanged (mirrors setTastesUser) so the
 *  background session revalidate — which re-applies the same account after the
 *  optimistic cold-start scope — cannot wipe a freshly-fetched persona list.
 *  The persisted list is left on disk (namespaced by account) so the next cold
 *  start can paint it instantly; logout purges it via clearPersistedTasters(). */
export function setTastersUser(id: string | null): void {
  if (id === userId) return
  userId = id
  cache = null
  inFlight = null
  hydrated = false
  epoch++
  emit([])
}

/** Drop the cache and refetch. Call after a taster create/rename/delete. */
export function invalidateTasters(): void {
  cache = null
  inFlight = null
  epoch++
  void revalidate()
}

/** Logout cleanup: clear in-memory state AND remove the persisted persona list
 *  for the current account so it cannot paint after sign-out. */
export async function clearPersistedTasters(): Promise<void> {
  const key = storageKey()
  cache = null
  inFlight = null
  hydrated = false
  userId = null
  epoch++
  emit([])
  try {
    await AsyncStorage.removeItem(key)
  } catch {
    // best-effort
  }
}

// ----------------------------------------------------------------
// Hook
// ----------------------------------------------------------------

interface UseTasters {
  tasters: Taster[]
  loading: boolean
}

/** Subscribe to the account's taster personas with stale-while-revalidate:
 *  paints the in-memory cache (or persisted snapshot) immediately, then
 *  revalidates in the background. */
export function useTasters(): UseTasters {
  const [tasters, setTasters] = useState<Taster[]>(() => cache ?? [])
  const [loading, setLoading] = useState(() => cache === null)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const listener: Listener = (next) => {
      if (mounted.current) {
        setTasters(next)
        setLoading(false)
      }
    }
    listeners.add(listener)

    if (cache !== null) {
      setTasters(cache)
      setLoading(false)
      void revalidate()
    } else {
      // Cold start. Kick off the network revalidate immediately (don't delay it
      // behind the disk read) and, concurrently, paint the persisted snapshot
      // if it arrives before the network and nothing else has populated the
      // cache yet.
      const capturedEpoch = epoch
      revalidate().catch(() => {
        if (mounted.current) setLoading(false)
      })
      if (!hydrated) {
        hydrated = true
        void (async () => {
          const persisted = await readPersisted()
          // Guards: the network may have won the race (cache set), or the
          // account may have switched while AsyncStorage was reading.
          if (persisted && cache === null && epoch === capturedEpoch) {
            cache = persisted
            // Paint the persisted list WITHOUT reconciling the active taster —
            // a stale snapshot must not reset a valid selection; the fresh
            // network result reconciles when revalidate() resolves.
            notify(persisted)
          }
        })()
      }
    }

    return () => {
      mounted.current = false
      listeners.delete(listener)
    }
  }, [])

  return { tasters, loading }
}
