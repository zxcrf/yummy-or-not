/* ============================================================
   Regression test (PR #105 follow-up) — 可导入 share QR capture race.

   Reported bug: the 可导入 share produced a PNG with NEITHER the import code
   text NOR the QR — it was the plain link-free card.

   Root cause (DetailView.handleShareImportable): the readiness race
   (waitForShareCardReady, a 600ms timeout) was started BEFORE the mintShare
   network call. mintShare consumed the 600ms budget, so by the time the handler
   set shareImportCode / shareLandingUrl (which put the QR on the off-screen
   card) and awaited `ready`, the timer had ALREADY resolved. captureRef then
   snapshotted the card BEFORE React committed the QR/import-code re-render →
   the captured PNG was the stale, link-free card.

   This test forces that ordering with fake timers: the 600ms readiness window
   is advanced WHILE mintShare is still pending, then mintShare resolves. It then
   asserts captureRef ran ONLY after the ShareCard carried importCode +
   landingUrl (i.e. the QR-bearing card is the one captured). It FAILS against
   the pre-fix DetailView (capture sees the link-free card → importCode
   undefined) and PASSES after the fix (readiness wait restarted after the
   code/url commit, gated on the QR layout + paint frames).
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { getTaste, mintShare, type Taste } from '@yon/shared'
import { captureRef } from 'react-native-view-shot'

import DetailView from '../DetailView'

jest.mock('@yon/shared', () => {
  const actual = jest.requireActual('@yon/shared')
  return {
    TAG_CHOICES: ['Coffee', 'Dessert'],
    deleteTaste: jest.fn(),
    getTaste: jest.fn(),
    updateTaste: jest.fn(),
    addPurchase: jest.fn(),
    getOriginalPhotoUrl: jest.fn(),
    mintShare: jest.fn(),
    encodeShareToken: actual.encodeShareToken,
    ProRequiredError: class ProRequiredError extends Error {},
  }
})

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  getCachedTaste: jest.fn(() => undefined),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
}))

const mockMarkShareCodeHandled = jest.fn(async (..._a: unknown[]) => {})
jest.mock('@/components/app/shareImportDedupe', () => ({
  markShareCodeHandled: (...a: unknown[]) => mockMarkShareCodeHandled(...a),
}))

const routeParams = { id: 'taste-1' }

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => routeParams,
  useRouter: () => ({ back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    formatMoney: (amount: number | string) => `$${amount}`,
  }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { plan: 'free', warningsEnabled: false } }),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')
  const mk = (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(name, props, children)
  return {
    Badge: mk('Badge'), Button: mk('Button'), Card: mk('Card'),
    Icon: mk('Icon'), IconButton: mk('IconButton'), Input: mk('Input'),
    Switch: mk('Switch'), Tag: mk('Tag'), Textarea: mk('Textarea'),
    VerdictPicker: mk('VerdictPicker'), VerdictStamp: mk('VerdictStamp'),
  }
})

// Mock ShareCard records renders and drives the TWO separate readiness signals:
//   - onReady    : pure-PNG path (photo onLoad or no-photo useEffect)
//   - onQrReady  : 可导入 path only (qrWrap onLayout)
//
// Separation is the whole point of round-3: in the real card these two props
// are completely separate so a photo onLoad can NEVER satisfy the QR wait.
// This mock mirrors that contract:
//   • 可导入 mode (landingUrl present): fires onQrReady, NOT onReady.
//   • pure-PNG mode (no importCode AND no landingUrl): fires onReady, NOT onQrReady.
//
// `mockDelayQrReady`: when true, the mock parks onQrReady in mockShareCardOnQrReady
//   instead of auto-firing it, so tests can drive the layout timing manually.
//   `mockPhotoOnLoad`: fires the photo onLoad / no-photo effect (onReady) manually,
//   simulating what happens during the transitional window before the QR commits.
type CardProps = { importCode?: string; landingUrl?: string }
const mockShareCardRenders: CardProps[] = []
let mockDelayQrReady = false
let mockShareCardOnQrReady: (() => void) | null = null
// Exposed so tests can fire the PNG-path readiness signal (onReady) while
// the QR wait is still pending — this is the transitional-window attack vector.
let mockShareCardOnReady: (() => void) | null = null
jest.mock('@/components/app/ShareCard', () => {
  const React = require('react')
  const { forwardRef, useEffect } = React
  const ShareCard = forwardRef(
    (
      p: {
        importCode?: string
        landingUrl?: string
        onReady?: () => void
        onQrReady?: () => void
      },
      ref: React.Ref<unknown>,
    ) => {
      mockShareCardRenders.push({ importCode: p.importCode, landingUrl: p.landingUrl })
      useEffect(() => {
        if (p.landingUrl) {
          // 可导入 path: drive onQrReady (qrWrap onLayout), never onReady.
          // In the real card these two props are entirely separate so no photo
          // signal can satisfy the QR wait.
          if (mockDelayQrReady) {
            mockShareCardOnQrReady = p.onQrReady ?? null
            // Also park onReady so tests can fire it as the "photo arrived during
            // transitional window" attack — to verify it does NOT resolve the QR wait.
            mockShareCardOnReady = p.onReady ?? null
          } else {
            p.onQrReady?.()
          }
        } else if (!p.importCode) {
          // pure-PNG: drive onReady (photo onLoad / no-photo effect).
          p.onReady?.()
        }
      })
      return React.createElement('View', { ref })
    },
  )
  ShareCard.displayName = 'ShareCard'
  return { ShareCard }
})

function makeTaste(overrides: Partial<Taste> = {}): Taste {
  return {
    id: 'taste-1',
    name: 'Brown Sugar Boba',
    place: 'Tiger Sugar',
    price: '5.80',
    status: 'tasted',
    verdict: 'yum',
    tags: [],
    boughtCount: 1,
    warnBeforeBuy: false,
    purchases: [],
    date: '2026-06-11',
    notes: '',
    image: '',
    imageThumb: 'https://cdn.example.com/thumb.jpg',
    imageDisplay: '',
    imageKey: 'img-key-1',
    createdAt: '2026-06-11T00:00:00.000Z',
    ...overrides,
  }
}

const mockedGetTaste = jest.mocked(getTaste)
const mockedMintShare = jest.mocked(mintShare)
const mockedCaptureRef = jest.mocked(captureRef)

// The props the off-screen card carried at the instant captureRef ran, in
// call order. captureRef is invoked synchronously inside captureAndShare, so
// reading the latest render at that moment tells us which card was snapshotted.
let captureSnapshots: CardProps[]

async function renderDetail(): Promise<TestRenderer.ReactTestRenderer> {
  let r!: TestRenderer.ReactTestRenderer
  await act(async () => { r = TestRenderer.create(<DetailView />) })
  await act(async () => { await Promise.resolve() })
  return r
}

// Flush pending microtasks + timers + animation frames repeatedly so the whole
// async chain (mintShare → setState commit → onReady → rAF paint frames →
// captureRef → shareAsync → marker → clipboard) runs to completion under fake
// timers. requestAnimationFrame is polyfilled onto the timer queue by jest-expo.
async function flushAll(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      jest.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })
  }
}

describe('DetailView 可导入 share — QR capture race (PR #105 follow-up)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockShareCardRenders.length = 0
    mockDelayQrReady = false
    mockShareCardOnQrReady = null
    mockShareCardOnReady = null
    captureSnapshots = []
    jest.useFakeTimers()
    routeParams.id = 'taste-1'
    const { shareAsync } = require('expo-sharing')
    ;(shareAsync as jest.Mock).mockReset()
    ;(shareAsync as jest.Mock).mockResolvedValue(undefined)
    // Snapshot what the off-screen card carried at the instant of capture.
    mockedCaptureRef.mockReset()
    mockedCaptureRef.mockImplementation(async () => {
      const last = mockShareCardRenders[mockShareCardRenders.length - 1]
      captureSnapshots.push(last ? { ...last } : {})
      return 'file:///tmp/share-card-test.png'
    })
  })
  afterEach(() => { jest.useRealTimers() })

  it('captures the QR-bearing card even when the 600ms readiness window elapses while mintShare is still pending', async () => {
    mockedGetTaste.mockResolvedValueOnce(makeTaste())

    // Deferred mintShare: stays pending so the test can advance the 600ms
    // readiness window FIRST (reproducing the pre-fix race where that timer ate
    // the budget before the QR existed), then resolve mintShare.
    let resolveMint!: (v: Awaited<ReturnType<typeof mintShare>>) => void
    mockedMintShare.mockImplementationOnce(
      () => new Promise((resolve) => { resolveMint = resolve }),
    )

    const r = await renderDetail()

    const entry = r.root.findAll((n) => n.props?.testID === 'share-import-btn')[0]
    act(() => { entry.props.onPress() })
    const btn = r.root.findAll((n) => n.props?.testID === 'share-mode-importable')[0]

    // Fire the importable share; mintShare is now pending.
    await act(async () => { btn.props.onPress(); await Promise.resolve() })

    // Burn well past the 600ms readiness fallback WHILE mintShare is pending. In
    // the buggy code the readiness race had already started here, so this timer
    // would have resolved `ready` against the still-link-free card.
    await act(async () => { jest.advanceTimersByTime(2000) })

    // Now the network returns. The fixed handler commits the code/url, THEN
    // starts the readiness wait, THEN captures.
    await act(async () => {
      resolveMint({
        token: 'tok_abc',
        deepLink: 'yummyornot://import/tok_abc',
        importCode: 'AB12CD',
        expiresAt: null,
      } as Awaited<ReturnType<typeof mintShare>>)
      await Promise.resolve()
    })
    await flushAll()

    const { shareAsync } = require('expo-sharing')
    expect(mockedMintShare).toHaveBeenCalledWith('taste-1')
    expect(shareAsync).toHaveBeenCalledTimes(1)

    // captureRef must have run exactly once, and the card it captured MUST have
    // carried BOTH the import code AND the landing URL (the QR). The pre-fix code
    // captured the stale link-free card (importCode/landingUrl undefined).
    expect(captureSnapshots.length).toBe(1)
    expect(captureSnapshots[0].importCode).toBe('AB12CD')
    expect(captureSnapshots[0].landingUrl).toMatch(/\/i\/AB12CD$/)
  })

  it('does NOT capture before QR onLayout fires — 600ms timer must not pre-empt a slow layout', async () => {
    // This test pins BLOCKER 1: the readiness gate for 可导入 must be the actual
    // qrWrap onLayout, not a 600ms timeout that can fire before the QR exists.
    //
    // Scenario: mintShare resolves quickly, but the QR layout stalls (slow
    // device / GC). We advance time past the OLD 600ms window and assert that
    // captureRef has NOT fired yet. Then we release the stalled onLayout and
    // assert capture runs with the QR-bearing card (importCode + landingUrl).
    //
    // With the old code (600ms race): captureRef fires at 600ms → captures the
    // link-free card → this test FAILS (captureSnapshots[0].importCode undefined
    // OR capture happened before we released the layout).
    // With the fixed code (waitForQrReady, 2500ms ceiling): captureRef waits
    // for the actual onLayout → captureSnapshots[0] carries AB12CD → PASSES.
    mockedGetTaste.mockResolvedValueOnce(makeTaste())
    mockedMintShare.mockResolvedValueOnce({
      token: 'tok_abc',
      deepLink: 'yummyornot://import/tok_abc',
      importCode: 'AB12CD',
      expiresAt: null,
    } as Awaited<ReturnType<typeof mintShare>>)

    // Tell the mock to stall onReady for the QR path — simulating a slow layout.
    mockDelayQrReady = true

    const r = await renderDetail()

    const entry = r.root.findAll((n) => n.props?.testID === 'share-import-btn')[0]
    act(() => { entry.props.onPress() })
    const btn = r.root.findAll((n) => n.props?.testID === 'share-mode-importable')[0]

    // Fire the share. mintShare resolves via microtask (mockResolvedValueOnce).
    // In the OLD (pre-fix) code, waitForShareCardReady() with the 600ms timer
    // was called SYNCHRONOUSLY in the handler body BEFORE awaiting mintShare —
    // so the 600ms setTimeout is scheduled at press time.
    // In the FIXED code, waitForQrReady() (2500ms) is called only AFTER mintShare
    // resolves and setState runs — so its timer is scheduled later.
    await act(async () => { btn.props.onPress(); await Promise.resolve() })

    // Flush microtasks only (no timer advance) so mintShare resolves and React
    // commits the QR render — but neither the 600ms (old) nor the 2500ms (new)
    // timer fires yet. The QR layout onReady is stalled (mockDelayQrReady=true).
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    // Advance to 700ms — past the OLD 600ms window but below the new 2500ms
    // ceiling. In the old code the 600ms timer (scheduled at press time) fires
    // here and resolves `ready`, which causes capture to proceed against the
    // stale link-free card. In the fixed code the 2500ms timer (scheduled after
    // mintShare) has not fired → capture MUST NOT have happened yet.
    await act(async () => {
      jest.advanceTimersByTime(700)
      await Promise.resolve()
      await Promise.resolve()
    })

    // Assert capture has NOT happened — the 600ms window elapsed but the QR
    // layout hasn't fired. Fixed code is still waiting for onLayout.
    expect(captureSnapshots.length).toBe(0)

    // Now release the stalled QR layout (simulates onLayout firing on device).
    await act(async () => {
      mockShareCardOnQrReady?.()
      await Promise.resolve()
    })
    // Drain the remaining chain (rAF frames → captureRef → shareAsync).
    // runAllTimers is safe now — the 2500ms timeout fires but we already
    // resolved via onLayout so it's a no-op (Promise.race: first wins).
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        jest.runAllTimers()
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    const { shareAsync } = require('expo-sharing')
    expect(shareAsync).toHaveBeenCalledTimes(1)
    // Capture happened AFTER the QR layout — the card carries the code + QR URL.
    expect(captureSnapshots.length).toBe(1)
    expect(captureSnapshots[0].importCode).toBe('AB12CD')
    expect(captureSnapshots[0].landingUrl).toMatch(/\/i\/AB12CD$/)
  })

  it('transitional-window: photo onLoad (onReady) during QR wait does NOT trigger capture — only onQrReady resolves it', async () => {
    // BLOCKER from round-3 Codex review:
    //
    // Scenario: mintShare resolves, setState fires, React schedules the hasQr=true
    // commit. During the "transitional window" — after waitForQrReady() registers
    // the QR resolver but BEFORE React commits the QR render — the photo's onLoad
    // (or the no-photo useEffect) fires and calls onReady. If shareReadyResolveRef
    // is SHARED between the PNG and QR paths, that photo signal resolves the QR
    // wait early, and captureRef runs against the still-QR-free card.
    //
    // The fix: separate refs (shareReadyResolveRef / shareQrReadyResolveRef) and
    // separate props (onReady / onQrReady). onReady only wires into PNG resolvers;
    // onQrReady only wires into QR resolvers. A photo signal physically cannot
    // satisfy a QR wait.
    //
    // RED: pre-fix code with shared resolver → photo onLoad resolves the QR wait →
    //      captureRef fires before QR layout → captureSnapshots[0].landingUrl
    //      undefined (or capture fires when it should NOT have).
    // GREEN: fixed code with separate refs → photo onLoad calls onReady which
    //        touches shareReadyResolveRef (null during QR path) → no-op → QR wait
    //        stays pending until onQrReady fires.
    mockedGetTaste.mockResolvedValueOnce(makeTaste())
    mockedMintShare.mockResolvedValueOnce({
      token: 'tok_abc',
      deepLink: 'yummyornot://import/tok_abc',
      importCode: 'AB12CD',
      expiresAt: null,
    } as Awaited<ReturnType<typeof mintShare>>)

    // Stall QR layout so we can inject the photo signal in the transitional window.
    mockDelayQrReady = true

    const r = await renderDetail()

    const entry = r.root.findAll((n) => n.props?.testID === 'share-import-btn')[0]
    act(() => { entry.props.onPress() })
    const btn = r.root.findAll((n) => n.props?.testID === 'share-mode-importable')[0]

    await act(async () => { btn.props.onPress(); await Promise.resolve() })

    // Flush microtasks: mintShare resolves, setState runs, waitForQrReady()
    // registers the QR resolver. QR layout is stalled (mockDelayQrReady=true).
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    // The mock also parks onReady in mockShareCardOnReady (the "photo arrived"
    // signal). Now fire it — this is the transitional-window attack: onReady
    // fires during the window where the QR resolver is registered but QR layout
    // hasn't happened yet. With a shared resolver this would early-resolve the
    // QR wait; with separate refs it must be a no-op for the QR path.
    await act(async () => {
      mockShareCardOnReady?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Capture must NOT have happened — the photo signal must not satisfy the QR wait.
    expect(captureSnapshots.length).toBe(0)

    // Now release the actual QR layout. This fires onQrReady → resolves
    // shareQrReadyResolveRef → captureRef proceeds → QR-bearing card captured.
    await act(async () => {
      mockShareCardOnQrReady?.()
      await Promise.resolve()
    })
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        jest.runAllTimers()
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    const { shareAsync } = require('expo-sharing')
    expect(shareAsync).toHaveBeenCalledTimes(1)
    expect(captureSnapshots.length).toBe(1)
    // The card captured AFTER qrWrap onLayout must carry both code and QR URL.
    expect(captureSnapshots[0].importCode).toBe('AB12CD')
    expect(captureSnapshots[0].landingUrl).toMatch(/\/i\/AB12CD$/)
  })

  it('pure-PNG (仅图片) still captures a LINK-FREE card (no importCode, no landingUrl)', async () => {
    mockedGetTaste.mockResolvedValueOnce(makeTaste())

    const r = await renderDetail()

    const entry = r.root.findAll((n) => n.props?.testID === 'share-import-btn')[0]
    act(() => { entry.props.onPress() })
    const plainBtn = r.root.findAll((n) => n.props?.testID === 'share-mode-png')[0]

    await act(async () => { plainBtn.props.onPress(); await Promise.resolve() })
    await flushAll()

    const { shareAsync } = require('expo-sharing')
    expect(mockedMintShare).not.toHaveBeenCalled()
    expect(shareAsync).toHaveBeenCalledTimes(1)
    expect(captureSnapshots.length).toBe(1)
    // The pure-PNG card must NEVER carry a code or a scannable link.
    expect(captureSnapshots[0].importCode).toBeUndefined()
    expect(captureSnapshots[0].landingUrl).toBeUndefined()
  })
})
