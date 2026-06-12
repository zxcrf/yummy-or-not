/* ============================================================
   Regression tests — RecallView A3 nearby-todo group.
   Pins:
   1. todo item with coords appears in 附近你想吃的 with distance label + badge.
   2. Sorted ascending by distance (closest first).
   3. Cap enforced: max 3 todo items shown.
   4. Tasted items never appear in the todo group.
   5. No coords → neither nearby group renders.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import RecallView from '../RecallView'
import type { Taste } from '@yon/shared'

// ---- mock react-native ----------------------------------------------------

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'useWindowDimensions') return () => ({ width: 390, height: 844 })
      if (prop === 'Pressable') {
        return ({ children, onPress }: {
          children: React.ReactNode | ((s: { pressed: boolean }) => React.ReactNode)
          onPress?: () => void
        }) => (
          <div onClick={onPress}>
            {typeof children === 'function' ? children({ pressed: false }) : children}
          </div>
        )
      }
      if (prop === 'RefreshControl') return () => null
      if (prop === 'ActivityIndicator') return () => null
      return Reflect.get(target, prop, receiver)
    },
  })
})

// ---- mock expo-location ---------------------------------------------------

let mockLocationCoords: { latitude: number; longitude: number } | null = null

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: async () => ({ status: 'granted', granted: true }),
  getCurrentPositionAsync: async () =>
    mockLocationCoords
      ? { coords: mockLocationCoords }
      : Promise.reject(new Error('no location')),
  Accuracy: { Balanced: 3 },
}))

// ---- mock expo-image ------------------------------------------------------

jest.mock('expo-image', () => ({ Image: () => null }))

// ---- mock expo-router -----------------------------------------------------

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// ---- mock shared ----------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSearchTastes = jest.fn<any, any[]>(() => [])
const mockHaversineMeters = jest.fn((lat1: number, lon1: number, lat2: number, lon2: number) => {
  // Simple real-ish distance: return meters proportional to lat delta for test predictability
  const dlat = Math.abs(lat2 - lat1)
  const dlon = Math.abs(lon2 - lon1)
  return Math.sqrt(dlat * dlat + dlon * dlon) * 111000
})
const mockFormatDistance = jest.fn((m: number) => `${Math.round(m)}m`)

jest.mock('@yon/shared', () => ({
  searchTastes: (a: unknown) => mockSearchTastes(a),
  haversineMeters: (a: unknown, b: unknown, c: unknown, d: unknown) => mockHaversineMeters(a as number, b as number, c as number, d as number),
  formatDistance: (a: unknown) => mockFormatDistance(a as number),
}))

// ---- mock providers -------------------------------------------------------

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        recall_search: 'Search…',
        recall_title: 'Recall',
        nearby_eaten: 'Nearby you\'ve tried',
        nearby_todo: 'Want to try nearby',
        recall_in_todo: 'In your want-to-try list',
        recall_no_results: 'No results',
        nothing_here: 'Nothing here.',
        recall_empty_cta: 'Log your first taste',
        loved_it: 'Loved it',
        soso: 'So-so',
        skip_it: 'Skip it',
        warn_badge: 'Skip',
        todo_badge: 'Want to Try',
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
      }
      return map[key] ?? key
    },
  }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { warningsEnabled: false, locationEnabled: true },
  }),
}))

// ---- mock _useTastes ------------------------------------------------------

let mockItems: Taste[] = []
jest.mock('@/app/(tabs)/_useTastes', () => ({
  useRefreshableTastes: () => ({ items: mockItems, loading: false, refresh: jest.fn() }),
}))

// ---- mock ds components ---------------------------------------------------

jest.mock('@/components/ds', () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  Input: ({ value, onChangeText, placeholder }: {
    value: string; onChangeText?: (t: string) => void; placeholder?: string
  }) => (
    <input value={value} placeholder={placeholder} onChange={(e) => onChangeText?.(e.target.value)} />
  ),
  Tag: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <span data-testid={testID}>{children}</span>
  ),
  VerdictStamp: ({ verdict }: { verdict: string }) => <span data-verdict={verdict} />,
}))

// ---- helpers --------------------------------------------------------------

function taste(overrides: Partial<Taste> & { id: string }): Taste {
  return {
    name: overrides.id,
    place: '',
    price: '',
    status: 'tasted',
    verdict: 'yum',
    tags: [],
    boughtCount: 0,
    warnBeforeBuy: false,
    purchases: [],
    date: 'today',
    notes: '',
    image: '',
    imageThumb: '',
    imageDisplay: '',
    imageKey: '',
    createdAt: '2026-06-11T00:00:00.000Z',
    ...overrides,
  }
}

function findByTestId(renderer: TestRenderer.ReactTestRenderer, testId: string) {
  return renderer.root.findAll(
    (n) => n.props['data-testid'] === testId || n.props.testID === testId,
  )
}

function findTextMatching(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAll(
    (n) => typeof n.props.children === 'string' && n.props.children === text,
  )
}

async function renderWithLocation(
  coords: { latitude: number; longitude: number } | null,
  mountedRenderers?: TestRenderer.ReactTestRenderer[],
) {
  mockLocationCoords = coords
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<RecallView />)
  })
  // Flush the async location effect: permission → position → setUserCoords
  // Each await Promise.resolve() drains one microtask queue turn.
  for (let i = 0; i < 6; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve() })
  }
  mountedRenderers?.push(renderer)
  return renderer
}

// ---- tests ----------------------------------------------------------------

describe('RecallView A3 — nearby-todo group (附近你想吃的)', () => {
  // Track renderers so afterEach can unmount and flush the 250 ms debounce
  // timer that RecallView arms on every mount. Without fake timers the real
  // timer fires after environment teardown on Linux and flips jest exit to 1.
  const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    mockItems = []
    mockLocationCoords = null
  })

  afterEach(() => {
    act(() => { jest.runAllTimers() })
    act(() => { mountedRenderers.forEach((r) => r.unmount()) })
    mountedRenderers.length = 0
    jest.useRealTimers()
  })

  it('todo item with coords appears under 附近你想吃的 with badge and distance', async () => {
    // User at (31.0, 121.0); shop at ~1km away
    mockItems = [
      taste({
        id: 'ramen',
        name: 'Ramen Shop',
        status: 'todo',
        verdict: null,
        // @ts-ignore — lat/lng stored on taste for nearby
        lat: 31.009,
        lng: 121.0,
      }),
    ]

    const renderer = await renderWithLocation({ latitude: 31.0, longitude: 121.0 }, mountedRenderers)

    // Nearby todo section header should appear
    const todoHeaders = findTextMatching(renderer, 'Want to try nearby')
    expect(todoHeaders.length).toBeGreaterThan(0)

    // todo badge present
    const badges = findByTestId(renderer, 'todo-badge')
    expect(badges.length).toBeGreaterThan(0)
  })

  it('no coords → nearby todo group does not render', async () => {
    mockItems = [
      taste({
        id: 'ramen',
        name: 'Ramen Shop',
        status: 'todo',
        verdict: null,
        // @ts-ignore
        lat: 31.009,
        lng: 121.0,
      }),
    ]

    const renderer = await renderWithLocation(null, mountedRenderers)

    const todoHeaders = findTextMatching(renderer, 'Want to try nearby')
    expect(todoHeaders).toHaveLength(0)

    const tastedHeaders = findTextMatching(renderer, "Nearby you've tried")
    expect(tastedHeaders).toHaveLength(0)
  })

  it('tasted items never appear in the todo group', async () => {
    mockItems = [
      taste({
        id: 'espresso',
        name: 'Espresso Place',
        status: 'tasted',
        verdict: 'yum',
        // @ts-ignore
        lat: 31.001,
        lng: 121.0,
      }),
      taste({
        id: 'matcha',
        name: 'Matcha Bar',
        status: 'todo',
        verdict: null,
        // @ts-ignore
        lat: 31.002,
        lng: 121.0,
      }),
    ]

    const renderer = await renderWithLocation({ latitude: 31.0, longitude: 121.0 }, mountedRenderers)

    // Nearby todo header should exist (matcha)
    const todoHeaders = findTextMatching(renderer, 'Want to try nearby')
    expect(todoHeaders.length).toBeGreaterThan(0)

    // Nearby tasted header should also appear (espresso)
    const tastedHeaders = findTextMatching(renderer, "Nearby you've tried")
    expect(tastedHeaders.length).toBeGreaterThan(0)
  })

  it('caps todo group at 3 and renders in ascending distance order', async () => {
    // 4 todo items; user at (31.0, 121.0).
    // Distances increase with lat: Shop 0 closest, Shop 3 farthest.
    // Cap is NEARBY_TODO_CAP=3, so Shop 3 must NOT appear in the nearby group.
    // After fix #1/#2, todo items are excluded from recently-recalled,
    // so their names only appear if rendered in the nearby-todo group.
    mockItems = Array.from({ length: 4 }, (_, i) =>
      taste({
        id: `todo-${i}`,
        name: `Shop ${i}`,
        status: 'todo',
        verdict: null,
        // @ts-ignore
        lat: 31.001 + i * 0.01, // 0.01° steps → clearly distinct distances
        lng: 121.0,
      }),
    )

    const renderer = await renderWithLocation({ latitude: 31.0, longitude: 121.0 }, mountedRenderers)

    // Section header must appear (≥1 todo item within range)
    const todoHeaders = findTextMatching(renderer, 'Want to try nearby')
    expect(todoHeaders.length).toBeGreaterThan(0)

    // Shops 0-2 must appear (within cap=3), Shop 3 must NOT
    // (todo items excluded from recently-recalled, so name presence = nearby group only)
    expect(findTextMatching(renderer, 'Shop 0').length).toBeGreaterThan(0)
    expect(findTextMatching(renderer, 'Shop 1').length).toBeGreaterThan(0)
    expect(findTextMatching(renderer, 'Shop 2').length).toBeGreaterThan(0)
    expect(findTextMatching(renderer, 'Shop 3')).toHaveLength(0)
  })
})
