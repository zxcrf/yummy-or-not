/* ============================================================
   Test — S3a 可导入: the QR printed on the share card must encode a URL that
   points at a route the server actually serves.

   The card renders a QR encoding landingUrlForCode(importCode). The server
   serves GET /i/<importCode> (apps/api/src/app/i/[code]/route.ts) and the deep
   link is yummyornot://import/<token>. The QR must therefore be the /i/<code>
   path — NOT a /api/... path and NOT a bare host. This test captures the
   landingUrl prop handed to ShareCard during an importable share and pins its
   shape so a regression that points the QR at a 404 fails here.

   (The companion ShareCardQr.test.tsx pins that ShareCard renders the QR from
   landingUrl; this pins that DetailView feeds it the correct /i/<code> value.)
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
    ConfirmSheet: () => null,
    Badge: mk('Badge'), Button: mk('Button'), Card: mk('Card'),
    Icon: mk('Icon'), IconButton: mk('IconButton'), Input: mk('Input'),
    Switch: mk('Switch'), Tag: mk('Tag'), Textarea: mk('Textarea'),
    VerdictPicker: mk('VerdictPicker'), VerdictStamp: mk('VerdictStamp'),
  }
})

// Record the landingUrl handed to ShareCard so we can assert the QR target.
const shareCardLandingUrls: Array<string | undefined> = []
jest.mock('@/components/app/ShareCard', () => {
  const React = require('react')
  const { forwardRef } = React
  const ShareCard = forwardRef(
    (p: { landingUrl?: string }, ref: React.Ref<unknown>) => {
      shareCardLandingUrls.push(p.landingUrl)
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

async function renderDetail(): Promise<TestRenderer.ReactTestRenderer> {
  let r!: TestRenderer.ReactTestRenderer
  await act(async () => { r = TestRenderer.create(<DetailView />) })
  await act(async () => { await Promise.resolve() })
  return r
}

describe('DetailView 可导入 QR target', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    shareCardLandingUrls.length = 0
    jest.useFakeTimers()
    routeParams.id = 'taste-1'
  })
  afterEach(() => { jest.useRealTimers() })

  it('feeds ShareCard a /i/<importCode> landing URL (the served route), not a /api or bare-host URL', async () => {
    mockedGetTaste.mockResolvedValueOnce(makeTaste())
    mockedMintShare.mockResolvedValueOnce({
      token: 'tok_abc',
      deepLink: 'yummyornot://import/tok_abc',
      importCode: 'AB12CD',
      expiresAt: null,
    } as Awaited<ReturnType<typeof mintShare>>)

    const r = await renderDetail()

    const entry = r.root.findAll((n) => n.props?.testID === 'share-import-btn')[0]
    act(() => { entry.props.onPress() })
    const btn = r.root.findAll((n) => n.props?.testID === 'share-mode-importable')[0]

    await act(async () => {
      btn.props.onPress()
      jest.runAllTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    const landed = shareCardLandingUrls.filter((u): u is string => !!u)
    expect(landed.length).toBeGreaterThanOrEqual(1)
    const url = landed[landed.length - 1]
    // The QR target MUST be the served /i/<code> path (matches the API route
    // apps/api/src/app/i/[code]/route.ts). A regression that points it at
    // /api/... or omits the /i/ segment would land on a 404.
    expect(url).toMatch(/\/i\/AB12CD$/)
    expect(url).not.toContain('/api/')
  })
})
