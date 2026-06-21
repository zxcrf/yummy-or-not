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
import { getActiveTaster, setActiveTaster } from './_useActiveTaster'

// ----------------------------------------------------------------
// Module state — shared across every hook consumer.
// ----------------------------------------------------------------

let cache: Taster[] | null = null
let inFlight: Promise<Taster[]> | null = null
/** Current account id scoping the cache (null when signed out). Lets
 *  setTastersUser() no-op on a repeated same-account call so a background
 *  session revalidate cannot wipe a freshly-fetched persona list. */
let userId: string | null = null
/** Bumped by setTastersUser() and invalidateTasters() so an in-flight fetch
 *  that resolves after the bump is discarded. */
let epoch = 0

type Listener = (items: Taster[]) => void
const listeners = new Set<Listener>()

function emit(items: Taster[]): void {
  for (const l of listeners) l(items)
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
 *  sign-out so personas never leak across accounts.
 *
 *  No-ops when the account is unchanged (mirrors setTastesUser) so the
 *  background session revalidate — which re-applies the same account after the
 *  optimistic cold-start scope — cannot wipe a freshly-fetched persona list. */
export function setTastersUser(id: string | null): void {
  if (id === userId) return
  userId = id
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
