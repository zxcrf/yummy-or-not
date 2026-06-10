/* ============================================================
   Unit tests — shared useTastes SWR hook (app/(tabs)/_useTastes).

   Pins the behavior the caching layer exists for:
   - Cold start paints the AsyncStorage-persisted list before the network
     resolves (stale-while-revalidate), then updates to the fresh list and
     writes it back.
   - invalidateTastes() forces a refetch every mounted view observes.
   - logout cleanup (clearPersistedTastes) drops the persisted key and cache.
   - Concurrent mounts dedupe to a single listTastes() network call.
   - The persisted key is namespaced per user (setTastesUser) so accounts
     never read each other's list.

   listTastes is mocked; AsyncStorage uses the official jest mock (jest.setup).
   Module-level cache state is reset between tests via jest.resetModules so
   each case starts cold.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Taste } from '@yon/shared'
import {
  clearPersistedTastes,
  invalidateTastes,
  setTastesUser,
  useRefreshableTastes,
} from '../_useTastes'

// listTastes is the only network surface; everything else is real.
const mockListTastes = jest.fn<Promise<Taste[]>, []>()
jest.mock('@yon/shared', () => ({
  listTastes: (...args: []) => mockListTastes(...args),
}))

function taste(id: string, name = id): Taste {
  return {
    id,
    name,
    place: '',
    price: '',
    verdict: 'yum',
    tags: [],
    boughtCount: 0,
    date: 'today',
    notes: '',
    image: '',
    imageThumb: '',
    imageDisplay: '',
    imageKey: '',
    createdAt: '2026-06-08T00:00:00.000Z',
  }
}

/** Mount a probe that records every items value the hook yields. */
function mountProbe() {
  const seen: { items: Taste[]; loading: boolean }[] = []
  function Probe() {
    const s = useRefreshableTastes()
    seen.push({ items: s.items, loading: s.loading })
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<Probe />)
  })
  return { seen, renderer }
}

const flush = () => act(async () => { await Promise.resolve() })

beforeEach(async () => {
  mockListTastes.mockReset()
  // Reset the module-level cache (setTastesUser to a sentinel then null clears
  // cache/inFlight/hydrated) and wipe persisted storage so each test is cold.
  setTastesUser('__reset__')
  setTastesUser(null)
  await AsyncStorage.clear()
})

describe('useRefreshableTastes — stale-while-revalidate', () => {
  it('paints the persisted list on cold start, then the revalidated list', async () => {
    setTastesUser('u1')
    // Seed AsyncStorage as if a previous session persisted one record.
    await AsyncStorage.setItem(
      'yon_tastes:u1',
      JSON.stringify([taste('persisted')]),
    )
    // The network is slower than the persisted read: hold it open so the
    // persisted snapshot has to paint first (the whole point of SWR).
    let resolveNet!: (v: Taste[]) => void
    mockListTastes.mockReturnValueOnce(
      new Promise<Taste[]>((r) => {
        resolveNet = r
      }),
    )

    const { seen } = mountProbe()
    await flush()
    await flush()

    // Before the network resolves, the persisted list is already on screen.
    expect(seen[seen.length - 1].items.map((t) => t.id)).toEqual(['persisted'])

    await act(async () => {
      resolveNet([taste('fresh')])
      await Promise.resolve()
    })

    // Then it revalidates to the fresh network list.
    expect(seen[seen.length - 1].items.map((t) => t.id)).toEqual(['fresh'])
    expect(mockListTastes).toHaveBeenCalledTimes(1)
  })

  it('writes the revalidated list back to AsyncStorage', async () => {
    setTastesUser('u1')
    mockListTastes.mockResolvedValueOnce([taste('a'), taste('b')])

    mountProbe()
    await flush()
    await flush()

    const raw = await AsyncStorage.getItem('yon_tastes:u1')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string).map((t: Taste) => t.id)).toEqual(['a', 'b'])
  })
})

describe('invalidateTastes', () => {
  it('forces a refetch and updates mounted views', async () => {
    setTastesUser('u1')
    mockListTastes
      .mockResolvedValueOnce([taste('first')])
      .mockResolvedValueOnce([taste('second')])

    const { seen } = mountProbe()
    await flush()
    await flush()
    expect(seen[seen.length - 1].items.map((t) => t.id)).toEqual(['first'])

    await act(async () => {
      await invalidateTastes()
    })
    await flush()

    expect(mockListTastes).toHaveBeenCalledTimes(2)
    expect(seen[seen.length - 1].items.map((t) => t.id)).toEqual(['second'])
  })
})

describe('clearPersistedTastes (logout cleanup)', () => {
  it('removes the persisted key and drops the in-memory cache', async () => {
    setTastesUser('u1')
    mockListTastes.mockResolvedValue([taste('cached')])

    mountProbe()
    await flush()
    await flush()
    expect(await AsyncStorage.getItem('yon_tastes:u1')).not.toBeNull()

    await act(async () => {
      await clearPersistedTastes()
    })

    expect(await AsyncStorage.getItem('yon_tastes:u1')).toBeNull()

    // A fresh mount after clearing must re-hit the network (cache was dropped).
    mockListTastes.mockClear()
    mockListTastes.mockResolvedValueOnce([taste('reloaded')])
    const { seen } = mountProbe()
    await flush()
    await flush()
    expect(mockListTastes).toHaveBeenCalledTimes(1)
    expect(seen[seen.length - 1].items.map((t) => t.id)).toEqual(['reloaded'])
  })
})

describe('request dedupe', () => {
  it('issues a single listTastes() call for concurrent mounts', async () => {
    setTastesUser('u1')
    let resolve!: (v: Taste[]) => void
    mockListTastes.mockReturnValueOnce(
      new Promise<Taste[]>((r) => {
        resolve = r
      }),
    )

    // Three views mount before the network resolves.
    mountProbe()
    mountProbe()
    mountProbe()
    await flush()

    expect(mockListTastes).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolve([taste('shared')])
      await Promise.resolve()
    })
    expect(mockListTastes).toHaveBeenCalledTimes(1)
  })
})

describe('per-user namespacing', () => {
  it('scopes the persisted key by user id so accounts do not cross-read', async () => {
    setTastesUser('alice')
    mockListTastes.mockResolvedValueOnce([taste('alice-1')])
    mountProbe()
    await flush()
    await flush()

    // Switch accounts → cache resets, different storage key.
    setTastesUser('bob')
    mockListTastes.mockResolvedValueOnce([taste('bob-1')])
    const { seen } = mountProbe()
    await flush()
    await flush()

    expect(seen[seen.length - 1].items.map((t) => t.id)).toEqual(['bob-1'])
    expect(await AsyncStorage.getItem('yon_tastes:alice')).toContain('alice-1')
    expect(await AsyncStorage.getItem('yon_tastes:bob')).toContain('bob-1')
  })
})
