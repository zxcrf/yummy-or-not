/* ============================================================
   RED tests — RecallView (回忆 timeline)
   Pins:
   1. Flattening: a taste with N purchases produces N+1 timeline events
      (1 'first' + N 'repurchase').
   2. Sort: events sorted by `at` desc — a newer repurchase outranks an
      older taste's createdAt, even when that taste's createdAt is later.
   3. Group headers: events are bucketed under 今天 / 昨天 / date headers.
   4. Repurchase badge: 'repurchase' events render the "再买" badge.
   5. Only tasted: status='todo' items are NOT included in the timeline.
   6. Empty state: shown when there are no tasted items.
   7. Row tap: router.push('/taste/<id>') is called on row press.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import type { Taste, TastePurchase } from '@yon/shared'

// ---- mock react-native ----------------------------------------------------

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'useWindowDimensions') return () => ({ width: 390, height: 844 })
      if (prop === 'ActivityIndicator') return () => null
      if (prop === 'RefreshControl') return () => null
      return Reflect.get(target, prop, receiver)
    },
  })
})

// ---- mock @yon/shared ------------------------------------------------------

jest.mock('@yon/shared', () => ({}))

// ---- mock _useTastes -------------------------------------------------------

let mockItems: Taste[] = []
jest.mock('@/app/(tabs)/_useTastes', () => ({
  useRefreshableTastes: () => ({ items: mockItems, loading: false, refresh: jest.fn() }),
}))

// ---- mock expo-router ------------------------------------------------------

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// ---- mock I18nProvider -----------------------------------------------------

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        nav_recall: '回忆',
        recall_repurchase_badge: '再买',
        recall_today: '今天',
        recall_yesterday: '昨天',
        recall_empty: '还没有回忆。',
      }
      return map[key] ?? key
    },
    formatMoney: (p: string | number) => `¥${p}`,
  }),
}))

// ---- mock expo-image -------------------------------------------------------

jest.mock('expo-image', () => ({
  Image: ({ testID }: { testID?: string }) => <div data-testid={testID ?? 'expo-image'} />,
}))

// ---- mock ds components ----------------------------------------------------

jest.mock('@/components/ds', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  Screen: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// ---- helpers ---------------------------------------------------------------

function makePurchase(overrides: Partial<TastePurchase> = {}): TastePurchase {
  return {
    id: 'p-1',
    tasteId: 'taste-1',
    price: '15',
    place: 'Shop',
    createdAt: '2026-06-17T09:00:00.000Z',
    ...overrides,
  }
}

function makeTaste(overrides: Partial<Taste> = {}): Taste {
  return {
    id: 'taste-1',
    name: '一点点 芒番了',
    place: '圈外创智中心',
    price: '23',
    status: 'tasted',
    verdict: 'meh',
    tags: [],
    boughtCount: 1,
    warnBeforeBuy: false,
    purchases: [],
    date: 'today',
    notes: '',
    image: '',
    imageThumb: 'https://example.com/thumb.jpg',
    imageDisplay: '',
    imageKey: 'key-1',
    createdAt: '2026-06-16T12:00:00.000Z', // yesterday
    ...overrides,
  }
}

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

afterEach(() => {
  act(() => {
    for (const r of mountedRenderers) {
      try { r.unmount() } catch { /* already unmounted */ }
    }
  })
  mountedRenderers.length = 0
  jest.clearAllMocks()
  mockItems = []
})

async function render() {
  // Lazy-require AFTER mocks are installed so the module sees the mocked deps.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: RecallView } = require('../RecallView') as { default: React.ComponentType }
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<RecallView />)
  })
  mountedRenderers.push(renderer)
  return renderer
}

// ---- tests -----------------------------------------------------------------

describe('RecallView — 回忆 timeline', () => {
  // ---------- 1. Flattening -------------------------------------------------

  it('produces N+1 timeline events for a taste with N purchases', async () => {
    // 1 taste + 2 purchases → 3 events total
    const purchase1 = makePurchase({ id: 'p-1', createdAt: '2026-06-17T09:00:00.000Z' })
    const purchase2 = makePurchase({ id: 'p-2', createdAt: '2026-06-15T14:00:00.000Z' })
    mockItems = [
      makeTaste({
        id: 'taste-a',
        purchases: [purchase1, purchase2],
        boughtCount: 3,
      }),
    ]
    const renderer = await render()

    // Each event gets a testID of the form `recall-row-<tasteId>-<index>`
    // OR we find nodes with data-taste-id attribute.
    // The assertion: there must be exactly 3 recall row nodes for taste-a.
    const rows = renderer.root.findAll(
      (n) => n.props['data-taste-id'] === 'taste-a',
    )
    expect(rows).toHaveLength(3) // 1 first + 2 repurchases
  })

  // ---------- 2. Sort (repurchase outranks older taste's createdAt) ----------

  it('sorts a newer repurchase above an older taste whose createdAt is later', async () => {
    // taste-A: createdAt 2026-06-16T12:00 (yesterday noon), no repurchases
    // taste-B: createdAt 2026-06-15T08:00 (2 days ago), but has a repurchase
    //          at 2026-06-17T10:00 (today) → the repurchase event is NEWEST
    //
    // Expected order (desc by `at`):
    //   taste-B repurchase (2026-06-17T10:00)  ← index 0 in list
    //   taste-A first      (2026-06-16T12:00)  ← index 1
    //   taste-B first      (2026-06-15T08:00)  ← index 2
    //
    // This test fails under a naïve createdAt-only sort because taste-A
    // (createdAt 2026-06-16) would appear before taste-B's repurchase.

    const repurchase = makePurchase({
      id: 'p-b1',
      tasteId: 'taste-b',
      createdAt: '2026-06-17T10:00:00.000Z', // today — NEWER than taste-A's createdAt
    })
    mockItems = [
      makeTaste({
        id: 'taste-a',
        name: 'Taste A',
        createdAt: '2026-06-16T12:00:00.000Z',
        purchases: [],
      }),
      makeTaste({
        id: 'taste-b',
        name: 'Taste B',
        createdAt: '2026-06-15T08:00:00.000Z',
        purchases: [repurchase],
        boughtCount: 2,
      }),
    ]
    const renderer = await render()

    // Collect all recall rows in rendered order.
    const rows = renderer.root.findAll((n) => n.props['data-taste-id'] != null)
    expect(rows.length).toBeGreaterThanOrEqual(3)

    const ids = rows.map((n) => n.props['data-taste-id'] as string)
    // The first row must be taste-b (repurchase at today)
    expect(ids[0]).toBe('taste-b')
    // taste-a's first event (yesterday) comes before taste-b's first (2 days ago)
    const idxA = ids.indexOf('taste-a')
    // Find the LAST occurrence of taste-b (its 'first' event, oldest)
    const lastIdxB = ids.lastIndexOf('taste-b')
    expect(idxA).toBeLessThan(lastIdxB)
  })

  // ---------- 3. Group headers ---------------------------------------------

  it('renders a "今天" group header for events that happened today', async () => {
    // Use an ISO string for "today" by taking current date
    const today = new Date()
    today.setHours(10, 0, 0, 0)
    mockItems = [
      makeTaste({
        id: 'taste-today',
        createdAt: today.toISOString(),
        purchases: [],
      }),
    ]
    const renderer = await render()

    const header = renderer.root.findAll(
      (n) =>
        (typeof n.props.children === 'string' && n.props.children === '今天') ||
        n.props['data-group'] === '今天',
    )
    expect(header.length).toBeGreaterThan(0)
  })

  it('renders a "昨天" group header for events that happened yesterday', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(10, 0, 0, 0)
    mockItems = [
      makeTaste({
        id: 'taste-yesterday',
        createdAt: yesterday.toISOString(),
        purchases: [],
      }),
    ]
    const renderer = await render()

    const header = renderer.root.findAll(
      (n) =>
        (typeof n.props.children === 'string' && n.props.children === '昨天') ||
        n.props['data-group'] === '昨天',
    )
    expect(header.length).toBeGreaterThan(0)
  })

  // ---------- 4. Repurchase badge ------------------------------------------

  it('shows the 再买 badge on repurchase events but NOT on first-time events', async () => {
    const purchase = makePurchase({
      id: 'p-rep',
      tasteId: 'taste-rep',
      createdAt: '2026-06-17T08:00:00.000Z',
    })
    mockItems = [
      makeTaste({
        id: 'taste-rep',
        name: '瑞幸 生椰拿铁',
        createdAt: '2026-06-10T09:00:00.000Z', // older first-time
        purchases: [purchase],
        boughtCount: 2,
      }),
    ]
    const renderer = await render()

    // Find the "再买" badge text nodes
    const badges = renderer.root.findAll(
      (n) =>
        (typeof n.props.children === 'string' && n.props.children === '再买') ||
        n.props['data-badge'] === 'repurchase',
    )
    // Exactly 1 repurchase → exactly 1 badge
    expect(badges).toHaveLength(1)
  })

  // ---------- 5. Only tasted -----------------------------------------------

  it('excludes status=todo items from the timeline', async () => {
    mockItems = [
      makeTaste({ id: 'tasted', name: 'Good Food', status: 'tasted', verdict: 'yum' }),
      makeTaste({ id: 'todo-item', name: 'Want Food', status: 'todo', verdict: null }),
    ]
    const renderer = await render()

    const wantFood = renderer.root.findAll(
      (n) => n.props['data-taste-id'] === 'todo-item',
    )
    expect(wantFood).toHaveLength(0)

    const goodFood = renderer.root.findAll(
      (n) => n.props['data-taste-id'] === 'tasted',
    )
    expect(goodFood.length).toBeGreaterThan(0)
  })

  // ---------- 6. Empty state -----------------------------------------------

  it('shows the empty state when there are no tasted items', async () => {
    mockItems = [
      makeTaste({ id: 'todo-only', status: 'todo', verdict: null }),
    ]
    const renderer = await render()

    const rows = renderer.root.findAll((n) => n.props['data-taste-id'] != null)
    expect(rows).toHaveLength(0)

    const emptyMsg = renderer.root.findAll(
      (n) =>
        (typeof n.props.children === 'string' && n.props.children === '还没有回忆。') ||
        n.props['data-testid'] === 'recall-empty',
    )
    expect(emptyMsg.length).toBeGreaterThan(0)
  })

  // ---------- 7. Row tap ---------------------------------------------------

  it('calls router.push("/taste/<id>") when a row is pressed', async () => {
    mockItems = [
      makeTaste({ id: 'tap-taste', name: 'Tap Me', purchases: [] }),
    ]
    const renderer = await render()

    const row = renderer.root.find((n) => n.props['data-taste-id'] === 'tap-taste')
    act(() => {
      // Support both onPress (RN Pressable) and onClick (web/test-renderer)
      ;(row.props.onPress ?? row.props.onClick)?.()
    })

    expect(mockPush).toHaveBeenCalledWith('/taste/tap-taste')
  })
})
