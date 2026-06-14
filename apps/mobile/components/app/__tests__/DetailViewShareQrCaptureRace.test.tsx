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

// Mock ShareCard so we can drive the readiness signal (onReady) the way the
// real card does, AND record the props it rendered with so the capture
// assertion can check what the captured card actually contained:
//   • 可导入 mode (landingUrl present): the real card fires onReady from the QR's
//     onLayout. We mirror that — onReady fires (via effect) ONLY once landingUrl
//     is present, so a premature link-free render never resolves readiness.
//   • pure-PNG mode (no importCode AND no landingUrl): the real card fires
//     onReady from the image onLoad / no-photo path. We mirror that too.
// The first importable mount is link-free (code/url not set until mintShare
// resolves); it must NOT fire onReady, matching the fixed handler which only
// registers the readiness resolver AFTER the code/url commit.
type CardProps = { importCode?: string; landingUrl?: string }
const mockShareCardRenders: CardProps[] = []
jest.mock('@/components/app/ShareCard', () => {
  const React = require('react')
  const { forwardRef, useEffect } = React
  const ShareCard = forwardRef(
    (
      p: { importCode?: string; landingUrl?: string; onReady?: () => void },
      ref: React.Ref<unknown>,
    ) => {
      mockShareCardRenders.push({ importCode: p.importCode, landingUrl: p.landingUrl })
      useEffect(() => {
        if (p.landingUrl) p.onReady?.() // 可导入: QR onLayout gate
        else if (!p.importCode) p.onReady?.() // pure-PNG: image onLoad gate
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
