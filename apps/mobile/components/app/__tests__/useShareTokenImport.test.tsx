/* ============================================================
   Tests — S3a 可导入 foreground auto-detect (useShareTokenImport hook).

   The patch adds a hook (components/app/useShareTokenImport.tsx — NOT yet
   implemented, so these FAIL now and PASS after the patch) that:
     • subscribes to AppState; on transition to 'active' (app foreground/resume)
     • reads the clipboard ONCE (expo-clipboard getStringAsync — no polling)
     • parseShareToken(text); only acts on a real 口令 match (privacy)
     • on hit → resolveImportCode(code) → router.push('/import/<token>')
     • DEDUPE: persists the last-handled code so the SAME 口令 never re-prompts.

   Pins behavior NOT yet implemented → FAIL now, PASS after the patch.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { AppState, type AppStateStatus } from 'react-native'
import { encodeShareToken } from '@yon/shared'

import { useShareTokenImport } from '../useShareTokenImport'

// ── AppState: spy on the REAL listener registration so the test can drive the
//    foreground transition (do NOT replace react-native — jest-expo needs it). ─
let appStateListener: ((s: AppStateStatus) => void) | null = null
const addEventListenerSpy = jest
  .spyOn(AppState, 'addEventListener')
  .mockImplementation((event, cb) => {
    if (event === 'change') appStateListener = cb as (s: AppStateStatus) => void
    return { remove: jest.fn() } as ReturnType<typeof AppState.addEventListener>
  })

// ── expo-clipboard: mapped to a stub; drive what the foreground read returns ──
const { getStringAsync: mockGetStringAsync } = require('expo-clipboard')
let clipboardText = ''
;(mockGetStringAsync as jest.Mock).mockImplementation(async () => clipboardText)

// ── shared: real codec, mocked resolveImportCode ──────────────────────────────
const mockResolveImportCode = jest.fn()
jest.mock('@yon/shared', () => {
  const actual = jest.requireActual('@yon/shared')
  return {
    encodeShareToken: actual.encodeShareToken,
    parseShareToken: actual.parseShareToken,
    resolveImportCode: (...a: unknown[]) => mockResolveImportCode(...a),
  }
})

// ── router: spy navigation ────────────────────────────────────────────────────
const mockPush = jest.fn()
const mockReplace = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}))

// ── auth: the hook is inert until a user is present. Default to a signed-in
//    user; the gating test overrides this to null.
let mockUser: { id: string } | null = { id: 'u1' }
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}))

// AsyncStorage dedupe store is already mocked globally in jest.setup.js.

// ── harness: a component that just runs the hook ──────────────────────────────
function Harness() {
  useShareTokenImport()
  return null
}

async function mountHarness(): Promise<TestRenderer.ReactTestRenderer> {
  let r!: TestRenderer.ReactTestRenderer
  await act(async () => { r = TestRenderer.create(<Harness />) })
  await act(async () => { await Promise.resolve() })
  return r
}

async function foreground() {
  // Simulate the app coming to the foreground.
  await act(async () => {
    appStateListener?.('active')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(async () => {
  mockResolveImportCode.mockReset()
  mockPush.mockReset()
  mockReplace.mockReset()
  ;(mockGetStringAsync as jest.Mock).mockClear()
  ;(mockGetStringAsync as jest.Mock).mockImplementation(async () => clipboardText)
  appStateListener = null
  clipboardText = ''
  mockUser = { id: 'u1' }
  addEventListenerSpy.mockClear()
  // Reset the AsyncStorage-backed dedupe store between tests so a persisted
  // last-handled code from one test never bleeds into the next.
  const AsyncStorage = require('@react-native-async-storage/async-storage')
  await AsyncStorage.clear()
})

afterAll(() => {
  addEventListenerSpy.mockRestore()
})

describe('useShareTokenImport (S3a foreground auto-detect)', () => {
  it('on foreground with a 口令 in the clipboard → resolves the code and navigates to the import landing', async () => {
    clipboardText = `朋友分享 ${encodeShareToken('AB12CD')} 打开导入`
    mockResolveImportCode.mockResolvedValueOnce({ token: 'tok_live_1' })

    await mountHarness()
    await foreground()

    // Read the clipboard exactly once (no polling).
    expect(mockGetStringAsync).toHaveBeenCalledTimes(1)
    // Resolved the EXISTING importCode space via the existing endpoint.
    expect(mockResolveImportCode).toHaveBeenCalledWith('AB12CD')
    // Navigated to the import landing for the resolved token (→ ImportLanding
    // preview + confirm).
    const navTargets = [
      ...mockPush.mock.calls.map((c) => String(c[0])),
      ...mockReplace.mock.calls.map((c) => String(c[0])),
    ].join(' ')
    expect(navTargets).toMatch(/import\/tok_live_1/)
  })

  it('ignores ordinary clipboard text — no resolve, no navigation (privacy)', async () => {
    clipboardText = 'just some copied url https://example.com/article'

    await mountHarness()
    await foreground()

    expect(mockResolveImportCode).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('dedupes: the SAME 口令 on a second foreground does NOT resolve / prompt again', async () => {
    clipboardText = encodeShareToken('AB12CD')
    mockResolveImportCode.mockResolvedValue({ token: 'tok_live_1' })

    await mountHarness()

    // First foreground → handled once.
    await foreground()
    expect(mockResolveImportCode).toHaveBeenCalledTimes(1)
    const pushesAfterFirst = mockPush.mock.calls.length

    // Second foreground with the SAME clipboard content → must NOT re-resolve
    // or re-prompt (last-handled code persisted).
    await foreground()
    expect(mockResolveImportCode).toHaveBeenCalledTimes(1)
    expect(mockPush.mock.calls.length).toBe(pushesAfterFirst)
  })

  it('is INERT when there is no signed-in user: no AppState subscription, no clipboard read', async () => {
    // AppGate mounts this hook for the loading / signed-out states too. Until a
    // user exists it must register NO AppState subscription and do NO clipboard
    // read (which on iOS would surface a paste-permission toast, and resolve
    // would 401 against an unauthenticated session).
    mockUser = null
    clipboardText = encodeShareToken('AB12CD')
    mockResolveImportCode.mockResolvedValue({ token: 'tok_live_1' })

    await mountHarness()

    // No subscription was registered while signed-out → the foreground hot path
    // can never run.
    expect(addEventListenerSpy).not.toHaveBeenCalled()

    // Even if a foreground event somehow fired, nothing happens: no clipboard
    // read, no resolve, no navigation.
    await foreground()
    expect(mockGetStringAsync).not.toHaveBeenCalled()
    expect(mockResolveImportCode).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('does NOT dedupe a code whose resolve fails (404): a fresh token under the same code can still be imported later', async () => {
    clipboardText = encodeShareToken('AB12CD')

    await mountHarness()

    // First foreground: the token is expired → resolve rejects (404). The hook
    // must NOT persist the dedupe marker, so the same code can be retried.
    mockResolveImportCode.mockRejectedValueOnce(new Error('share_gone'))
    await foreground()
    expect(mockResolveImportCode).toHaveBeenCalledTimes(1)
    expect(mockPush).not.toHaveBeenCalled()

    // The sender reshares: the SAME printed importCode now maps to a fresh live
    // token. A later foreground (same clipboard 口令) must resolve AGAIN and
    // navigate — proving the 404 did not permanently dedupe the code.
    mockResolveImportCode.mockResolvedValueOnce({ token: 'tok_fresh' })
    await foreground()
    expect(mockResolveImportCode).toHaveBeenCalledTimes(2)
    const navTargets = [
      ...mockPush.mock.calls.map((c) => String(c[0])),
      ...mockReplace.mock.calls.map((c) => String(c[0])),
    ].join(' ')
    expect(navTargets).toMatch(/import\/tok_fresh/)
  })
})
