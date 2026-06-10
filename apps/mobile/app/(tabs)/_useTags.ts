/* ============================================================
   YUMMY OR NOT — useTags (shared tag candidate set)
   Module-level cache + subscriber pattern mirroring _useTastes.
   GET /api/tags is called once per user; invalidateTagsCache() forces
   a refetch.  setTagsUser() must be called on sign-in/sign-out (just
   like setTastesUser) so a slow pre-logout fetch for user A cannot
   resolve after account switch and publish A's tags to user B.
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { getTags, type UserTag } from '@yon/shared'

// ----------------------------------------------------------------
// Module state — shared across every hook consumer.
// ----------------------------------------------------------------

let cache: UserTag[] | null = null
let inFlight: Promise<UserTag[]> | null = null
/** Epoch — bumped by setTagsUser() and invalidateTagsCache() so any
 *  in-flight fetch that resolves after the bump is discarded. */
let epoch = 0

type Listener = (items: UserTag[]) => void
const listeners = new Set<Listener>()

function emit(items: UserTag[]): void {
  for (const l of listeners) l(items)
}

function revalidate(): Promise<UserTag[]> {
  if (inFlight) return inFlight
  const capturedEpoch = epoch
  inFlight = getTags()
    .then((data) => {
      if (epoch !== capturedEpoch) return data // epoch advanced — discard
      cache = data
      emit(data)
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
 */
export function setTagsUser(_id: string | null): void {
  cache = null
  inFlight = null
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

/** Clear module state on sign-out so the next user starts fresh.
 *  Prefer setTagsUser(null) when possible — this is for explicit purge
 *  (e.g. logout finally block). */
export function clearTagsCache(): void {
  cache = null
  inFlight = null
  epoch++
  emit([])
}

// ----------------------------------------------------------------
// Hook
// ----------------------------------------------------------------

interface UseTags {
  tags: UserTag[]
  loading: boolean
}

/** Subscribe to the user's tag candidate set.
 *  Paints the in-memory cache immediately if warm; otherwise fetches once. */
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
    } else {
      revalidate().catch(() => {
        if (mounted.current) setLoading(false)
      })
    }

    return () => {
      mounted.current = false
      listeners.delete(listener)
    }
  }, [])

  return { tags, loading }
}
