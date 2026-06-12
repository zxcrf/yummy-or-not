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
  getCachedTaste,
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
    status: 'tasted',
    verdict: 'yum',
    tags: [],
    boughtCount: 0,
    warnBeforeBuy: false,
    purchases: [],
    date: 'today',
    notes: '',
    image: '',
    imageThumb: '',
    imageDisplay: '',
    imageKey: '',
    createdAt: '2026-06-08T00:00:00.000Z',
  }
}

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

afterEach(() => {
  act(() => { mountedRenderers.forEach((r) => r.unmount()) })
  mountedRenderers.length = 0
})

/** Mount a probe that records every items value the hook yields. */
async function mountProbe() {
  const seen: { items: Taste[]; loading: boolean }[] = []
  function Probe() {
    const s = useRefreshableTastes()
    seen.push({ items: s.items, loading: s.loading })
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<Probe />)
  })
  mountedRenderers.push(renderer)
  return { seen, renderer }
}

const flush = () => act(async () => { await Promise.resolve() })

beforeEach(async () => {
  mockListTastes.mockReset()
  // Reset the module-level cache (setTastesUser to a sentinel then null clears
  // cache/inFlight/hydrated/epoch) and wipe persisted storage so each test is
  // cold. Wrap in act() because setTastesUser now emits [] to any mounted
  // subscribers — React requires state updates to happen inside act().
  await act(async () => {
    setTastesUser('__reset__')
    setTastesUser(null)
  })
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

    const { seen } = await mountProbe()
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

    await mountProbe()
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

    const { seen } = await mountProbe()
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

describe('getCachedTaste', () => {
  it('returns the cached taste object for a matching id without refetching', async () => {
    const cached = taste('cached-hit')
    setTastesUser('u1')
    mockListTastes.mockResolvedValueOnce([cached])

    await act(async () => {
      await invalidateTastes()
    })

    // Why this matters: detail screens can synchronously seed from the shared
    // list cache and avoid a redundant getTaste request on list-hit opens.
    expect(getCachedTaste('cached-hit')).toBe(cached)
    expect(mockListTastes).toHaveBeenCalledTimes(1)
  })

  it('returns undefined when the id does not match or the cache is empty', async () => {
    setTastesUser('u1')
    mockListTastes.mockResolvedValueOnce([taste('cached-only')])

    await act(async () => {
      await invalidateTastes()
    })

    // Why this matters: deep-links must fall back cleanly when the shared list
    // does not contain the requested taste.
    expect(getCachedTaste('missing-id')).toBeUndefined()

    await act(async () => {
      setTastesUser('__clear__')
      setTastesUser('u2')
    })

    // Why this matters: cold starts begin with an empty cache, so the reader
    // must not manufacture stale data.
    expect(getCachedTaste('cached-only')).toBeUndefined()
  })
})

describe('clearPersistedTastes (logout cleanup)', () => {
  it('removes the persisted key and drops the in-memory cache', async () => {
    setTastesUser('u1')
    mockListTastes.mockResolvedValue([taste('cached')])

    await mountProbe()
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
    const { seen } = await mountProbe()
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
    await mountProbe()
    await mountProbe()
    await mountProbe()
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
    await mountProbe()
    await flush()
    await flush()

    // Switch accounts → cache resets, different storage key.
    act(() => { setTastesUser('bob') })
    mockListTastes.mockResolvedValueOnce([taste('bob-1')])
    const { seen } = await mountProbe()
    await flush()
    await flush()

    expect(seen[seen.length - 1].items.map((t) => t.id)).toEqual(['bob-1'])
    expect(await AsyncStorage.getItem('yon_tastes:alice')).toContain('alice-1')
    expect(await AsyncStorage.getItem('yon_tastes:bob')).toContain('bob-1')
  })
})

// ── Regression: epoch-guarded race fixes ────────────────────────────────────

describe('epoch guard — user-switch mid-fetch (finding 1)', () => {
  it('discards account-A fetch that resolves after setTastesUser(B)', async () => {
    /* Old code: slow account-A listTastes resolves after the user switches to
       B, emits A's data, and persists it under B's storage key (cross-account
       leak). Fix: epoch check at commit time — A's fetch epoch no longer
       matches, so the result is silently discarded. */
    setTastesUser('alice')
    let resolveAlice!: (v: Taste[]) => void
    mockListTastes.mockReturnValueOnce(
      new Promise<Taste[]>((r) => { resolveAlice = r }),
    )

    // alice's probe is mounted while alice's (slow) fetch is in flight.
    const { seen: aliceSeen } = await mountProbe()
    await flush()

    // User switches while alice's fetch is still in-flight. A new probe
    // mounts representing the first view rendered for bob's session.
    mockListTastes.mockResolvedValueOnce([taste('bob-1')])
    // Wrap in act() — setTastesUser emits [] which updates mounted hook state.
    act(() => { setTastesUser('bob') })
    // setTastesUser must immediately clear all mounted views.
    expect(aliceSeen[aliceSeen.length - 1].items).toEqual([])

    // Bob's first view mounts — this triggers the revalidate() for bob.
    const { seen: bobSeen } = await mountProbe()
    await flush()
    await flush()

    // Now resolve the stale alice fetch — must be discarded (epoch mismatch).
    await act(async () => {
      resolveAlice([taste('alice-1')])
      await Promise.resolve()
    })
    await flush()

    // Bob's probe shows bob's data; alice's data must never appear anywhere.
    expect(bobSeen[bobSeen.length - 1].items.map((t) => t.id)).toEqual(['bob-1'])
    const allAliceIds = aliceSeen.map((s) => s.items.map((t) => t.id).join(','))
    expect(allAliceIds).not.toContain('alice-1')

    // alice's data must not be written under bob's storage key.
    const bobRaw = await AsyncStorage.getItem('yon_tastes:bob')
    expect(bobRaw ? JSON.parse(bobRaw).map((t: Taste) => t.id) : []).not.toContain('alice-1')
  })

  it('immediately clears mounted views when setTastesUser is called', async () => {
    /* Old code: setTastesUser only cleared module cache; already-mounted hooks
       kept the prior account's items. Fix: setTastesUser emits [] so every
       subscriber clears synchronously before the new fetch resolves. */
    setTastesUser('u1')
    // Seed warm cache so the hook starts with items.
    // We can't easily seed via mountProbe+flush without a network mock here,
    // so we call revalidate indirectly: provide a resolving mock then flush.
    mockListTastes.mockResolvedValueOnce([taste('u1-item')])
    const { seen } = await mountProbe()
    // After mounting, switch user — must clear mounted views immediately.
    act(() => { setTastesUser('u2') })
    // The last recorded state must be empty (emitted by setTastesUser).
    expect(seen[seen.length - 1].items).toEqual([])
  })
})

describe('epoch guard — invalidate during in-flight (finding 2)', () => {
  it('stale pre-mutation fetch cannot overwrite the post-mutation refetch', async () => {
    /* Old code: invalidateTastes() set inFlight=null but the older promise
       still held a closure over cache/emit; whichever resolved last won —
       the pre-mutation fetch could overwrite fresh post-mutation data. Fix:
       epoch check — the pre-mutation fetch's epoch no longer matches after
       invalidate bumps it, so it is discarded. */
    setTastesUser('u1')

    let resolveStale!: (v: Taste[]) => void
    mockListTastes
      // First call: slow, pre-mutation fetch (will be stale).
      .mockReturnValueOnce(new Promise<Taste[]>((r) => { resolveStale = r }))
      // Second call: fast, post-mutation fetch.
      .mockResolvedValueOnce([taste('fresh-after-mutation')])

    const { seen } = await mountProbe()
    await flush() // first fetch started

    // Mutation happens — invalidate bumps epoch and starts the second fetch.
    await act(async () => {
      await invalidateTastes()
    })
    await flush()

    // Post-mutation result is now on screen.
    expect(seen[seen.length - 1].items.map((t) => t.id)).toEqual(['fresh-after-mutation'])

    // Now the stale pre-mutation fetch resolves — must be discarded.
    await act(async () => {
      resolveStale([taste('stale-pre-mutation')])
      await Promise.resolve()
    })
    await flush()

    expect(seen[seen.length - 1].items.map((t) => t.id)).toEqual(['fresh-after-mutation'])
    const ids = seen.map((s) => s.items.map((t) => t.id).join(','))
    expect(ids).not.toContain('stale-pre-mutation')
  })
})

describe('cold-start persisted hydration — all subscribers notified (finding 5)', () => {
  it('all concurrent cold-start views receive the persisted snapshot', async () => {
    /* Old code: readPersisted() only set state on the component that won the
       hydrated=false race; other concurrent cold-start hooks waited for the
       network. Fix: emit(persisted) broadcasts to all listeners so every
       mounted view paints the stale-while-revalidate snapshot. */
    setTastesUser('u1')
    await AsyncStorage.setItem(
      'yon_tastes:u1',
      JSON.stringify([taste('cached')]),
    )

    // Slow network — persisted snapshot must reach all concurrent views first.
    let resolveNet!: (v: Taste[]) => void
    mockListTastes.mockReturnValueOnce(
      new Promise<Taste[]>((r) => { resolveNet = r }),
    )

    // Two views mount concurrently (cold start — no warm cache yet).
    const { seen: seen1 } = await mountProbe()
    const { seen: seen2 } = await mountProbe()
    await flush()
    await flush()

    // Both views must have painted the persisted snapshot before network.
    expect(seen1[seen1.length - 1].items.map((t) => t.id)).toEqual(['cached'])
    expect(seen2[seen2.length - 1].items.map((t) => t.id)).toEqual(['cached'])

    // Network resolves — both update.
    await act(async () => {
      resolveNet([taste('network')])
      await Promise.resolve()
    })
    expect(seen1[seen1.length - 1].items.map((t) => t.id)).toEqual(['network'])
    expect(seen2[seen2.length - 1].items.map((t) => t.id)).toEqual(['network'])
  })
})

describe('serialized write chain — stale setItem cannot resurrect after removeItem (finding: fire-and-forget race)', () => {
  it('clearPersistedTastes removeItem wins even when a prior setItem is still in flight', async () => {
    /* Old code: writePersisted was fire-and-forget — if the AsyncStorage.setItem
       call from revalidate() was still in-flight when clearPersistedTastes() ran
       its removeItem, the setItem could complete AFTER the removeItem and
       resurrect the key with stale (possibly cross-account) data.

       Fix: all writes for a key are serialized through a per-key promise chain
       (pendingWrites map). writePersisted re-checks epoch+key immediately before
       the actual setItem; clearPersistedTastes joins the same chain so its
       removeItem always runs after any queued setItem.  A stale write detects
       the epoch mismatch and becomes a no-op; the removal is therefore the last
       writer and the key stays absent. */

    setTastesUser('u1')

    // Intercept AsyncStorage.setItem so we can delay it arbitrarily.
    let resolveSetItem!: () => void
    const setItemGate = new Promise<void>((r) => { resolveSetItem = r })
    const realSetItem = AsyncStorage.setItem.bind(AsyncStorage)
    const setItemSpy = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockImplementationOnce(async (key, value) => {
        // Block this specific setItem until the test releases it.
        await setItemGate
        return realSetItem(key, value)
      })

    // Trigger revalidate so writePersisted enqueues a (blocked) setItem.
    mockListTastes.mockResolvedValueOnce([taste('will-be-stale')])
    await mountProbe()
    // Let revalidate() run and listTastes resolve, enqueueing the blocked setItem.
    await flush()
    await flush()

    // Now call clearPersistedTastes — its removeItem joins the write chain and
    // will run AFTER the setItem, but the epoch/key re-check inside writePersisted
    // must detect the epoch bump and skip the actual write.
    const clearPromise = act(async () => {
      await clearPersistedTastes()
    })

    // Release the blocked setItem — it should find epoch mismatch and be a no-op.
    resolveSetItem()

    // Wait for both the blocked setItem and the removeItem to drain.
    await clearPromise
    await flush()

    setItemSpy.mockRestore()

    // The key must be absent — the stale setItem must not have written anything,
    // and the removeItem must have run (or the no-op write means the key was
    // never written in the first place, which is equally correct).
    expect(await AsyncStorage.getItem('yon_tastes:u1')).toBeNull()
  })
})
