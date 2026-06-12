/* ============================================================
   Regression test — normalizeHydrated: old AsyncStorage rows
   that predate the status column get status:'tasted' injected.

   Why this matters: users who ran the app before migration 0006
   have cached rows in AsyncStorage without a `status` field.
   When the updated app cold-starts, normalizeHydrated() must
   coerce those rows to status:'tasted' so every consumer can
   safely read item.status without null/undefined checks.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Taste } from '@yon/shared'
import {
  setTastesUser,
  useRefreshableTastes,
} from '../_useTastes'

const mockListTastes = jest.fn<Promise<Taste[]>, []>()
jest.mock('@yon/shared', () => ({
  listTastes: (...args: []) => mockListTastes(...args),
}))

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

afterEach(() => {
  act(() => { mountedRenderers.forEach((r) => r.unmount()) })
  mountedRenderers.length = 0
})

async function mountProbe() {
  const seen: Taste[][] = []
  function Probe() {
    const { items } = useRefreshableTastes()
    seen.push(items)
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
  await act(async () => {
    setTastesUser('__reset__')
    setTastesUser(null)
  })
  await AsyncStorage.clear()
})

describe('normalizeHydrated — AsyncStorage hydrate backward compat', () => {
  it('injects status:tasted into old cached rows that lack the status field', async () => {
    setTastesUser('u1')

    // Simulate a pre-migration AsyncStorage entry: rows have no `status` field.
    const legacyRows = [
      {
        id: 'old-1',
        name: 'Croissant',
        place: 'Bakery',
        price: '3.00',
        verdict: 'yum',
        // intentionally no `status` field
        tags: [],
        boughtCount: 1,
        warnBeforeBuy: false,
        purchases: [],
        date: 'yesterday',
        notes: '',
        image: '',
        imageThumb: '',
        imageDisplay: '',
        imageKey: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'old-2',
        name: 'Latte',
        place: 'Cafe',
        price: '5.00',
        verdict: 'meh',
        // intentionally no `status` field
        tags: [],
        boughtCount: 0,
        warnBeforeBuy: false,
        purchases: [],
        date: 'last week',
        notes: '',
        image: '',
        imageThumb: '',
        imageDisplay: '',
        imageKey: '',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]

    await AsyncStorage.setItem('yon_tastes:u1', JSON.stringify(legacyRows))

    // Slow network — so we can inspect the hydrated snapshot before network resolves.
    let resolveNet!: (v: Taste[]) => void
    mockListTastes.mockReturnValueOnce(
      new Promise<Taste[]>((r) => { resolveNet = r }),
    )

    const { seen } = await mountProbe()
    await flush()
    await flush()

    // The hydrated (stale) snapshot must have status:'tasted' on both rows.
    const hydrated = seen[seen.length - 1]
    expect(hydrated).toHaveLength(2)
    expect(hydrated[0].id).toBe('old-1')
    expect(hydrated[0].status).toBe('tasted')
    expect(hydrated[1].id).toBe('old-2')
    expect(hydrated[1].status).toBe('tasted')

    // Clean up — let network resolve so no pending promises linger.
    await act(async () => {
      resolveNet([])
      await Promise.resolve()
    })
  })

  it('does not mutate status on rows that already have status:todo', async () => {
    setTastesUser('u1')

    // A row with status:'todo' already set must pass through unchanged.
    const existingRow = {
      id: 'todo-1',
      name: 'Ramen',
      place: '',
      price: '',
      status: 'todo',
      verdict: null,
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
      createdAt: '2026-06-11T00:00:00.000Z',
    }

    await AsyncStorage.setItem('yon_tastes:u1', JSON.stringify([existingRow]))

    let resolveNet!: (v: Taste[]) => void
    mockListTastes.mockReturnValueOnce(
      new Promise<Taste[]>((r) => { resolveNet = r }),
    )

    const { seen } = await mountProbe()
    await flush()
    await flush()

    const hydrated = seen[seen.length - 1]
    expect(hydrated).toHaveLength(1)
    expect(hydrated[0].status).toBe('todo')

    await act(async () => {
      resolveNet([])
      await Promise.resolve()
    })
  })

  it('does not mutate status on rows that already have status:tasted', async () => {
    setTastesUser('u1')

    const existingRow = {
      id: 'tasted-1',
      name: 'Espresso',
      place: 'Cafe',
      price: '4.00',
      status: 'tasted',
      verdict: 'yum',
      tags: [],
      boughtCount: 1,
      warnBeforeBuy: false,
      purchases: [],
      date: 'today',
      notes: '',
      image: '',
      imageThumb: '',
      imageDisplay: '',
      imageKey: '',
      createdAt: '2026-06-11T00:00:00.000Z',
    }

    await AsyncStorage.setItem('yon_tastes:u1', JSON.stringify([existingRow]))

    let resolveNet!: (v: Taste[]) => void
    mockListTastes.mockReturnValueOnce(
      new Promise<Taste[]>((r) => { resolveNet = r }),
    )

    const { seen } = await mountProbe()
    await flush()
    await flush()

    const hydrated = seen[seen.length - 1]
    expect(hydrated[0].status).toBe('tasted')

    await act(async () => {
      resolveNet([])
      await Promise.resolve()
    })
  })
})
