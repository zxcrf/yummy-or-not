/* ============================================================
   Regression tests — RecallView Location L2 "nearby eaten" group.
   Verifies: group renders sorted nearest-first with distance labels
   when locationEnabled + granted; group absent when permission denied.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import RecallView from '../RecallView'

// ---- mock react-native --------------------------------------------------

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'useWindowDimensions') return () => ({ width: 390, height: 744, scale: 2, fontScale: 2 })
      return Reflect.get(target, prop, receiver)
    },
  })
})

// ---- mock shared --------------------------------------------------------

jest.mock('@yon/shared', () => ({
  searchTastes: jest.fn(() => []),
  haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
    const R = 6_371_000
    const toRad = (d: number) => (d * Math.PI) / 180
    const dLat = toRad(bLat - aLat)
    const dLng = toRad(bLng - aLng)
    const sinDLat = Math.sin(dLat / 2)
    const sinDLng = Math.sin(dLng / 2)
    const a2 = sinDLat * sinDLat + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * sinDLng * sinDLng
    return 2 * R * Math.asin(Math.sqrt(a2))
  },
  formatDistance(meters: number): string {
    if (meters < 1000) return `${Math.round(meters)} m`
    return `${(meters / 1000).toFixed(1)} km`
  },
}))

// ---- mock _useTastes ----------------------------------------------------

let mockItems: Array<Record<string, unknown>> = []
jest.mock('@/app/(tabs)/_useTastes', () => ({
  useRefreshableTastes: () => ({ items: mockItems, refresh: jest.fn() }),
}))

// ---- mock useAuth -------------------------------------------------------

let mockUser: { warningsEnabled: boolean; locationEnabled: boolean } | null = null
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser }),
}))

// ---- mock expo-router ---------------------------------------------------

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

// ---- mock expo-location -------------------------------------------------

type PermResult = { granted: boolean }
type PosResult = { coords: { latitude: number; longitude: number } }

let mockPermission: PermResult = { granted: true }
let mockPosition: PosResult = { coords: { latitude: 35.0, longitude: 139.0 } }
let mockLocationError: Error | null = null

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: async () => {
    if (mockLocationError) throw mockLocationError
    return mockPermission
  },
  getCurrentPositionAsync: async () => {
    if (mockLocationError) throw mockLocationError
    return mockPosition
  },
}))

// ---- mock i18n ----------------------------------------------------------

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const map: Record<string, string> = {
        recall_title: 'Tasted it before?',
        recall_sub: 'Search before you spend.',
        recall_placeholder: 'Try matcha…',
        recently_recalled: 'Recently recalled',
        nearby_eaten: 'Eaten nearby',
        verdict_on_file: 'Verdict on file',
        loved_it: 'You loved it',
        soso: 'It was so-so',
        skip_it: 'You said skip it',
        no_record: params ? `No record of "${params.q}".` : 'No record.',
        try_then_log: 'Try it, then log.',
        log_it_now: 'Log it now',
        recall_other_matches: 'Other matches',
        recall_warn_skip: 'You marked this ×_× NAH last time — skip it',
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
      }
      return map[key] ?? key
    },
  }),
}))

// ---- mock ds components -------------------------------------------------

jest.mock('@/components/ds', () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  Card: ({ children, variant, padded }: { children: React.ReactNode; variant?: string; padded?: boolean }) => (
    <div data-variant={variant} data-padded={padded}>{children}</div>
  ),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  Input: ({ value, onChangeText, placeholder }: { value: string; onChangeText: (t: string) => void; placeholder?: string }) => (
    <input value={value} onChange={(e) => onChangeText(e.target.value)} placeholder={placeholder} />
  ),
  VerdictStamp: ({ verdict, label }: { verdict: string; label: string }) => (
    <span data-verdict={verdict}>{label}</span>
  ),
}))

// ---- mock expo-image ----------------------------------------------------

jest.mock('expo-image', () => ({ Image: () => null }))

// ---- helpers ------------------------------------------------------------

function taste(overrides: Partial<{
  id: string; name: string; place: string; verdict: string;
  warnBeforeBuy: boolean; date: string; lat: number | null; lng: number | null;
}>): Record<string, unknown> {
  return {
    id: 'id-1', name: 'Matcha latte', place: 'Starbucks',
    verdict: 'yum', warnBeforeBuy: false, date: '2 days ago',
    imageThumb: '', image: '', imageKey: '', notes: '', tags: [],
    boughtCount: 1, price: '', purchases: [], createdAt: '', imageDisplay: '',
    lat: null, lng: null,
    ...overrides,
  }
}

function textNodes(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAll(
    (node) =>
      String(node.type) === 'Text' &&
      typeof node.props.children === 'string' &&
      node.props.children === text,
  )
}

// ---- tests --------------------------------------------------------------

describe('RecallView nearby_eaten group', () => {
  // Each renderer created in a test is stored here so afterEach can clean up.
  const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

  beforeEach(() => {
    jest.clearAllMocks()
    // Fake timers prevent the 250 ms debounce setTimeout (armed on every
    // RecallView mount) from firing in real wall-clock time after the test
    // ends. Without fake timers the timer fires after environment teardown on
    // Linux, triggers a React re-render via scheduler setImmediate, and hits
    // the torn-down module Proxy — crashing the worker and flipping jest's
    // exit code to 1 even though all assertions passed.
    jest.useFakeTimers()
    mockUser = { warningsEnabled: false, locationEnabled: true }
    mockItems = []
    mockPermission = { granted: true }
    mockLocationError = null
    mockPosition = { coords: { latitude: 35.0, longitude: 139.0 } }
  })

  afterEach(() => {
    // Each async-act drain turn during renderRecallView() causes React's
    // scheduler to queue work via setTimeout(fn,0) — these accumulate as fake
    // timers (7 pending after 6 drain turns). We must fire ALL of them inside
    // act() so the resulting state updates are processed synchronously before
    // environment teardown. runAllTimers() covers both scheduler Timeouts and
    // the 250 ms debounce. Unmount after so cleanup (clearTimeout) runs last.
    act(() => { jest.runAllTimers() })
    act(() => { mountedRenderers.forEach((r) => r.unmount()) })
    mountedRenderers.length = 0
    jest.useRealTimers()
  })

  // Create a RecallView renderer and drain the async location effect chain:
  //   requestForegroundPermissionsAsync (1 await)
  //   → getCurrentPositionAsync / Promise.race (1 await)
  //   → setUserCoords → React scheduler setImmediate → re-render
  // Using synchronous act() for create (same pattern as RecallViewNearbyTodo)
  // then 6 × "await act(async () => Promise.resolve())" drains each microtask
  // step plus the scheduler setImmediate that React queues for the state update.
  async function renderRecallView() {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => { renderer = TestRenderer.create(<RecallView />) })
    for (let i = 0; i < 6; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await Promise.resolve() })
    }
    mountedRenderers.push(renderer)
    return renderer
  }

  it('renders nearby group sorted nearest-first with distance labels when permission granted and items have coords', async () => {
    // near item: 35.001, 139.0 (~111 m away)
    // far item: 35.01, 139.0 (~1111 m away)
    const near = taste({ id: 'near', name: 'Near Ramen', lat: 35.001, lng: 139.0 })
    const far = taste({ id: 'far', name: 'Far Sushi', lat: 35.01, lng: 139.0 })
    mockItems = [far, near] as never[] // intentionally reversed to test sort

    const renderer = await renderRecallView()

    // Nearby group header must appear
    expect(textNodes(renderer, 'Eaten nearby')).toHaveLength(1)

    // Both items appear in the tree
    const nearNodes = renderer.root.findAll((n) => String(n.type) === 'Text' && n.props.children === 'Near Ramen')
    const farNodes = renderer.root.findAll((n) => String(n.type) === 'Text' && n.props.children === 'Far Sushi')
    expect(nearNodes.length).toBeGreaterThan(0)
    expect(farNodes.length).toBeGreaterThan(0)

    // Distance labels appear (format: "NNN m" or "N.N km")
    const distanceLabels = renderer.root.findAll(
      (n) => String(n.type) === 'Text' && /^\d+(\.\d)? ?(m|km)$/.test(String(n.props.children)),
    )
    expect(distanceLabels.length).toBeGreaterThanOrEqual(2)

    // Sort order: Near Ramen must appear before Far Sushi in the rendered tree
    const allTextNodes = renderer.root.findAll((n) => String(n.type) === 'Text' && typeof n.props.children === 'string')
    const nearIdx = allTextNodes.findIndex((n) => n.props.children === 'Near Ramen')
    const farIdx = allTextNodes.findIndex((n) => n.props.children === 'Far Sushi')
    expect(nearIdx).toBeLessThan(farIdx)
  })

  it('does NOT render nearby group when permission is denied; recently_recalled still shows', async () => {
    mockPermission = { granted: false }
    const item = taste({ id: 'a', name: 'Boba', lat: 35.001, lng: 139.0 })
    mockItems = [item] as never[]

    const renderer = await renderRecallView()

    expect(textNodes(renderer, 'Eaten nearby')).toHaveLength(0)
    expect(textNodes(renderer, 'Recently recalled')).toHaveLength(1)
  })

  it('does NOT render nearby group when locationEnabled is false', async () => {
    mockUser = { warningsEnabled: false, locationEnabled: false }
    const item = taste({ id: 'b', name: 'Boba', lat: 35.001, lng: 139.0 })
    mockItems = [item] as never[]

    // locationEnabled=false so the location useEffect returns immediately —
    // no async chain to drain; synchronous act() is sufficient.
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => { renderer = TestRenderer.create(<RecallView />) })
    mountedRenderers.push(renderer)

    expect(textNodes(renderer, 'Eaten nearby')).toHaveLength(0)
    expect(textNodes(renderer, 'Recently recalled')).toHaveLength(1)
  })

  it('does NOT render nearby group when items have no coords even with permission', async () => {
    const item = taste({ id: 'c', name: 'Boba', lat: null, lng: null })
    mockItems = [item] as never[]

    const renderer = await renderRecallView()

    expect(textNodes(renderer, 'Eaten nearby')).toHaveLength(0)
    expect(textNodes(renderer, 'Recently recalled')).toHaveLength(1)
  })
})
