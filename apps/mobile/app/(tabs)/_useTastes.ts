/* ============================================================
   YUMMY OR NOT — useTastes (route-level data plumbing)
   Fetches the taste list for the route wrappers whose sibling screen
   bodies take `items` as a prop (Stats, You). LibraryView/RecallView
   self-fetch, so they don't use this. Mirrors the LibraryView fetch
   pattern (listTastes → state, empty array on failure).
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { listTastes, type Taste } from '@yon/shared'

interface RefreshableTastes {
  items: Taste[]
  refresh: () => Promise<void>
}

/** Returns the current taste list plus a manual refresh hook. */
export function useRefreshableTastes(): RefreshableTastes {
  const [items, setItems] = useState<Taste[]>([])
  const mounted = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const data = await listTastes()
      if (mounted.current) setItems(data)
    } catch {
      if (mounted.current) setItems([])
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
    }
  }, [refresh])

  return { items, refresh }
}

/** Returns the current taste list; empty until loaded or on failure. */
export function useTastes(): Taste[] {
  return useRefreshableTastes().items
}
