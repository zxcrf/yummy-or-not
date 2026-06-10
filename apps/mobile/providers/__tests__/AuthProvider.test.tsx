/* ============================================================
   Regression test — AuthProvider.signOut with a failing server logout.

   Finding 4: old code did `await logout()` before any local cleanup;
   a network rejection left the bearer token, persisted taste list, and
   photo cache intact — private data residue for the next user of the
   device. Fix: logout() is best-effort (wrapped in try/catch); ALL local
   cleanup runs unconditionally in finally.

   This test must FAIL against the old signOut (which awaits logout()
   without catching) and pass against the fixed version.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Image } from 'expo-image'
import { logout, getMe, setAuthToken, getAuthToken } from '@yon/shared'
import { clearPersistedTastes, setTastesUser } from '@/app/(tabs)/_useTastes'
import { AuthProvider, useAuth } from '../AuthProvider'

// ── mocks ────────────────────────────────────────────────────────────────────

jest.mock('@yon/shared', () => ({
  logout: jest.fn(),
  getMe: jest.fn(),
  getAuthToken: jest.fn(() => null),
  setAuthToken: jest.fn(),
}))

jest.mock('expo-image', () => ({
  Image: {
    clearDiskCache: jest.fn(async () => {}),
    clearMemoryCache: jest.fn(async () => {}),
  },
}))

jest.mock('@/app/(tabs)/_useTastes', () => ({
  clearPersistedTastes: jest.fn(async () => {}),
  setTastesUser: jest.fn(),
}))

// expo-secure-store is handled by moduleNameMapper → __mocks__/expo-secure-store.js
// (dynamic import('expo-secure-store') in writeStoredToken must not hit native).

const mockedLogout = jest.mocked(logout)
const mockedGetMe = jest.mocked(getMe)
const mockedClearDisk = jest.mocked(Image.clearDiskCache)
const mockedClearMem = jest.mocked(Image.clearMemoryCache)
const mockedClearPersisted = jest.mocked(clearPersistedTastes)
const mockedSetTastesUser = jest.mocked(setTastesUser)
const mockedSetAuthToken = jest.mocked(setAuthToken)

// ── helpers ──────────────────────────────────────────────────────────────────

function renderProvider() {
  let signOutFn!: () => Promise<void>
  function Inner() {
    const { signOut } = useAuth()
    signOutFn = signOut
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
  return { renderer, getSignOut: () => signOutFn }
}

// ── tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  // getMe rejects so the bootstrap effect doesn't interfere with signOut tests.
  mockedGetMe.mockRejectedValue(new Error('not signed in'))
})

describe('AuthProvider.signOut — server logout failure (finding 4)', () => {
  it('clears local caches even when the server logout request rejects', async () => {
    /* Regression: old code awaited logout() without catching; a network error
       threw before writeStoredToken / clearPersistedTastes / image cache clear
       ran, leaving private data on the device. */
    mockedLogout.mockRejectedValueOnce(new Error('network error'))

    const { getSignOut } = renderProvider()
    // Wait for the bootstrap useEffect to settle.
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      await getSignOut()()
    })

    // Despite logout() throwing, all local cleanup must have run.
    expect(mockedSetAuthToken).toHaveBeenCalledWith(null)
    expect(mockedClearPersisted).toHaveBeenCalled()
    expect(mockedSetTastesUser).toHaveBeenCalledWith(null)
    expect(mockedClearDisk).toHaveBeenCalled()
    expect(mockedClearMem).toHaveBeenCalled()
  })

  it('also clears local caches when logout succeeds (baseline)', async () => {
    mockedLogout.mockResolvedValueOnce(undefined)

    const { getSignOut } = renderProvider()
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      await getSignOut()()
    })

    expect(mockedSetAuthToken).toHaveBeenCalledWith(null)
    expect(mockedClearPersisted).toHaveBeenCalled()
    expect(mockedSetTastesUser).toHaveBeenCalledWith(null)
    expect(mockedClearDisk).toHaveBeenCalled()
    expect(mockedClearMem).toHaveBeenCalled()
  })
})
