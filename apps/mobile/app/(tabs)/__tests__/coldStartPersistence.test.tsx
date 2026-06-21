/* ============================================================
   Feature/regression — _useTags / _useTasters disk stale-while-revalidate.

   User feedback: on a cold start (kill + reopen) the library's tag filter and
   the top-right persona avatar showed empty until a manual remount (opening
   标签管理 / 家人管理). Root causes were two-fold:
     1. A same-account re-scope wiped the freshly-fetched list (fixed in the
        same-account guard — see sameUserScopeGuard.test.tsx).
     2. Tags + tasters had NO on-disk cache (unlike tastes), so even once the
        wipe was fixed they still flashed empty until the first network fetch.

   This pins (2): both modules now hydrate from AsyncStorage on cold start so
   the persisted list paints immediately — even while the network is still in
   flight — then revalidate overwrites it. Keys are namespaced per account so a
   different account never reads another's data, and logout purges the keys.

   These tests FAIL against the no-disk-cache modules (the persisted list never
   paints while the network is pending) and pass against the disk-cache version.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { UserTag, Taster } from '@yon/shared'
import { setTagsUser, clearTagsCache, useTags } from '../_useTags'

const mockGetTags = jest.fn<Promise<UserTag[]>, []>()
const mockGetTasters = jest.fn<Promise<Taster[]>, []>()
jest.mock('@yon/shared', () => ({
  getTags: (...args: []) => mockGetTags(...args),
  getTasters: (...args: []) => mockGetTasters(...args),
}))

jest.mock('../_useActiveTaster', () => ({
  getActiveTaster: () => null,
  setActiveTaster: jest.fn(async () => {}),
  useActiveTaster: () => null,
  setActiveTasterUser: jest.fn(),
  clearActiveTaster: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setTastersUser, clearPersistedTasters, useTasters } =
  require('../_useTasters') as typeof import('../_useTasters')

function tag(id: string): UserTag {
  return { id, name: id, createdAt: '2026-06-08T00:00:00.000Z' }
}
function taster(id: string, isSelf = false): Taster {
  return {
    id,
    ownerAccountId: 'u1',
    familyId: null,
    displayName: id,
    avatar: '',
    isSelf,
    createdAt: '2026-06-08T00:00:00.000Z',
  }
}

/** A promise that never resolves — proves a paint came from disk, not network. */
const PENDING = <T,>() => new Promise<T>(() => {})

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []
afterEach(() => {
  act(() => mountedRenderers.forEach((r) => r.unmount()))
  mountedRenderers.length = 0
})

/** Flush microtasks + the AsyncStorage read/write turns. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

async function mountTagProbe() {
  const seen: UserTag[][] = []
  function Probe() {
    seen.push(useTags().tags)
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => { renderer = TestRenderer.create(<Probe />) })
  mountedRenderers.push(renderer)
  return seen
}

async function mountTasterProbe() {
  const seen: Taster[][] = []
  function Probe() {
    seen.push(useTasters().tasters)
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => { renderer = TestRenderer.create(<Probe />) })
  mountedRenderers.push(renderer)
  return seen
}

beforeEach(async () => {
  mockGetTags.mockReset()
  mockGetTasters.mockReset()
  await AsyncStorage.clear()
  // Reset module scope to signed-out; the distinct-id dance forces a real reset
  // through the same-account guard.
  setTagsUser('__reset__')
  setTagsUser(null)
  setTastersUser('__reset__')
  setTastersUser(null)
})

describe('_useTags — cold-start disk hydration', () => {
  it('paints the persisted tag set on cold start while the network is still pending', async () => {
    mockGetTags.mockReturnValue(PENDING<UserTag[]>())
    await AsyncStorage.setItem('yon_tags:u1', JSON.stringify([tag('Boba'), tag('Coffee')]))

    setTagsUser('u1')
    const seen = await mountTagProbe()
    await settle()

    // The library's tag chips appear immediately from disk — not blank/"全部"-only.
    expect(seen[seen.length - 1].map((t) => t.id)).toEqual(['Boba', 'Coffee'])
  })

  it('revalidate overwrites the disk paint with fresh data and re-persists it', async () => {
    await AsyncStorage.setItem('yon_tags:u1', JSON.stringify([tag('Stale')]))
    mockGetTags.mockResolvedValue([tag('Fresh')])

    setTagsUser('u1')
    const seen = await mountTagProbe()
    await settle()

    expect(seen[seen.length - 1].map((t) => t.id)).toEqual(['Fresh'])
    const raw = await AsyncStorage.getItem('yon_tags:u1')
    expect(JSON.parse(raw as string).map((t: UserTag) => t.id)).toEqual(['Fresh'])
  })

  it('does NOT paint another account\'s persisted tags (per-account namespacing)', async () => {
    await AsyncStorage.setItem('yon_tags:u1', JSON.stringify([tag('Boba')]))
    mockGetTags.mockReturnValue(PENDING<UserTag[]>())

    setTagsUser('u2') // different account — must not read u1's key
    const seen = await mountTagProbe()
    await settle()

    expect(seen[seen.length - 1]).toEqual([])
  })

  it('clearTagsCache removes the persisted set (logout purge)', async () => {
    await AsyncStorage.setItem('yon_tags:u1', JSON.stringify([tag('Boba')]))
    setTagsUser('u1')

    clearTagsCache()
    await settle()

    expect(await AsyncStorage.getItem('yon_tags:u1')).toBeNull()
  })
})

describe('_useTasters — cold-start disk hydration (persona avatar)', () => {
  it('paints the persisted persona list on cold start while the network is still pending', async () => {
    mockGetTasters.mockReturnValue(PENDING<Taster[]>())
    await AsyncStorage.setItem(
      'yon_tasters:u1',
      JSON.stringify([taster('t-self', true), taster('t-partner')]),
    )

    setTastersUser('u1')
    const seen = await mountTasterProbe()
    await settle()

    // The top-right persona avatar / family sheet render immediately from disk.
    expect(seen[seen.length - 1].map((t) => t.id)).toEqual(['t-self', 't-partner'])
  })

  it('clearPersistedTasters removes the persisted list (logout purge)', async () => {
    await AsyncStorage.setItem('yon_tasters:u1', JSON.stringify([taster('t-self', true)]))
    setTastersUser('u1')

    await clearPersistedTasters()
    await settle()

    expect(await AsyncStorage.getItem('yon_tasters:u1')).toBeNull()
  })
})
