/* ============================================================
   Regression — AuthProvider optimistic cold start (口味 snapshot).

   User feedback: the app's cold start blocked on a full splash for ~3s
   (waiting on getMe() over the network) before the home page appeared.
   Fix: when a stored token AND a persisted session snapshot both exist,
   paint the signed-in app immediately from cache (loading → false) and
   revalidate getMe() in the BACKGROUND. The home page then hydrates its
   own persisted taste list, so the user's last-known 口味 shows within a
   frame while the latest data syncs.

   These tests must FAIL against the old bootstrap (which `await refresh()`
   before resolving the gate, so `loading` stayed true and `user` null
   until getMe() returned) and pass against the optimistic version. They
   also pin the safety rails: a transient (offline) background failure
   keeps the cached session, while a definitive 401 / signed-out response
   tears it down.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getMe } from '@yon/shared'
import { setTastesUser } from '@/app/(tabs)/_useTastes'
import { AuthProvider, useAuth } from '../AuthProvider'

// ── mocks ──────────────────────────────────────────────────────────────────

jest.mock('@yon/shared', () => ({
  getMe: jest.fn(),
  logout: jest.fn(async () => {}),
  getAuthToken: jest.fn(() => 'tok-1'),
  setAuthToken: jest.fn(),
}))

jest.mock('expo-image', () => ({
  Image: {
    clearDiskCache: jest.fn(async () => {}),
    clearMemoryCache: jest.fn(async () => {}),
  },
}))

// Scope-cache modules are spied so applySession is observable and never
// touches AsyncStorage (the snapshot key `yon_user` stays under our control).
jest.mock('@/app/(tabs)/_useTastes', () => ({
  clearPersistedTastes: jest.fn(async () => {}),
  setTastesUser: jest.fn(),
}))
jest.mock('@/app/(tabs)/_useTags', () => ({
  clearTagsCache: jest.fn(),
  setTagsUser: jest.fn(),
}))
jest.mock('@/app/(tabs)/_useTasters', () => ({
  setTastersUser: jest.fn(),
}))
jest.mock('@/app/(tabs)/_useActiveTaster', () => ({
  setActiveTasterUser: jest.fn(),
  clearActiveTaster: jest.fn(async () => {}),
}))

// expo-secure-store is the shared __mocks__ singleton (moduleNameMapper). We
// override getItemAsync per test to simulate a persisted bearer token.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SecureStore = require('expo-secure-store') as {
  getItemAsync: jest.Mock
}

const mockedGetMe = jest.mocked(getMe)
const mockedSetTastesUser = jest.mocked(setTastesUser)

const snapUser = {
  id: 'user-snap',
  displayName: 'Cached',
  phone: '',
  email: '',
  avatar: '',
  locale: 'zh',
  plan: 'free' as const,
  warningsEnabled: false,
  locationEnabled: false,
  mediaEnabled: false,
  defaultVisibility: 'private' as const,
  createdAt: '',
}

// ── helpers ─────────────────────────────────────────────────────────────────

function renderProvider() {
  let latest!: ReturnType<typeof useAuth>
  function Inner() {
    latest = useAuth()
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(
      <AuthProvider>
        <Inner />
      </AuthProvider>,
    )
  })
  return { renderer, get: () => latest }
}

/** Flush the bootstrap async chain (token read → snapshot read → state). */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function seedSnapshot() {
  await AsyncStorage.setItem(
    'yon_user',
    JSON.stringify({ user: snapUser, providers: [] }),
  )
}

// ── tests ───────────────────────────────────────────────────────────────────

beforeEach(async () => {
  jest.clearAllMocks()
  await AsyncStorage.clear()
  SecureStore.getItemAsync.mockResolvedValue('tok-1')
})

describe('AuthProvider — optimistic cold start (口味 snapshot)', () => {
  it('paints the persisted session immediately and resolves the gate BEFORE getMe() returns', async () => {
    await seedSnapshot()
    // getMe stays pending so we can prove the gate opened without it.
    let resolveMe!: (v: { user: typeof snapUser | null; providers: [] }) => void
    mockedGetMe.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMe = resolve
        }),
    )

    const { renderer, get } = renderProvider()
    await flush()

    // Optimistic paint: signed-in UI is up with no getMe() resolution yet.
    expect(get().loading).toBe(false)
    expect(get().user?.id).toBe('user-snap')
    // Per-account caches were scoped to the snapshot user before any view reads.
    expect(mockedSetTastesUser).toHaveBeenCalledWith('user-snap')
    // Background revalidation was kicked off.
    expect(mockedGetMe).toHaveBeenCalledTimes(1)

    // Fresh data lands in the background → state updates in place.
    await act(async () => {
      resolveMe({ user: { ...snapUser, displayName: 'Fresh' }, providers: [] })
      await Promise.resolve()
    })
    expect(get().user?.displayName).toBe('Fresh')

    act(() => renderer.unmount())
  })

  it('keeps the cached session when the background revalidate fails transiently (offline)', async () => {
    await seedSnapshot()
    mockedGetMe.mockRejectedValue(new Error('Network request failed'))

    const { renderer, get } = renderProvider()
    await flush()

    // Offline must NOT bounce the signed-in user to the login screen.
    expect(get().loading).toBe(false)
    expect(get().user?.id).toBe('user-snap')

    act(() => renderer.unmount())
  })

  it('signs the user out when the background revalidate is a 401', async () => {
    await seedSnapshot()
    mockedGetMe.mockRejectedValue(new Error('http_401'))

    const { renderer, get } = renderProvider()
    await flush()

    expect(get().user).toBeNull()

    act(() => renderer.unmount())
  })

  it('clears the optimistic session when the server reports signed out (user: null)', async () => {
    await seedSnapshot()
    mockedGetMe.mockResolvedValue({ user: null, providers: [] })

    const { renderer, get } = renderProvider()
    await flush()

    expect(get().user).toBeNull()
    // Snapshot purged so the next launch can't paint this account optimistically.
    expect(await AsyncStorage.getItem('yon_user')).toBeNull()

    act(() => renderer.unmount())
  })

  it('persists a session snapshot after a successful refresh so the next cold start is instant', async () => {
    // No prior snapshot → blocking refresh path; success should write one.
    mockedGetMe.mockResolvedValue({ user: snapUser, providers: [] })

    const { renderer, get } = renderProvider()
    await flush()

    expect(get().user?.id).toBe('user-snap')
    const raw = await AsyncStorage.getItem('yon_user')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string).user.id).toBe('user-snap')

    act(() => renderer.unmount())
  })
})
