/* ============================================================
   YUMMY OR NOT — useUserCoords + sortByNearest
   Shared location helpers for the "Nearby" sort used by the Library
   (口味) and To-Try (想吃) lists.

   useUserCoords(enabled): one-shot foreground locate. Only runs while
   `enabled` is true (the caller gates it on the user's locationEnabled
   preference AND the active sort mode), so opening a list never triggers
   a surprise OS permission prompt — the prompt happens when the user
   picks "Nearby". Silent degrade: a denied permission or a slow fix
   (10s timeout) leaves coords null, and the list simply keeps its order.

   sortByNearest(items, coords): pure ranking helper. With coords it sorts
   by haversine distance ascending and tags each item with its distance;
   items missing lat/lng sink to the end with a null distance. Without
   coords it returns the items unchanged with null distances, so callers
   can render the same `{ item, distance }` shape in either case.
   ============================================================ */

import { useEffect, useState } from 'react'
import * as Location from 'expo-location'
import { haversineMeters } from '@yon/shared'

export interface Coords {
  lat: number
  lng: number
}

export interface RankedItem<T> {
  item: T
  /** Metres from the user, or null when distance can't be computed. */
  distance: number | null
}

/**
 * One-shot foreground locate, gated on `enabled`. Returns the user's coords
 * once resolved, or null until then / on any failure. Re-runs when `enabled`
 * flips from false → true (e.g. the user switches to the Nearby sort).
 */
export function useUserCoords(enabled: boolean): Coords | null {
  const [coords, setCoords] = useState<Coords | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ;(async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync()
        if (!perm.granted || cancelled) return
        const posPromise = Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        })
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 10_000)
        })
        try {
          const pos = await Promise.race([posPromise, timeout])
          if (!cancelled) {
            setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
          }
        } finally {
          if (timer) clearTimeout(timer)
        }
      } catch {
        // Silent degrade — no coords, list keeps its non-distance order.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  return coords
}

/** Resolution state of a one-shot locate (for callers that must react to the
 *  *outcome*, not just the coords — e.g. centering a map on entry then falling
 *  back to a default once the locate is known to have failed/been denied). */
export type LocateStatus = 'locating' | 'ready' | 'denied' | 'failed'

export interface LocateResult {
  coords: Coords | null
  status: LocateStatus
}

/**
 * Like {@link useUserCoords} but also surfaces the resolution *status*, so a
 * caller can wait for a real fix before centering and switch to a sensible
 * fallback the moment the locate is denied or fails (instead of waiting on a
 * `null` that never resolves). One-shot, gated on `enabled`.
 *
 *   locating → ready  (got coords)
 *   locating → denied (permission refused)
 *   locating → failed (services off / timeout / error)
 */
export function useLocateResult(enabled: boolean): LocateResult {
  const [result, setResult] = useState<LocateResult>({ coords: null, status: 'locating' })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setResult({ coords: null, status: 'locating' })
    ;(async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync()
        if (cancelled) return
        if (!perm.granted) {
          setResult({ coords: null, status: 'denied' })
          return
        }
        const posPromise = Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        })
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 10_000)
        })
        try {
          const pos = await Promise.race([posPromise, timeout])
          if (!cancelled) {
            setResult({
              coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
              status: 'ready',
            })
          }
        } finally {
          if (timer) clearTimeout(timer)
        }
      } catch {
        if (!cancelled) setResult({ coords: null, status: 'failed' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  return result
}

/**
 * Sort items by distance from `coords` ascending. Items without coordinates
 * are kept (tagged distance: null) and pushed to the end. With no `coords`
 * the original order is preserved and every distance is null.
 */
export function sortByNearest<T extends { lat?: number | null; lng?: number | null }>(
  items: T[],
  coords: Coords | null,
): Array<RankedItem<T>> {
  if (!coords) {
    return items.map((item) => ({ item, distance: null }))
  }
  return items
    .map((item) => ({
      item,
      distance:
        item.lat != null && item.lng != null
          ? haversineMeters(coords.lat, coords.lng, item.lat, item.lng)
          : null,
    }))
    .sort((a, b) => {
      if (a.distance == null && b.distance == null) return 0
      if (a.distance == null) return 1
      if (b.distance == null) return -1
      return a.distance - b.distance
    })
}
