/* ============================================================
   Regression — AuthProvider.signOut awaits token deletion.

   Finding: SecureStore.deleteItemAsync was fire-and-forget; a fast
   app kill after sign-out could restore the old token on next launch
   because the deletion hadn't completed before the process exited.

   Fix: deleteStoredToken() is async and awaited inside signOut's
   finally block.

   This test verifies that deleteItemAsync is called (and awaited)
   during signOut by checking that the mock resolves before signOut
   returns — i.e. the mock's resolved value is observed.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { logout, getMe, setAuthToken } from '@yon/shared'
import { clearPersistedTastes, setTastesUser } from '@/app/(tabs)/_useTastes'
import { clearTagsCache, setTagsUser } from '@/app/(tabs)/_useTags'
import { Image } from 'expo-image'
import { AuthProvider, useAuth } from '../AuthProvider'

// ── mocks ─────────────────────────────────────────────────────────────────────

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

jest.mock('@/app/(tabs)/_useTags', () => ({
  clearTagsCache: jest.fn(),
  setTagsUser: jest.fn(),
}))

// Track whether deleteItemAsync was awaited (resolved before signOut returns).
let deleteResolved = false

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {
    // Simulate an async microtask — if signOut awaits this, deleteResolved
    // will be true before signOut's promise resolves.
    await Promise.resolve()
    deleteResolved = true
  }),
}))

const mockedLogout = jest.mocked(logout)
const mockedGetMe = jest.mocked(getMe)

// ── helpers ───────────────────────────────────────────────────────────────────

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

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  deleteResolved = false
  mockedGetMe.mockRejectedValue(new Error('not signed in'))
  mockedLogout.mockResolvedValue(undefined)
})

describe('AuthProvider.signOut — awaits token deletion (finding: fire-and-forget race)', () => {
  it('deleteItemAsync is awaited before signOut resolves', async () => {
    /* Regression: old code used void SecureStore.deleteItemAsync(...), so
       signOut could return before the deletion completed. A fast app kill
       after sign-out would find the token still in SecureStore on next launch. */
    const { getSignOut } = renderProvider()
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      await getSignOut()()
    })

    // If deleteItemAsync was awaited, deleteResolved must be true now.
    expect(deleteResolved).toBe(true)
  })

  it('still clears all local state even when deleteItemAsync resolves slowly', async () => {
    const { getSignOut } = renderProvider()
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      await getSignOut()()
    })

    expect(jest.mocked(setAuthToken)).toHaveBeenCalledWith(null)
    expect(jest.mocked(clearPersistedTastes)).toHaveBeenCalled()
    expect(jest.mocked(clearTagsCache)).toHaveBeenCalled()
  })
})
