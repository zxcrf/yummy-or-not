/* ============================================================
   Tests — S3a "share to friend (importable)" entry in DetailView.

   On top of the existing S1 PNG-card share, S3a adds an importable-share
   action that mints a thin token and appends the deep link + import code to
   the system share text (keeping the PNG card). The 可导入 patch turned the
   single importable-share entry into a TWO-mode picker, so the importable path
   is now reached via share-import-btn → share-mode-importable.

   Pins:
   1. Picking 可导入 calls mintShare(tasteId) and PRINTS the importCode (+ hint)
      on the captured ShareCard — the channel that survives image-only
      forwarding (WeChat strips the deep link).
   2. The owner's raw presigned thumb URL is still never in the shared payload.
   3. The plain (S1) PNG share (share-btn) never prints an import code.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { getTaste, mintShare, type Taste } from '@yon/shared'

import DetailView from '../DetailView'

// ── module mocks (mirror DetailViewShare.test.tsx, plus mintShare) ────────────

jest.mock('@yon/shared', () => {
  // Real encodeShareToken so the importable share writes the ACTUAL 口令 (the
  // 可导入 handler calls it before sharing).
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
    Badge: mk('Badge'), Button: mk('Button'), Card: mk('Card'),
    Icon: mk('Icon'), IconButton: mk('IconButton'), Input: mk('Input'),
    Switch: mk('Switch'), Tag: mk('Tag'), Textarea: mk('Textarea'),
    VerdictPicker: mk('VerdictPicker'), VerdictStamp: mk('VerdictStamp'),
  }
})

// Record the props ShareCard is rendered with. The import code printed on the
// captured PNG is the REAL delivery channel (WeChat strips the deep link from
// forwarded images), so the test asserts the code reaches the card's importCode
// prop at capture time — not merely that it sits in a shareAsync option that is
// not delivered to the recipient.
const shareCardProps: Array<{ importCode?: string; importCodeHint?: string }> = []
jest.mock('@/components/app/ShareCard', () => {
  const React = require('react')
  const { forwardRef } = React
  const ShareCard = forwardRef(
    (p: { importCode?: string; importCodeHint?: string }, ref: React.Ref<unknown>) => {
      shareCardProps.push({ importCode: p.importCode, importCodeHint: p.importCodeHint })
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

function findImportableShareBtn(r: TestRenderer.ReactTestRenderer) {
  return r.root.findAll((n) => n.props?.testID === 'share-import-btn')[0]
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('DetailView importable share (S3a)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    shareCardProps.length = 0
    jest.useFakeTimers()
    routeParams.id = 'taste-1'
  })
  afterEach(() => { jest.useRealTimers() })

  it('mints a token and PRINTS the import code on the ShareCard (the delivered channel)', async () => {
    mockedGetTaste.mockResolvedValueOnce(makeTaste())
    mockedMintShare.mockResolvedValueOnce({
      token: 'tok_abc',
      deepLink: 'yummyornot://import/tok_abc',
      importCode: 'AB12CD',
      expiresAt: null,
    } as Awaited<ReturnType<typeof mintShare>>)

    const r = await renderDetail()
    const { shareAsync } = require('expo-sharing')

    // The share-to-friend entry now opens a TWO-mode picker; pick 可导入.
    const entry = findImportableShareBtn(r)
    expect(entry).toBeTruthy()
    act(() => { entry.props.onPress() })
    const btn = r.root.findAll((n) => n.props?.testID === 'share-mode-importable')[0]
    expect(btn).toBeTruthy()

    await act(async () => {
      btn.props.onPress()
      jest.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedMintShare).toHaveBeenCalledWith('taste-1')
    expect(shareAsync).toHaveBeenCalledTimes(1)

    // DELIVERY CHANNEL: the import code must be PRINTED on the captured PNG so it
    // survives image-only forwarding (WeChat strips the deep link + any
    // shareAsync text option). Assert the code reached the ShareCard at capture
    // time via its importCode prop — i.e. it is on the image, not merely in a
    // non-delivered shareAsync option.
    const printed = shareCardProps.filter((p) => p.importCode === 'AB12CD')
    expect(printed.length).toBeGreaterThanOrEqual(1)
    // The hint that accompanies the printed code is also supplied (already
    // translated) so the recipient knows what the code is for.
    expect(printed[printed.length - 1].importCodeHint).toBeTruthy()

    // The owner's raw presigned thumb URL is still never in the shared payload.
    const callArgs = JSON.stringify(shareAsync.mock.calls[0])
    expect(callArgs).not.toContain('X-Amz-Signature')
    expect(callArgs).not.toContain('presignedtoken')
  })

  it('does NOT print an import code on the plain (仅图片) PNG share', async () => {
    // The pure-PNG path (handleSharePng, reached via 仅图片（无链接）) must never
    // set an import code on the card, so a non-importable share can't
    // accidentally print a stray code. (The old top-level 分享 button was
    // removed — 仅图片 is now the only plain-PNG entry.)
    mockedGetTaste.mockResolvedValueOnce(makeTaste())

    const r = await renderDetail()
    const { shareAsync } = require('expo-sharing')

    const entry = findImportableShareBtn(r)
    act(() => { entry.props.onPress() })
    const plainBtn = r.root.findAll((n) => n.props?.testID === 'share-mode-png')[0]
    expect(plainBtn).toBeTruthy()

    await act(async () => {
      plainBtn.props.onPress()
      jest.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(shareAsync).toHaveBeenCalledTimes(1)
    expect(mockedMintShare).not.toHaveBeenCalled()
    // Every render of the card during the plain share had no importCode.
    expect(shareCardProps.every((p) => !p.importCode)).toBe(true)
  })
})
