/* ============================================================
   YUMMY OR NOT — useTasters (shared taster persona list, S3b)

   Module-level cache + subscriber pattern mirroring _useTags. GET /api/tasters
   is called once per account; invalidateTasters() forces a refetch after a
   create/rename/delete. setTastersUser() must be called on sign-in/sign-out so a
   slow pre-logout fetch for account A cannot resolve after switch and publish
   A's personas to account B.
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { getTasters, type Taster } from '@yon/shared'

// ----------------------------------------------------------------
// Module state — shared across every hook consumer.
// ----------------------------------------------------------------

let cache: Taster[] | null = null
let inFlight: Promise<Taster[]> | null = null
/** Bumped by setTastersUser() and invalidateTasters() so an in-flight fetch
 *  that resolves after the bump is discarded. */
let epoch = 0

type Listener = (items: Taster[]) => void
const listeners = new Set<Listener>()

function emit(items: Taster[]): void {
  for (const l of listeners) l(items)
}

function revalidate(): Promise<Taster[]> {
  if (inFlight) return inFlight
  const capturedEpoch = epoch
  inFlight = getTasters()
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

/** Point the cache at a (new) account and clear prior state. Call on sign-in /
 *  sign-out so personas never leak across accounts. */
export function setTastersUser(_id: string | null): void {
  cache = null
  inFlight = null
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

// ----------------------------------------------------------------
// Hook
// ----------------------------------------------------------------

interface UseTasters {
  tasters: Taster[]
  loading: boolean
}

/** Subscribe to the account's taster personas. Paints the in-memory cache
 *  immediately if warm; otherwise fetches once. */
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

  return { tasters, loading }
}
