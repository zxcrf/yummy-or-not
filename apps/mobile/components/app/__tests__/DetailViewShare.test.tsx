/* ============================================================
   Regression tests — A1 share card entry in DetailView.

   Pins:
   1. Pressing Share calls captureRef then shareAsync with a file:// tmpfile
      path — the presigned query string never appears in the shared payload.
   2. shareAsync rejection → share_failed alert shown; sharing state resets
      (button re-enabled).
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import { getTaste, type Taste } from '@yon/shared'

import DetailView from '../DetailView'

// ── module mocks ────────────────────────────────────────────────────────────

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: ['Coffee', 'Dessert'],
  deleteTaste: jest.fn(),
  getTaste: jest.fn(),
  updateTaste: jest.fn(),
  addPurchase: jest.fn(),
  getOriginalPhotoUrl: jest.fn(),
  ProRequiredError: class ProRequiredError extends Error {},
}))

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  getCachedTaste: jest.fn(() => undefined),
}))

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'taste-1' }),
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
      if (values.n != null) return `${key}:${values.n}`
      return key
    },
    formatMoney: (amount: number | string) => {
      const n = typeof amount === 'number'
        ? amount
        : Number.parseFloat(String(amount).replace(/[^0-9.]/g, ''))
      if (!Number.isFinite(n)) return ''
      return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
    },
  }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { plan: 'free', warningsEnabled: false } }),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')
  return {
    Badge: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Badge', props, children),
    Button: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Button', props, children),
    Card: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Card', props, children),
    Icon: (props: Record<string, unknown>) => React.createElement('Icon', props),
    IconButton: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('IconButton', props, children),
    Input: (props: Record<string, unknown>) => React.createElement('Input', props),
    Switch: (props: Record<string, unknown>) => React.createElement('Switch', props),
    Tag: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Tag', props, children),
    Textarea: (props: Record<string, unknown>) => React.createElement('Textarea', props),
    VerdictPicker: (props: Record<string, unknown>) =>
      React.createElement('VerdictPicker', props),
    VerdictStamp: (props: Record<string, unknown>) =>
      React.createElement('VerdictStamp', props),
  }
})

// ShareCard rendered off-screen — stub to a simple View so captureRef has a target
jest.mock('@/components/app/ShareCard', () => {
  const React = require('react')
  const { forwardRef } = React
  const ShareCard = forwardRef((_props: unknown, ref: React.Ref<unknown>) =>
    React.createElement('View', { ref }),
  )
  ShareCard.displayName = 'ShareCard'
  return { ShareCard }
})

// ── test data ────────────────────────────────────────────────────────────────

function makeTaste(overrides: Partial<Taste> = {}): Taste {
  return {
    id: 'taste-1',
    name: 'Brown Sugar Boba',
    place: 'Tiger Sugar',
    price: '5.80',
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

// ── helpers ──────────────────────────────────────────────────────────────────

const mockedGetTaste = jest.mocked(getTaste)

async function renderDetail(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<DetailView />)
  })
  return renderer
}

function findShareButton(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    (node) => (node.type as unknown) === 'Button' && node.props.testID === 'share-btn',
  )[0]
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('DetailView share (A1)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('pressing Share calls captureRef then shareAsync with a file:// path; presigned query string never in shared payload', async () => {
    mockedGetTaste.mockResolvedValueOnce(makeTaste())
    const renderer = await renderDetail()

    const { captureRef } = require('react-native-view-shot')
    const { shareAsync } = require('expo-sharing')

    const shareBtn = findShareButton(renderer)
    expect(shareBtn).toBeTruthy()

    // Press share — starts async flow (600ms timer fires inside handleShare)
    await act(async () => {
      shareBtn.props.onPress()
      jest.runAllTimers()
    })

    // captureRef must have been called
    expect(captureRef).toHaveBeenCalledTimes(1)

    // shareAsync must have been called with the file:// tmpfile path
    expect(shareAsync).toHaveBeenCalledTimes(1)
    const [sharedUri] = shareAsync.mock.calls[0] as [string, ...unknown[]]
    expect(sharedUri).toMatch(/^file:\/\//)

    // The presigned query string must NOT appear in the shared URI
    expect(sharedUri).not.toMatch(/X-Amz-Signature/)
    expect(sharedUri).not.toMatch(/presignedtoken/)
  })

  it('shareAsync rejection → share_failed alert shown and button re-enabled', async () => {
    mockedGetTaste.mockResolvedValueOnce(makeTaste())
    const renderer = await renderDetail()

    const { shareAsync } = require('expo-sharing')
    shareAsync.mockRejectedValueOnce(new Error('user cancelled'))

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {})

    const shareBtn = findShareButton(renderer)

    await act(async () => {
      shareBtn.props.onPress()
      jest.runAllTimers()
    })

    // Alert must have been shown with share_failed key
    expect(alertSpy).toHaveBeenCalledWith('share_failed')

    // Button should be re-enabled (disabled=false or disabled not set)
    const shareBtnAfter = findShareButton(renderer)
    expect(shareBtnAfter?.props.disabled).toBeFalsy()

    alertSpy.mockRestore()
  })
})
