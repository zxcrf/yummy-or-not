/* ============================================================
   YUMMY OR NOT — useTags (shared tag candidate set)
   Module-level cache + subscriber pattern mirroring _useTastes. Three layers:

     1. In-memory cache + in-flight dedupe — one getTags() per account.
     2. AsyncStorage stale-while-revalidate — cold start paints the persisted
        tag set immediately (so the library's tag filter shows the user's
        chips instead of only "全部" until the network returns), then
        revalidates and writes the fresh result back.
     3. A subscriber set so invalidateTagsCache() (after a tag
        create/delete/rename) refetches and every mounted view updates.

   The storage key is namespaced by account id (yon_tags:<userId>) so a
   different account can never read another account's tags. setTagsUser() must
   be called on sign-in/sign-out; it no-ops on a repeated same-account call
   (mirrors setTastesUser) so the background session revalidate cannot wipe a
   freshly-fetched list.
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getTags, type UserTag } from '@yon/shared'

// ----------------------------------------------------------------
// Module state — shared across every hook consumer.
// ----------------------------------------------------------------

let cache: UserTag[] | null = null
let inFlight: Promise<UserTag[]> | null = null
/** Current account id scoping the cache + storage key (null when signed out).
 *  Lets setTagsUser() no-op on a repeated same-account call so a background
 *  session revalidate cannot wipe a freshly-fetched list. */
let userId: string | null = null
/** True once a cold-start AsyncStorage hydration has been attempted for the
 *  current account, so it runs at most once per account. */
let hydrated = false
/** Epoch — bumped by setTagsUser() / invalidateTagsCache() / clearTagsCache()
 *  so any in-flight fetch or persisted write that resolves after the bump is
 *  discarded. */
let epoch = 0

type Listener = (items: UserTag[]) => void
const listeners = new Set<Listener>()

const STORAGE_PREFIX = 'yon_tags:'

function storageKey(): string {
  return `${STORAGE_PREFIX}${userId ?? 'anon'}`
}

function emit(items: UserTag[]): void {
  for (const l of listeners) l(items)
}

/** Best-effort read of the persisted tag set for the current account. */
async function readPersisted(): Promise<UserTag[] | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey())
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as UserTag[]) : null
  } catch {
    return null
  }
}

/** Best-effort persist of `items` under `key`. No-ops if the epoch advanced or
 *  the active key changed before the write commits (account switch / logout). */
function writePersisted(items: UserTag[], key: string, capturedEpoch: number): void {
  void (async () => {
    try {
      if (epoch !== capturedEpoch || storageKey() !== key) return
      await AsyncStorage.setItem(key, JSON.stringify(items))
    } catch {
      // best-effort — persistence is an optimization.
    }
  })()
}

function revalidate(): Promise<UserTag[]> {
  if (inFlight) return inFlight
  const capturedEpoch = epoch
  const capturedKey = storageKey()
  inFlight = getTags()
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

/**
 * Point the cache at a (new) user and clear any prior in-memory state.
 * Call on sign-in and sign-out so the cache never leaks across accounts.
 * Bumps the epoch so any in-flight fetch for the previous user is discarded.
 * Immediately emits [] so mounted views clear the previous account's tags.
 *
 * No-ops when the account is unchanged (mirrors setTastesUser): the optimistic
 * cold start scopes the cache once from the persisted session, then the
 * background getMe() revalidate re-applies the SAME account — without this
 * guard that second call would clear the just-fetched tags and emit [],
 * leaving the library's tag filter blank until a manual refetch.
 *
 * The persisted set is left on disk (namespaced by account) so the next cold
 * start can paint it instantly; logout purges it via clearTagsCache().
 */
export function setTagsUser(id: string | null): void {
  if (id === userId) return
  userId = id
  cache = null
  inFlight = null
  hydrated = false
  epoch++
  emit([])
}

/** Drop the cache and refetch. Call after a tag create/delete/rename. */
export function invalidateTagsCache(): void {
  cache = null
  inFlight = null
  epoch++
  void revalidate()
}

/** Clear module state on sign-out so the next user starts fresh: drops the
 *  in-memory cache AND removes the persisted tag set for the current account
 *  so it cannot paint after sign-out. */
export function clearTagsCache(): void {
  const key = storageKey()
  cache = null
  inFlight = null
  hydrated = false
  userId = null
  epoch++
  emit([])
  // Fire-and-forget — privacy cleanup of a non-critical optimization cache.
  void AsyncStorage.removeItem(key).catch(() => {})
}

// ----------------------------------------------------------------
// Hook
// ----------------------------------------------------------------

interface UseTags {
  tags: UserTag[]
  loading: boolean
}

/** Subscribe to the user's tag candidate set with stale-while-revalidate:
 *  paints the in-memory cache (or persisted snapshot) immediately, then
 *  revalidates in the background. */
export function useTags(): UseTags {
  const [tags, setTags] = useState<UserTag[]>(() => cache ?? [])
  const [loading, setLoading] = useState(() => cache === null)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const listener: Listener = (next) => {
      if (mounted.current) {
        setTags(next)
        setLoading(false)
      }
    }
    listeners.add(listener)

    if (cache !== null) {
      setTags(cache)
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
            emit(persisted)
          }
        })()
      }
    }

    return () => {
      mounted.current = false
      listeners.delete(listener)
    }
  }, [])

  return { tags, loading }
}
