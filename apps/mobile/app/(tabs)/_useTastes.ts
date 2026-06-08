/* ============================================================
   YUMMY OR NOT — useTastes (route-level data plumbing)
   Fetches the taste list for the route wrappers whose sibling screen
   bodies take `items` as a prop (Stats, You). LibraryView/RecallView
   self-fetch, so they don't use this. Mirrors the LibraryView fetch
   pattern (listTastes → state, empty array on failure).
   ============================================================ */

import { useEffect, useState } from 'react'
import { listTastes, type Taste } from '@yon/shared'

/** Returns the current taste list; empty until loaded or on failure. */
export function useTastes(): Taste[] {
  const [items, setItems] = useState<Taste[]>([])

  useEffect(() => {
    let alive = true
    listTastes()
      .then((data) => {
        if (alive) setItems(data)
      })
      .catch(() => {
        if (alive) setItems([])
      })
    return () => {
      alive = false
    }
  }, [])

  return items
}
