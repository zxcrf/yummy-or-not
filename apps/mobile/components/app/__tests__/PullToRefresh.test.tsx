/* ============================================================
   Regression tests — pull-to-refresh on mobile tab pages.

   User report: after changing taste data in-app, the mobile tabs had no way to
   refresh their stale data without leaving/restarting the screen. These tests
   pin the contract: each affected ScrollView exposes a RefreshControl, and
   triggering it re-reads the data source that backs that page.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { RefreshControl } from 'react-native'
import { getStats, listTastes, type Stats, type Taste } from '@yon/shared'

import LibraryView from '../LibraryView'
import RecallView from '../RecallView'
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

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
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
    verdict: 'yum',
    tags: ['Coffee'],
    boughtCount: 1,
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

async function render(element: React.ReactElement): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(element)
  })
  return renderer
}

function refreshControl(renderer: TestRenderer.ReactTestRenderer) {
  const scroll = renderer.root.find((node) => (node.type as unknown) === 'ScrollView')
  const control = scroll.props.refreshControl

  expect(control).toBeTruthy()
  expect(control.type).toBe(RefreshControl)
  expect(control.props.refreshing).toBe(false)

  return control
}

function textContent(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAll((node) => typeof node.children[0] === 'string')
    .map((node) => node.children.join(''))
    .join('\n')
}

describe('mobile pull-to-refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFormatMoney.mockImplementation((amount: number | string) => formatMoneyLikeProvider(amount))
  })

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

    expect(mockedListTastes).toHaveBeenCalledTimes(2)
    const cards = renderer.root.findAll((node) => (node.type as unknown) === 'FoodCard')
    expect(cards).toHaveLength(2)
    expect(
      cards.some((card) => card.props.name === 'Fresh toast')
    ).toBe(true)
  })

  it('refreshes Recall search data from the API', async () => {
    mockedListTastes.mockResolvedValueOnce([taste({ id: 'old', name: 'Old tea' })])
    const renderer = await render(<RecallView />)

    mockedListTastes.mockResolvedValueOnce([
      taste({ id: 'old', name: 'Old tea' }),
      taste({ id: 'new', name: 'Fresh toast' }),
    ])
    await act(async () => {
      await refreshControl(renderer).props.onRefresh()
    })

    expect(mockedListTastes).toHaveBeenCalledTimes(2)
    expect(textContent(renderer)).toContain('Fresh toast')
  })

  it('refreshes Stats totals and asks the route to refresh taste data', async () => {
    const refreshItems = jest.fn().mockResolvedValue(undefined)
    mockedGetStats.mockResolvedValueOnce(stats({ savedAmount: '$1.00' }))
    const renderer = await render(<StatsView items={[taste()]} onRefresh={refreshItems} />)

    mockedGetStats.mockResolvedValueOnce(stats({ total: 2, yum: 2, savedAmount: '$3.00' }))
    await act(async () => {
      await refreshControl(renderer).props.onRefresh()
    })

    expect(refreshItems).toHaveBeenCalledTimes(1)
    expect(mockedGetStats).toHaveBeenCalledTimes(2)
    expect(mockFormatMoney).toHaveBeenCalledWith(3)
    expect(textContent(renderer)).toContain('saved_amt:$3')
  })
})
