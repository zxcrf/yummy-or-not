/* ============================================================
   Tests — S3a 可导入 (淘口令) patch: TWO explicit share modes in DetailView.

   The patch upgrades the single importable-share entry into a user-picked
   choice between:
     • pure-PNG mode  (testID 'share-mode-png')        — existing behavior:
       ShareCard → captureRef → shareAsync. NO 口令 to clipboard, NO link.
     • 可导入 mode    (testID 'share-mode-importable') — mints a token, writes a
       collision-resistant 口令 (encodeShareToken(importCode)) to the clipboard
       (expo-clipboard) AND into the system share text, prints the code + QR on
       the PNG.

   Pins behavior NOT yet implemented → FAIL now, PASS after the patch:
   1. The share picker offers BOTH modes (both testIDs present).
   2. 可导入 mode: mints, writes the 口令 to the clipboard (expo-clipboard mock
      asserted) AND the 口令 is in the share text passed to shareAsync.
   3. pure-PNG mode: writes NO token to the clipboard, and the card gets NO
      importCode (privacy regression guard — a pure image must stay link-free).
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { getTaste, mintShare, encodeShareToken, type Taste } from '@yon/shared'

import DetailView from '../DetailView'

// expo-clipboard is mapped (via jest.config moduleNameMapper) to a stub whose
// setStringAsync is a jest.fn — we require it to assert the 口令 is written.
const { setStringAsync: mockSetStringAsync } = require('expo-clipboard')

// ── shared: real codec, mocked network ────────────────────────────────────────
jest.mock('@yon/shared', () => {
  // Real encodeShareToken so the test asserts the ACTUAL 口令 wrapping, not a
  // stand-in. parseShareToken kept real too for symmetry.
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
    parseShareToken: actual.parseShareToken,
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

const routeParams = { id: 'taste-1' }

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => routeParams,
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    replace: jest.fn(),
  }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (!values) return key
      return `${key}:${JSON.stringify(values)}`
    },
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
    ConfirmSheet: () => null,
    Badge: mk('Badge'), Button: mk('Button'), Card: mk('Card'),
    Icon: mk('Icon'), IconButton: mk('IconButton'), Input: mk('Input'),
    Switch: mk('Switch'), Tag: mk('Tag'), Textarea: mk('Textarea'),
    VerdictPicker: mk('VerdictPicker'), VerdictStamp: mk('VerdictStamp'),
  }
})

// Record the props ShareCard is rendered with across the whole share flow.
const shareCardProps: Array<{ importCode?: string; landingUrl?: string }> = []
jest.mock('@/components/app/ShareCard', () => {
  const React = require('react')
  const { forwardRef } = React
  const ShareCard = forwardRef(
    (p: { importCode?: string; landingUrl?: string }, ref: React.Ref<unknown>) => {
      shareCardProps.push({ importCode: p.importCode, landingUrl: p.landingUrl })
      return React.createElement('View', { ref })
    },
  )
  ShareCard.displayName = 'ShareCard'
  return { ShareCard }
})

// ── test data ──────────────────────────────────────────────────────────────────

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
    imageThumb: 'https://cdn.example.com/thumb.jpg?X-Amz-Signature=presignedtoken',
    imageDisplay: '',
    imageKey: 'img-key-1',
    createdAt: '2026-06-11T00:00:00.000Z',
    ...overrides,
  }
}

const mockedGetTaste = jest.mocked(getTaste)
const mockedMintShare = jest.mocked(mintShare)

async function renderDetail(): Promise<TestRenderer.ReactTestRenderer> {
  let r!: TestRenderer.ReactTestRenderer
  await act(async () => { r = TestRenderer.create(<DetailView />) })
  await act(async () => { await Promise.resolve() })
  return r
}

function byTestID(r: TestRenderer.ReactTestRenderer, id: string) {
  return r.root.findAll((n) => n.props?.testID === id)[0]
}

// Open the share-mode picker (the existing importable-share entry now opens a
// choice between the two modes).
function openSharePicker(r: TestRenderer.ReactTestRenderer) {
  const entry = byTestID(r, 'share-import-btn')
  expect(entry).toBeTruthy()
  act(() => { entry.props.onPress() })
}

describe('DetailView share modes (S3a 可导入 patch)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    shareCardProps.length = 0
    mockSetStringAsync.mockClear()
    jest.useFakeTimers()
    routeParams.id = 'taste-1'
  })
  afterEach(() => { jest.useRealTimers() })

  it('the share picker offers BOTH modes (pure-PNG and 可导入)', async () => {
    mockedGetTaste.mockResolvedValueOnce(makeTaste())
    const r = await renderDetail()

    openSharePicker(r)

    expect(byTestID(r, 'share-mode-png')).toBeTruthy()
    expect(byTestID(r, 'share-mode-importable')).toBeTruthy()
  })

  it('可导入 mode writes the 口令 to the clipboard AND into the share text', async () => {
    mockedGetTaste.mockResolvedValueOnce(makeTaste())
    mockedMintShare.mockResolvedValueOnce({
      token: 'tok_abc',
      deepLink: 'yummyornot://import/tok_abc',
      importCode: 'AB12CD',
      expiresAt: null,
    } as Awaited<ReturnType<typeof mintShare>>)

    const r = await renderDetail()
    const { shareAsync } = require('expo-sharing')

    openSharePicker(r)
    const importable = byTestID(r, 'share-mode-importable')
    expect(importable).toBeTruthy()

    // Fire the share, then drain the async chain in a loop. The fixed handler
    // commits the import code / QR, then waits the readiness signal + a couple
    // of rAF "paint" frames before capturing, so the chain needs several
    // interleaved timer + microtask passes to complete under fake timers.
    await act(async () => { importable.props.onPress(); await Promise.resolve() })
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        jest.runAllTimers()
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    expect(mockedMintShare).toHaveBeenCalledWith('taste-1')

    const expectedToken = encodeShareToken('AB12CD')

    // CLIPBOARD: the 口令 (delimited, wrapping the importCode) is copied so the
    // recipient can paste it and the app auto-detects it on foreground.
    expect(mockSetStringAsync).toHaveBeenCalledTimes(1)
    const clipboardArg = String(mockSetStringAsync.mock.calls[0][0])
    expect(clipboardArg).toContain(expectedToken)

    // SHARE TEXT: the same 口令 also rides the system share sheet text.
    expect(shareAsync).toHaveBeenCalledTimes(1)
    const shareCallStr = JSON.stringify(shareAsync.mock.calls[0])
    expect(shareCallStr).toContain(expectedToken)

    // The owner's raw presigned thumb URL is still never in the payload.
    expect(shareCallStr).not.toContain('X-Amz-Signature')
    expect(shareCallStr).not.toContain('presignedtoken')
  })

  it('pure-PNG mode writes NO token to the clipboard and the card stays link-free', async () => {
    mockedGetTaste.mockResolvedValueOnce(makeTaste())

    const r = await renderDetail()
    const { shareAsync } = require('expo-sharing')

    openSharePicker(r)
    const png = byTestID(r, 'share-mode-png')
    expect(png).toBeTruthy()

    await act(async () => {
      png.props.onPress()
      jest.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Shared the PNG, but minted nothing and copied nothing.
    expect(shareAsync).toHaveBeenCalledTimes(1)
    expect(mockedMintShare).not.toHaveBeenCalled()
    expect(mockSetStringAsync).not.toHaveBeenCalled()

    // Privacy regression guard: every render of the card during the pure-PNG
    // share had NO importCode and NO landingUrl (no QR / no link on the image).
    expect(shareCardProps.every((p) => !p.importCode)).toBe(true)
    expect(shareCardProps.every((p) => !p.landingUrl)).toBe(true)
  })
})
