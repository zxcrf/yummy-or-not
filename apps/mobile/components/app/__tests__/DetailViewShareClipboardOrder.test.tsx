/* ============================================================
   Test — S3a 可导入: the sender's 口令 must NOT leak into their own clipboard
   when the share does not complete.

   Bug: Clipboard.setStringAsync(passphrase) was awaited BEFORE captureAndShare.
   If the system share sheet failed/threw, the 口令 was already on the sender's
   clipboard — and the sender's app would auto-import it on next foreground
   (useShareTokenImport) even though nothing was actually shared.

   Fix: write the clipboard ONLY after captureAndShare resolves. These tests pin:
     • share throws  → setStringAsync NOT called (no clipboard pollution)
     • share resolves → setStringAsync called, and AFTER shareAsync (order)
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { getTaste, mintShare, type Taste } from '@yon/shared'

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

jest.mock('@/components/app/ShareCard', () => {
  const React = require('react')
  const { forwardRef } = React
  const ShareCard = forwardRef((_p: unknown, ref: React.Ref<unknown>) =>
    React.createElement('View', { ref }),
  )
  ShareCard.displayName = 'ShareCard'
  return { ShareCard }
})

// Spy on the self-import marker so the order test can assert it commits BEFORE
// the clipboard write (so a foreground can never read the 口令 with a stale
// dedupe set).
const mockMarkShareCodeHandled = jest.fn((..._a: unknown[]) => Promise.resolve())
jest.mock('@/components/app/shareImportDedupe', () => ({
  markShareCodeHandled: (...a: unknown[]) => mockMarkShareCodeHandled(...a),
}))

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

async function renderDetail(): Promise<TestRenderer.ReactTestRenderer> {
  let r!: TestRenderer.ReactTestRenderer
  await act(async () => { r = TestRenderer.create(<DetailView />) })
  await act(async () => { await Promise.resolve() })
  return r
}

async function pickImportable(r: TestRenderer.ReactTestRenderer) {
  const entry = r.root.findAll((n) => n.props?.testID === 'share-import-btn')[0]
  act(() => { entry.props.onPress() })
  const btn = r.root.findAll((n) => n.props?.testID === 'share-mode-importable')[0]
  await act(async () => {
    btn.props.onPress()
    jest.runAllTimers()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('DetailView 可导入 clipboard order', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    routeParams.id = 'taste-1'
    const { setStringAsync } = require('expo-clipboard')
    const { shareAsync } = require('expo-sharing')
    ;(setStringAsync as jest.Mock).mockClear()
    ;(shareAsync as jest.Mock).mockReset()
    ;(shareAsync as jest.Mock).mockResolvedValue(undefined)
  })
  afterEach(() => { jest.useRealTimers() })

  it('does NOT write the 口令 to the clipboard when the share fails', async () => {
    mockedGetTaste.mockResolvedValueOnce(makeTaste())
    mockedMintShare.mockResolvedValueOnce({
      token: 'tok_abc',
      deepLink: 'yummyornot://import/tok_abc',
      importCode: 'AB12CD',
      expiresAt: null,
    } as Awaited<ReturnType<typeof mintShare>>)

    const { shareAsync } = require('expo-sharing')
    const { setStringAsync } = require('expo-clipboard')
    // The system share sheet rejects (e.g. user cancel surfaced as a throw, or
    // a capture/share failure).
    ;(shareAsync as jest.Mock).mockRejectedValueOnce(new Error('share cancelled'))

    const r = await renderDetail()
    await pickImportable(r)

    expect(mockedMintShare).toHaveBeenCalledWith('taste-1')
    // The 口令 must NOT have escaped into the sender's own clipboard.
    expect(setStringAsync).not.toHaveBeenCalled()
  })

  it('writes the 口令 to the clipboard only AFTER the share resolves', async () => {
    mockedGetTaste.mockResolvedValueOnce(makeTaste())
    mockedMintShare.mockResolvedValueOnce({
      token: 'tok_abc',
      deepLink: 'yummyornot://import/tok_abc',
      importCode: 'AB12CD',
      expiresAt: null,
    } as Awaited<ReturnType<typeof mintShare>>)

    const { shareAsync } = require('expo-sharing')
    const { setStringAsync } = require('expo-clipboard')

    // Record call order: share runs first, then the self-import marker COMMITS,
    // then the 口令 is written to the clipboard. Marking before the clipboard
    // write closes the race where a foreground reads the 口令 before the dedupe
    // set has it (→ sender self-imports their own taste).
    const order: string[] = []
    ;(shareAsync as jest.Mock).mockImplementation(async () => { order.push('share') })
    mockMarkShareCodeHandled.mockImplementation(async () => { order.push('mark') })
    ;(setStringAsync as jest.Mock).mockImplementation(async () => { order.push('clipboard'); return true })

    const r = await renderDetail()
    await pickImportable(r)

    expect(shareAsync).toHaveBeenCalledTimes(1)
    expect(mockMarkShareCodeHandled).toHaveBeenCalledWith('AB12CD')
    expect(setStringAsync).toHaveBeenCalledTimes(1)
    // The marker is persisted AFTER the share completes but BEFORE the 口令
    // reaches the clipboard.
    expect(order).toEqual(['share', 'mark', 'clipboard'])
  })
})
