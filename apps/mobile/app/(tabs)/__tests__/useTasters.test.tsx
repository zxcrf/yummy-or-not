/* ============================================================
   Unit tests — shared useTasters source (app/(tabs)/_useTasters).

   This is the SINGLE source TasterManageView mutates against AND
   TasterSwitcher subscribes to. The management UI's "refresh after a
   mutation" contract is `invalidateTasters()` → the cache refetches via
   getTasters() and emits the new list to every mounted subscriber. The
   component tests mock this module, so they only prove the call happens;
   THIS test proves the call actually causes a refetch + emit — i.e. that
   a mounted TasterSwitcher-shaped subscriber observes the post-mutation
   personas without a second source of truth.

   Also pins MED-2 reconciliation: if the active taster id is absent from
   the refetched list (deleted from another session), setActiveTaster(null)
   is called to reset to the self default.

   getTasters is mocked; module-level cache is reset between tests via
   setTastersUser so each case starts cold.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import type { Taster } from '@yon/shared'
import { invalidateTasters, setTastersUser, useTasters } from '../_useTasters'

const mockGetTasters = jest.fn<Promise<Taster[]>, []>()
jest.mock('@yon/shared', () => ({
  getTasters: (...args: []) => mockGetTasters(...args),
}))

// _useTasters now imports getActiveTaster + setActiveTaster for reconciliation.
// Mock the module so tests can control the perceived active id and assert
// setActiveTaster calls without AsyncStorage side effects.
const mockGetActiveTaster = jest.fn<string | null, []>()
const mockSetActiveTaster = jest.fn<Promise<void>, [string | null]>()
jest.mock('../_useActiveTaster', () => ({
  getActiveTaster: () => mockGetActiveTaster(),
  setActiveTaster: (id: string | null) => mockSetActiveTaster(id),
  // Hook + other exports used by other consumers — stub so they don't break.
  useActiveTaster: () => null,
  setActiveTasterUser: jest.fn(),
  clearActiveTaster: jest.fn(),
}))

function taster(id: string, displayName = id, isSelf = false): Taster {
  return {
    id,
    ownerAccountId: 'u1',
    familyId: null,
    displayName,
    avatar: '',
    isSelf,
    createdAt: '2026-06-08T00:00:00.000Z',
  }
}

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

afterEach(() => {
  act(() => {
    mountedRenderers.forEach((r) => r.unmount())
  })
  mountedRenderers.length = 0
})

/** Mount a subscriber that records every tasters value the hook yields —
 *  stands in for a mounted TasterSwitcher. */
async function mountSubscriber() {
  const seen: Taster[][] = []
  function Probe() {
    const { tasters } = useTasters()
    seen.push(tasters)
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<Probe />)
  })
  mountedRenderers.push(renderer)
  return seen
}

const flush = () =>
  act(async () => {
    await Promise.resolve()
  })

beforeEach(async () => {
  mockGetTasters.mockReset()
  mockGetActiveTaster.mockReset()
  mockSetActiveTaster.mockReset()
  // Default: no active taster (self). Individual tests override as needed.
  mockGetActiveTaster.mockReturnValue(null)
  mockSetActiveTaster.mockResolvedValue(undefined)
  // Reset module-level cache so each test starts cold.
  await act(async () => {
    setTastersUser('__reset__')
    setTastersUser(null)
  })
})

describe('useTasters — invalidateTasters refetches and emits to subscribers', () => {
  it('a mounted subscriber sees the new persona list after a mutation invalidate', async () => {
    // First fetch: only the self-taster.
    mockGetTasters.mockResolvedValueOnce([taster('t-self', 'Me', true)])

    const seen = await mountSubscriber()
    await flush()

    // Subscriber painted the initial list.
    expect(mockGetTasters).toHaveBeenCalledTimes(1)
    expect(seen[seen.length - 1].map((t) => t.id)).toEqual(['t-self'])

    // A create just happened; the new fetch returns self + the new persona.
    mockGetTasters.mockResolvedValueOnce([
      taster('t-self', 'Me', true),
      taster('t-partner', 'Partner'),
    ])

    await act(async () => {
      invalidateTasters()
    })
    await flush()

    // The refetch fired AND the already-mounted subscriber observed the new
    // persona — proving TasterSwitcher updates from the same source.
    expect(mockGetTasters).toHaveBeenCalledTimes(2)
    expect(seen[seen.length - 1].map((t) => t.id)).toEqual(['t-self', 't-partner'])
  })
})

describe('useTasters — active-taster reconciliation (MED-2)', () => {
  it('resets active taster to null when its id is absent from the refetched list', async () => {
    // Active taster is 't-partner', which exists in the first fetch.
    mockGetActiveTaster.mockReturnValue('t-partner')
    mockGetTasters.mockResolvedValueOnce([
      taster('t-self', 'Me', true),
      taster('t-partner', 'Partner'),
    ])
    await mountSubscriber()
    await flush()

    // Another session deleted 't-partner'; invalidate brings back only self.
    mockGetTasters.mockResolvedValueOnce([taster('t-self', 'Me', true)])
    await act(async () => {
      invalidateTasters()
    })
    await flush()

    // The active id is no longer in the list → must reset to self default.
    expect(mockSetActiveTaster).toHaveBeenCalledWith(null)
  })

  it('does NOT reset active taster when the id is still present after refetch', async () => {
    // Active taster is 't-partner', which remains after refetch.
    mockGetActiveTaster.mockReturnValue('t-partner')
    mockGetTasters.mockResolvedValueOnce([
      taster('t-self', 'Me', true),
      taster('t-partner', 'Partner'),
    ])
    await mountSubscriber()
    await flush()

    // Invalidate: list unchanged (e.g. a rename, not a delete).
    mockGetTasters.mockResolvedValueOnce([
      taster('t-self', 'Me', true),
      taster('t-partner', 'Partner renamed'),
    ])
    await act(async () => {
      invalidateTasters()
    })
    await flush()

    // Active id still present — must NOT reset.
    expect(mockSetActiveTaster).not.toHaveBeenCalled()
  })

  it('does NOT reset when active is already null (self default)', async () => {
    mockGetActiveTaster.mockReturnValue(null)
    mockGetTasters.mockResolvedValueOnce([taster('t-self', 'Me', true)])
    await mountSubscriber()
    await flush()

    mockGetTasters.mockResolvedValueOnce([taster('t-self', 'Me', true)])
    await act(async () => {
      invalidateTasters()
    })
    await flush()

    expect(mockSetActiveTaster).not.toHaveBeenCalled()
  })
})
