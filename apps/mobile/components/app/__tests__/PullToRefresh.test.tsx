/* ============================================================
   Regression tests — pull-to-refresh on mobile tab pages.

   User report: after changing taste data in-app, the mobile tabs had no way to
   refresh their stale data without leaving/restarting the screen. These tests
   pin the contract: each affected ScrollView exposes a RefreshControl, and
   triggering it re-reads the data source that backs that page.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { RefreshControl, ScrollView } from 'react-native'
import { getStats, listTastes, type Stats, type Taste } from '@yon/shared'

import LibraryView from '../LibraryView'
import StatsView from '../StatsView'

function formatMoneyLikeProvider(amount: number | string): string {
  const raw = typeof amount === 'string' ? amount.replace(/[^0-9.]/g, '') : amount
  if (raw === '') return ''
  const value = typeof raw === 'number' ? raw : Number.parseFloat(raw)
  if (!Number.isFinite(value)) return ''
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`
}

const mockFormatMoney = jest.fn((amount: number | string) => formatMoneyLikeProvider(amount))

jest.mock('@yon/shared', () => ({
  FILTERS: ['All', 'Coffee'],
  LANG_CURRENCY: {
    zh: { symbol: '¥', code: 'CNY' },
    en: { symbol: '$', code: 'USD' },
    ko: { symbol: '₩', code: 'KRW' },
    ja: { symbol: '¥', code: 'JPY' },
    es: { symbol: '€', code: 'EUR' },
  },
  getStats: jest.fn(),
  listTastes: jest.fn(),
  getTags: jest.fn().mockResolvedValue([]),
  searchTastes: jest.fn((items: unknown[]) => []),
}))

// LibraryView now uses useTags from _useTags; stub it so the real module-level
// cache doesn't fire getTags concurrently with the listTastes mock.
jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
  clearTagsCache: jest.fn(),
}))

// LibraryView's Nearby-sort plumbing — stubbed so the grid keeps recent order
// and the test never loads expo-location.
jest.mock('@/app/(tabs)/_useUserCoords', () => ({
  useUserCoords: () => null,
  sortByNearest: (items: Array<unknown>) => items.map((item) => ({ item, distance: null })),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}))

// Stub useAuth so RecallView's location useEffect short-circuits immediately
// (locationEnabled is false) — no async IIFE is ever started, so there is no
// in-flight setUserCoords that could fire after environment teardown.
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { warningsEnabled: false, locationEnabled: false } }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    lang: 'en',
    formatMoney: mockFormatMoney,
    t: (key: string, values?: Record<string, unknown>) => {
      if (!values) return key
      if (values.amt) return `${key}:${values.amt}`
      if (values.n != null) return `${key}:${values.n}`
      if (values.q) return `${key}:${values.q}`
      return key
    },
  }),
}))

jest.mock('@/components/ds', () => {
  const React = require('react')

  return {
    Button: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Button', props, children),
    Card: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Card', props, children),
    FoodCard: (props: Record<string, unknown>) =>
      React.createElement('FoodCard', props),
    Icon: (props: Record<string, unknown>) => React.createElement('Icon', props),
    Input: (props: Record<string, unknown>) => React.createElement('Input', props),
    Tag: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('Tag', props, children),
    VerdictStamp: (props: Record<string, unknown>) =>
      React.createElement('VerdictStamp', props),
  }
})

const mockedListTastes = jest.mocked(listTastes)
const mockedGetStats = jest.mocked(getStats)

function taste(overrides: Partial<Taste> = {}): Taste {
  return {
    id: 'taste-1',
    name: 'Espresso',
    place: 'Corner Cafe',
    price: '$4.00',
    status: 'tasted',
    verdict: 'yum',
    tags: ['Coffee'],
    boughtCount: 1,
    warnBeforeBuy: false,
    purchases: [],
    date: 'today',
    notes: '',
    image: '',
    imageThumb: '',
    imageDisplay: '',
    imageKey: '',
    createdAt: '2026-06-08T00:00:00.000Z',
    ...overrides,
  }
}

function stats(overrides: Partial<Stats> = {}): Stats {
  return {
    total: 1,
    yum: 1,
    meh: 0,
    nah: 0,
    savedAmount: '$0.00',
    ...overrides,
  }
}

describe('mobile pull-to-refresh', () => {
  // Each renderer created in a test is stored here so afterEach can clean up.
  const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

  beforeEach(() => {
    jest.clearAllMocks()
    mockFormatMoney.mockImplementation((amount: number | string) => formatMoneyLikeProvider(amount))
    // Fake timers prevent the 250 ms debounce setTimeout (armed on every
    // RecallView mount via useEffect) from firing in real wall-clock time after
    // the test ends. Without fake timers the timer fires after environment
    // teardown on Linux, triggers a React re-render via scheduler setImmediate,
    // and crashes the worker — flipping jest's exit code to 1 even though all
    // assertions passed.
    jest.useFakeTimers()
  })

  afterEach(() => {
    // Each async-act drain turn in render()/drain() causes React's scheduler
    // to queue work via setTimeout(fn,0) — these accumulate as fake timers.
    // Fire ALL of them inside act() so state updates are processed before
    // environment teardown. runAllTimers() covers both scheduler Timeouts and
    // the 250 ms debounce. Unmount after so cleanup (clearTimeout) runs last.
    act(() => { jest.runAllTimers() })
    act(() => { mountedRenderers.forEach((r) => r.unmount()) })
    mountedRenderers.length = 0
    jest.useRealTimers()
  })

  // Drain in-flight async microtask chains (e.g. listTastes resolving →
  // setItems/setLoading state updates). 6 Promise.resolve() turns cover the
  // full chain. Must be called inside fake-timer context (Promise microtasks
  // are not affected by fake timers).
  async function drain() {
    for (let i = 0; i < 6; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await Promise.resolve() })
    }
  }

  async function render(element: React.ReactElement): Promise<TestRenderer.ReactTestRenderer> {
    let renderer!: TestRenderer.ReactTestRenderer
    // Synchronous act() for create (same pattern as RecallViewNearbyTodo which
    // is proven clean on Linux); then drain async microtask chain.
    act(() => { renderer = TestRenderer.create(element) })
    await drain()
    mountedRenderers.push(renderer)
    return renderer
  }

  function refreshControl(renderer: TestRenderer.ReactTestRenderer) {
    const scroll = renderer.root.find((node) => node.type === ScrollView)
    const control = scroll.props.refreshControl

    expect(control).toBeTruthy()
    expect(control.type).toBe(RefreshControl)
    expect(control.props.refreshing).toBe(false)

    return control
  }

  it('refreshes the Your tastes library list from the API', async () => {
    mockedListTastes.mockResolvedValueOnce([taste({ id: 'old', name: 'Old tea' })])
    const renderer = await render(<LibraryView />)

    mockedListTastes.mockResolvedValueOnce([
      taste({ id: 'old', name: 'Old tea' }),
      taste({ id: 'new', name: 'Fresh toast' }),
    ])
    await act(async () => {
      await refreshControl(renderer).props.onRefresh()
    })
    await drain()

    expect(mockedListTastes).toHaveBeenCalledTimes(2)
    const cards = renderer.root.findAll((node) => (node.type as unknown) === 'FoodCard')
    expect(cards).toHaveLength(2)
    expect(
      cards.some((card) => card.props.name === 'Fresh toast')
    ).toBe(true)
  })

  it('refreshes Stats totals and asks the route to refresh taste data', async () => {
    const refreshItems = jest.fn().mockResolvedValue(undefined)
    mockedGetStats.mockResolvedValueOnce(stats({ savedAmount: '$1.00' }))
    const renderer = await render(<StatsView items={[taste()]} onRefresh={refreshItems} />)

    mockedGetStats.mockResolvedValueOnce(stats({ total: 2, yum: 2, savedAmount: '$3.00' }))
    await act(async () => {
      await refreshControl(renderer).props.onRefresh()
    })
    await drain()

    expect(refreshItems).toHaveBeenCalledTimes(1)
    expect(mockedGetStats).toHaveBeenCalledTimes(2)
    expect(mockFormatMoney).toHaveBeenCalledWith(3)
    const symbolNode = renderer.root.find(
      (n) => (n.type as unknown) === 'Text' && n.props.testID === 'saved-currency-symbol',
    )
    expect(symbolNode.props.children).toBe('$')
    const animNode = renderer.root.find(
      (n) => (n.type as unknown) === 'Text' && n.props.testID === 'saved-animated-number',
    )
    expect(animNode.props.children).toBe('3')
  })
})
