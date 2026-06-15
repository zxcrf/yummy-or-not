/* ============================================================
   Tests — useUserCoords + sortByNearest (Nearby sort plumbing for the
   Library 口味 and To-Try 想吃 lists).

   sortByNearest pins the new distance-sort feature:
   - with coords, items are ordered nearest-first;
   - items missing lat/lng sink to the end with distance null;
   - with no coords, order is preserved and distance is null.

   useUserCoords pins the gated one-shot locate:
   - disabled → never touches expo-location, stays null;
   - granted → resolves to the device coords;
   - cold GPS (fresh fix rejects) → falls back to the OS last-known fix;
   - denied → degrades silently to null;
   - every source empty → degrades silently to null.

   expo-location is mocked; @yon/shared (haversineMeters) is real so the
   distance ordering is exercised for real.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { useUserCoords, sortByNearest } from '../_useUserCoords'

const mockRequestPerm = jest.fn()
const mockGetPosition = jest.fn()
const mockGetLastKnown = jest.fn()

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestPerm(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetPosition(...args),
  getLastKnownPositionAsync: (...args: unknown[]) => mockGetLastKnown(...args),
  Accuracy: { Balanced: 3, High: 4 },
}))

// ---- sortByNearest ------------------------------------------------------

describe('sortByNearest', () => {
  const origin = { lat: 0, lng: 0 }

  it('orders items nearest-first and attaches a distance', () => {
    const far = { id: 'far', lat: 0, lng: 1 }
    const near = { id: 'near', lat: 0, lng: 0.1 }
    const mid = { id: 'mid', lat: 0, lng: 0.5 }

    const ranked = sortByNearest([far, mid, near], origin)
    expect(ranked.map((r) => r.item.id)).toEqual(['near', 'mid', 'far'])
    ranked.forEach((r) => expect(typeof r.distance).toBe('number'))
    expect(ranked[0]!.distance!).toBeLessThan(ranked[1]!.distance!)
  })

  it('pushes items without coordinates to the end with distance null', () => {
    const located = { id: 'located', lat: 0, lng: 0.1 }
    const noCoords = { id: 'no-coords', lat: null, lng: null }

    const ranked = sortByNearest([noCoords, located], origin)
    expect(ranked.map((r) => r.item.id)).toEqual(['located', 'no-coords'])
    expect(ranked[1]!.distance).toBeNull()
  })

  it('preserves order and nulls distance when there are no coords', () => {
    const items = [{ id: 'a', lat: 0, lng: 1 }, { id: 'b', lat: 0, lng: 0.1 }]
    const ranked = sortByNearest(items, null)
    expect(ranked.map((r) => r.item.id)).toEqual(['a', 'b'])
    expect(ranked.every((r) => r.distance === null)).toBe(true)
  })
})

// ---- useUserCoords ------------------------------------------------------

function Harness({ enabled, onValue }: { enabled: boolean; onValue: (v: unknown) => void }) {
  const coords = useUserCoords(enabled)
  onValue(coords)
  return null
}

describe('useUserCoords', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default: no cached fix. Cases that exercise the fallback override this.
    mockGetLastKnown.mockResolvedValue(null)
  })

  it('does not request location while disabled', async () => {
    let latest: unknown = 'unset'
    await act(async () => {
      TestRenderer.create(<Harness enabled={false} onValue={(v) => { latest = v }} />)
    })
    expect(mockRequestPerm).not.toHaveBeenCalled()
    expect(latest).toBeNull()
  })

  it('resolves to device coords when permission is granted', async () => {
    mockRequestPerm.mockResolvedValue({ granted: true })
    mockGetPosition.mockResolvedValue({ coords: { latitude: 1.5, longitude: 2.5 } })

    let latest: unknown = 'unset'
    await act(async () => {
      TestRenderer.create(<Harness enabled onValue={(v) => { latest = v }} />)
    })
    expect(latest).toEqual({ lat: 1.5, lng: 2.5 })
  })

  // Regression (roadmap follow-up #1): on a cold GPS the fresh fix can stall
  // past the timeout. The old hook gave up with null coords, so the Nearby sort
  // silently no-op'd even when the OS had a perfectly good cached position.
  // It must now fall back to the last-known fix. Against the pre-fix hook this
  // FAILS (coords stay null); after the fix it surfaces the cached coords.
  it('falls back to last-known coords when the fresh fix rejects (cold GPS)', async () => {
    mockRequestPerm.mockResolvedValue({ granted: true })
    mockGetPosition.mockRejectedValue(new Error('timeout'))
    mockGetLastKnown.mockResolvedValue({ coords: { latitude: 39.9042, longitude: 116.4074 } })

    let latest: unknown = 'unset'
    await act(async () => {
      TestRenderer.create(<Harness enabled onValue={(v) => { latest = v }} />)
    })
    expect(latest).toEqual({ lat: 39.9042, lng: 116.4074 })
  })

  it('stays null when both the fresh fix and last-known come up empty', async () => {
    mockRequestPerm.mockResolvedValue({ granted: true })
    mockGetPosition.mockRejectedValue(new Error('timeout'))
    mockGetLastKnown.mockResolvedValue(null)

    let latest: unknown = 'unset'
    await act(async () => {
      TestRenderer.create(<Harness enabled onValue={(v) => { latest = v }} />)
    })
    expect(latest).toBeNull()
  })

  it('stays null when permission is denied', async () => {
    mockRequestPerm.mockResolvedValue({ granted: false })

    let latest: unknown = 'unset'
    await act(async () => {
      TestRenderer.create(<Harness enabled onValue={(v) => { latest = v }} />)
    })
    expect(mockGetPosition).not.toHaveBeenCalled()
    expect(mockGetLastKnown).not.toHaveBeenCalled()
    expect(latest).toBeNull()
  })
})
