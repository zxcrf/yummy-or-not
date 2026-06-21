/* ============================================================
   Regression — setTagsUser / setTastersUser no-op on the SAME account.

   User feedback (after the optimistic cold-start change): on a cold start
   (kill + reopen) the library's tag filter rendered blank — only the three
   built-in verdicts (好吃/一般/别买) and "全部" showed, custom tags were
   gone — until the user opened 标签管理, which remounted the hook and
   refetched.

   Root cause: AppGate now paints the home page optimistically from the
   persisted session, so AuthProvider applies the account TWICE on cold
   start — once from the snapshot, then again when the background getMe()
   resolves. setTastesUser already no-ops on a repeated same-account call
   (`if (id === userId) return`), so the 口味 list survived; setTagsUser /
   setTastersUser did NOT, so the second call cleared the just-fetched
   cache and emitted [] with no refetch, blanking the tag filter.

   Fix: give setTagsUser / setTastersUser the same same-account guard. These
   tests must FAIL against the unguarded versions (the second same-account
   call wipes the list) and pass against the fix. A different-account call
   must still re-scope (account switch keeps working).
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import type { UserTag, Taster } from '@yon/shared'
import { setTagsUser, useTags } from '../_useTags'

const mockGetTags = jest.fn<Promise<UserTag[]>, []>()
const mockGetTasters = jest.fn<Promise<Taster[]>, []>()
jest.mock('@yon/shared', () => ({
  getTags: (...args: []) => mockGetTags(...args),
  getTasters: (...args: []) => mockGetTasters(...args),
}))

// _useTasters pulls in active-taster reconciliation — stub it so the tasters
// case has no AsyncStorage side effects.
jest.mock('../_useActiveTaster', () => ({
  getActiveTaster: () => null,
  setActiveTaster: jest.fn(async () => {}),
  useActiveTaster: () => null,
  setActiveTasterUser: jest.fn(),
  clearActiveTaster: jest.fn(),
}))

// Imported AFTER the mock above so the stubbed _useActiveTaster is in place.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setTastersUser, useTasters } = require('../_useTasters') as typeof import('../_useTasters')

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

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []
afterEach(() => {
  act(() => mountedRenderers.forEach((r) => r.unmount()))
  mountedRenderers.length = 0
})

const flush = () => act(async () => { await Promise.resolve() })

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

beforeEach(() => {
  mockGetTags.mockReset()
  mockGetTasters.mockReset()
  // Reset module-level scope to signed-out so each case starts cold. The
  // distinct-id dance forces a real reset even with the same-account guard.
  setTagsUser('__reset__')
  setTagsUser(null)
  setTastersUser('__reset__')
  setTastersUser(null)
})

describe('setTagsUser — same-account guard (cold-start tag-wipe regression)', () => {
  it('keeps the fetched tag list when the same account is applied again', async () => {
    mockGetTags.mockResolvedValue([tag('Boba'), tag('Coffee')])

    setTagsUser('u1')
    const seen = await mountTagProbe()
    await flush()
    expect(seen[seen.length - 1].map((t) => t.id)).toEqual(['Boba', 'Coffee'])

    // The background session revalidate re-applies the SAME account.
    await act(async () => { setTagsUser('u1') })
    await flush()

    // Tags must survive — NOT be wiped to [] (the reported blank filter).
    expect(seen[seen.length - 1].map((t) => t.id)).toEqual(['Boba', 'Coffee'])
    // No spurious refetch was needed to keep them.
    expect(mockGetTags).toHaveBeenCalledTimes(1)
  })

  it('still clears (and a fresh mount refetches) when a DIFFERENT account is applied', async () => {
    mockGetTags.mockResolvedValueOnce([tag('Boba')])
    setTagsUser('u1')
    const seen = await mountTagProbe()
    await flush()
    expect(seen[seen.length - 1].map((t) => t.id)).toEqual(['Boba'])

    // Account switch — the guard must NOT swallow this: the mounted view clears.
    await act(async () => { setTagsUser('u2') })
    await flush()
    expect(seen[seen.length - 1]).toEqual([])

    // A view mounting under the new account fetches u2's tags.
    mockGetTags.mockResolvedValueOnce([tag('Tea')])
    const seen2 = await mountTagProbe()
    await flush()
    expect(seen2[seen2.length - 1].map((t) => t.id)).toEqual(['Tea'])
    expect(mockGetTags).toHaveBeenCalledTimes(2)
  })
})

describe('setTastersUser — same-account guard', () => {
  it('keeps the fetched persona list when the same account is applied again', async () => {
    mockGetTasters.mockResolvedValue([taster('t-self', true), taster('t-partner')])

    setTastersUser('u1')
    const seen = await mountTasterProbe()
    await flush()
    expect(seen[seen.length - 1].map((t) => t.id)).toEqual(['t-self', 't-partner'])

    await act(async () => { setTastersUser('u1') })
    await flush()

    expect(seen[seen.length - 1].map((t) => t.id)).toEqual(['t-self', 't-partner'])
    expect(mockGetTasters).toHaveBeenCalledTimes(1)
  })
})
