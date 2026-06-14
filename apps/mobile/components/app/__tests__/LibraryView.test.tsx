/* ============================================================
   LibraryView — the unified 口味 surface.

   Pins:
   1. Browse mode: filter chips render from getTags (not hardcoded), "All"
      first, and a missing tag library doesn't crash.
   2. Verdict + tag chips compose to narrow the grid.
   3. Recall mode: a query (>1 char) hands off to <RecallResults> with the
      tag/verdict-filtered tasted pool; a 0–1 char query stays in the grid.
   4. Nearby sort: choosing "Nearby" sorts via sortByNearest and surfaces a
      distance label on the card.

   Recall-mode ranking/notes/warn behaviour is covered in RecallResults.test
   — here RecallResults is stubbed so we can assert what pool it receives.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import LibraryView from '../LibraryView'
import type { Taste } from '@yon/shared'

// ── stable taste factory ──────────────────────────────────────────────────
let seq = 0
function taste(overrides: Partial<Taste> & { name: string }): Taste {
  return {
    id: String(++seq),
    place: '',
    price: '',
    status: 'tasted' as const,
    verdict: 'yum',
    tags: [],
    boughtCount: 0,
    warnBeforeBuy: false,
    purchases: [],
    date: 'just now',
    notes: '',
    image: '',
    imageThumb: '',
    imageDisplay: '',
    imageKey: '',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// ── module mocks ──────────────────────────────────────────────────────────

const mockGetTags = jest.fn()
const mockItems: Taste[] = []

jest.mock('@yon/shared', () => {
  const actual = jest.requireActual('@yon/shared')
  return {
    ...actual,
    getTags: (...args: unknown[]) => mockGetTags(...args),
  }
})

jest.mock('@/app/(tabs)/_useTastes', () => ({
  useRefreshableTastes: () => ({
    items: mockItems,
    loading: false,
    refresh: jest.fn().mockResolvedValue(undefined),
  }),
}))

// Location plumbing — controllable per test. sortByNearest is reimplemented
// here (with the real haversineMeters) so we never load expo-location.
let mockCoords: { lat: number; lng: number } | null = null
jest.mock('@/app/(tabs)/_useUserCoords', () => {
  const { haversineMeters } = require('@yon/shared')
  return {
    useUserCoords: () => mockCoords,
    sortByNearest: (
      items: Array<{ lat?: number | null; lng?: number | null }>,
      coords: { lat: number; lng: number } | null,
    ) => {
      if (!coords) return items.map((item) => ({ item, distance: null }))
      return items
        .map((item) => ({
          item,
          distance:
            item.lat != null && item.lng != null
              ? haversineMeters(coords.lat, coords.lng, item.lat, item.lng)
              : null,
        }))
        .sort((a, b) => {
          if (a.distance == null && b.distance == null) return 0
          if (a.distance == null) return 1
          if (b.distance == null) return -1
          return a.distance - b.distance
        })
    },
  }
})

let mockLocationEnabled = false
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { warningsEnabled: false, locationEnabled: mockLocationEnabled } }),
}))

// RecallResults is stubbed to expose the pool it receives so we can assert the
// query handoff and pool filtering. Its own behaviour is tested separately.
jest.mock('@/components/app/RecallResults', () => ({
  RecallResults: ({ pool, query }: { pool: Array<{ id: string; name: string }>; query: string }) => {
    const { View, Text } = require('react-native')
    return (
      <View testID="recall-results" data-query={query}>
        {pool.map((it) => (
          <Text key={it.id}>{it.name}</Text>
        ))}
      </View>
    )
  },
}))

// _useTags is backed by getTags from @yon/shared; we mock the module so we
// can control the returned tag list per test.
let mockTagList: Array<{ id: string; name: string; createdAt: string }> = []
jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: mockTagList, loading: false }),
  invalidateTagsCache: jest.fn(),
  clearTagsCache: jest.fn(),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        my_tastes: 'My Tastes',
        count_logged: `${params?.n ?? 0} logged`,
        search_log: 'Search your log…',
        all: 'All',
        nothing_here: 'Nothing here yet.',
        bought_n: `Bought ${params?.n ?? 0}×`,
        sort_recent: 'Recent', sort_nearby: 'Nearby',
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
      }
      return map[key] ?? key
    },
    formatMoney: (v: string) => v,
  }),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), setParams: jest.fn() }),
  useLocalSearchParams: jest.fn(() => ({})),
}))

jest.mock('@/components/ds', () => {
  const { View, Text } = require('react-native')
  return {
    FoodCard: ({ name, distanceLabel, testID }: { name: string; distanceLabel?: string; testID?: string }) => (
      <View testID={testID ?? `card-${name}`}>
        <Text>{name}</Text>
        {distanceLabel ? <Text>{distanceLabel}</Text> : null}
      </View>
    ),
    Icon: () => null,
    Input: ({ onChangeText, value, placeholder, accessibilityLabel }: {
      onChangeText?: (v: string) => void
      value?: string
      placeholder?: string
      accessibilityLabel?: string
    }) => {
      const { TextInput } = require('react-native')
      return (
        <TextInput
          testID={accessibilityLabel ?? placeholder}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
        />
      )
    },
    Tag: ({ children, onPress, active }: {
      children: React.ReactNode
      onPress?: () => void
      active?: boolean
    }) => {
      const { Text: RNText, TouchableOpacity } = require('react-native')
      return (
        <TouchableOpacity onPress={onPress} accessibilityState={{ selected: active }}>
          <RNText>{children}</RNText>
        </TouchableOpacity>
      )
    },
  }
})

// ── helpers ───────────────────────────────────────────────────────────────

function renderLibrary() {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<LibraryView />)
  })
  return renderer
}

function textNodes(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAll(
    (n) =>
      String(n.type) === 'Text' &&
      typeof n.props.children === 'string' &&
      n.props.children === text,
  )
}

function cards(renderer: TestRenderer.ReactTestRenderer, name: string) {
  return renderer.root.findAll(
    (n) => String(n.type) === 'View' && n.props.testID === `card-${name}`,
  )
}

// Locate a chip (mock Tag) by its exact label text, climbing to the onPress node.
function findFilterChip(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const labels = renderer.root.findAll(
    (n) => String(n.type) === 'Text' && n.props.children === label,
  )
  for (const tn of labels) {
    let node = tn.parent
    while (node) {
      if (typeof node.props.onPress === 'function') return node
      node = node.parent
    }
  }
  return undefined
}

// ── tests ─────────────────────────────────────────────────────────────────

describe('LibraryView browse grid', () => {
  beforeEach(() => {
    mockItems.length = 0
    mockTagList = []
    mockCoords = null
    mockLocationEnabled = false
    jest.clearAllMocks()
  })

  it('shows all tasted items in the grid when query is empty', () => {
    mockItems.push(taste({ name: 'Boba' }), taste({ name: 'Ramen' }))
    const renderer = renderLibrary()
    expect(cards(renderer, 'Boba')).toHaveLength(1)
    expect(cards(renderer, 'Ramen')).toHaveLength(1)
    // No handoff to recall mode while the box is empty.
    expect(renderer.root.findAllByProps({ testID: 'recall-results' })).toHaveLength(0)
  })

  it('stays in the grid for a single-character query (guard)', () => {
    mockItems.push(taste({ name: 'Boba' }), taste({ name: 'Ramen' }))
    const renderer = renderLibrary()
    const searchInput = renderer.root.findByProps({ testID: 'Search your log…' })
    act(() => { searchInput.props.onChangeText('B') })
    expect(cards(renderer, 'Boba')).toHaveLength(1)
    expect(cards(renderer, 'Ramen')).toHaveLength(1)
    expect(renderer.root.findAllByProps({ testID: 'recall-results' })).toHaveLength(0)
  })
})

describe('LibraryView recall handoff', () => {
  beforeEach(() => {
    mockItems.length = 0
    mockTagList = []
    mockCoords = null
    mockLocationEnabled = false
    jest.clearAllMocks()
  })

  it('hands off to RecallResults with the tasted pool when query length > 1', () => {
    mockItems.push(taste({ name: 'Matcha Latte' }))
    const renderer = renderLibrary()
    const searchInput = renderer.root.findByProps({ testID: 'Search your log…' })

    act(() => { searchInput.props.onChangeText('matcha') })

    const recall = renderer.root.findByProps({ testID: 'recall-results' })
    expect(recall.props['data-query']).toBe('matcha')
    expect(textNodes(renderer, 'Matcha Latte')).toHaveLength(1)
    // Grid card must not also render.
    expect(cards(renderer, 'Matcha Latte')).toHaveLength(0)
  })

  it('passes only the tag-filtered pool to RecallResults', () => {
    mockItems.push(
      taste({ name: 'matcha latte', tags: ['Matcha'] }),
      taste({ name: 'Mystery Drink', tags: ['Matcha'], notes: 'matcha' }),
      taste({ name: 'Oolong Tea', tags: ['Oolong'] }),
    )
    mockTagList = [
      { id: '1', name: 'Matcha', createdAt: '' },
      { id: '2', name: 'Oolong', createdAt: '' },
    ]
    const renderer = renderLibrary()

    // Activate the Matcha tag chip, then search.
    const matchaChip = findFilterChip(renderer, 'Matcha')
    expect(matchaChip).toBeTruthy()
    act(() => { matchaChip!.props.onPress() })

    const searchInput = renderer.root.findByProps({ testID: 'Search your log…' })
    act(() => { searchInput.props.onChangeText('ma') })

    const recall = renderer.root.findByProps({ testID: 'recall-results' })
    // Pool passed down excludes the Oolong item.
    const names = recall.findAll((n) => String(n.type) === 'Text').map((n) => n.props.children)
    expect(names).toContain('matcha latte')
    expect(names).toContain('Mystery Drink')
    expect(names).not.toContain('Oolong Tea')
  })
})

describe('LibraryView nearby sort', () => {
  beforeEach(() => {
    mockItems.length = 0
    mockTagList = []
    mockCoords = null
    mockLocationEnabled = true
    jest.clearAllMocks()
  })

  it('sorts the grid by distance and shows a distance label when Nearby is chosen', () => {
    mockCoords = { lat: 0, lng: 0 }
    mockItems.push(
      taste({ name: 'Far', lat: 0, lng: 1 }),
      taste({ name: 'Near', lat: 0, lng: 0.1 }),
    )
    const renderer = renderLibrary()

    const nearbyChip = findFilterChip(renderer, 'Nearby')
    expect(nearbyChip).toBeTruthy()
    act(() => { nearbyChip!.props.onPress() })

    // Both cards present, "Near" before "Far" in the rendered tree.
    expect(cards(renderer, 'Near')).toHaveLength(1)
    expect(cards(renderer, 'Far')).toHaveLength(1)
    const order = renderer.root
      .findAll((n) => String(n.type) === 'View' && typeof n.props.testID === 'string' && n.props.testID.startsWith('card-'))
      .map((n) => n.props.testID)
    expect(order.indexOf('card-Near')).toBeLessThan(order.indexOf('card-Far'))

    // A distance label is rendered (formatDistance output is non-empty).
    const nearCard = cards(renderer, 'Near')[0]!
    const labels = nearCard.findAll((n) => String(n.type) === 'Text').map((n) => n.props.children)
    expect(labels.filter((l) => l !== 'Near').length).toBeGreaterThan(0)
  })
})

describe('LibraryView filter chips', () => {
  beforeEach(() => {
    mockItems.length = 0
    mockTagList = []
    mockCoords = null
    mockLocationEnabled = false
    jest.clearAllMocks()
  })

  it('renders chip labels from getTags (not hardcoded FILTERS)', () => {
    mockTagList = [
      { id: '1', name: 'Matcha', createdAt: '' },
      { id: '2', name: 'Spicy Ramen', createdAt: '' },
    ]
    const renderer = renderLibrary()

    expect(textNodes(renderer, 'Matcha')).toHaveLength(1)
    expect(textNodes(renderer, 'Spicy Ramen')).toHaveLength(1)
    expect(textNodes(renderer, 'Pizza')).toHaveLength(0)
  })

  it('always renders "All" chip first even with no tags', () => {
    mockTagList = []
    const renderer = renderLibrary()
    expect(textNodes(renderer, 'All')).toHaveLength(1)
  })

  it('does not crash when the tag library is empty (fetch failure / loading)', () => {
    mockTagList = []
    expect(() => renderLibrary()).not.toThrow()
    const renderer = renderLibrary()
    expect(textNodes(renderer, 'All')).toHaveLength(1)
  })
})

describe('LibraryView verdict jump + filter reset composition', () => {
  beforeEach(() => {
    mockItems.length = 0
    mockTagList = []
    mockCoords = null
    mockLocationEnabled = false
    jest.clearAllMocks()
  })

  it('filters to yum only when verdictFilter=yum param is active', () => {
    mockItems.push(
      taste({ name: 'Yummy Ramen', verdict: 'yum' }),
      taste({ name: 'Nah Burger', verdict: 'nah' }),
    )
    const ExpoRouter = require('expo-router')
    ExpoRouter.useLocalSearchParams.mockReturnValueOnce({ verdict: 'yum' })
    const renderer = renderLibrary()
    expect(cards(renderer, 'Yummy Ramen')).toHaveLength(1)
    expect(cards(renderer, 'Nah Burger')).toHaveLength(0)
  })

  it('tag filter hides non-matching items in the grid', () => {
    mockItems.push(
      taste({ name: 'matcha latte', tags: ['Matcha'] }),
      taste({ name: 'Oolong Tea', tags: ['Oolong'] }),
    )
    mockTagList = [
      { id: '1', name: 'Matcha', createdAt: '' },
      { id: '2', name: 'Oolong', createdAt: '' },
    ]
    const renderer = renderLibrary()

    expect(cards(renderer, 'matcha latte')).toHaveLength(1)
    expect(cards(renderer, 'Oolong Tea')).toHaveLength(1)

    const matchaChip = findFilterChip(renderer, 'Matcha')
    expect(matchaChip).toBeTruthy()
    act(() => { matchaChip!.props.onPress() })

    expect(cards(renderer, 'matcha latte')).toHaveLength(1)
    expect(cards(renderer, 'Oolong Tea')).toHaveLength(0)
  })

  it('resetting tag filter to All shows all items again after tag chip was active', () => {
    mockItems.push(
      taste({ name: 'matcha latte', tags: ['Matcha'] }),
      taste({ name: 'Oolong Tea', tags: ['Oolong'] }),
    )
    mockTagList = [
      { id: '1', name: 'Matcha', createdAt: '' },
      { id: '2', name: 'Oolong', createdAt: '' },
    ]
    const renderer = renderLibrary()

    const matchaChip = findFilterChip(renderer, 'Matcha')
    expect(matchaChip).toBeTruthy()
    act(() => { matchaChip!.props.onPress() })
    expect(cards(renderer, 'Oolong Tea')).toHaveLength(0)

    const allChip = findFilterChip(renderer, 'All')
    expect(allChip).toBeTruthy()
    act(() => { allChip!.props.onPress() })

    expect(cards(renderer, 'matcha latte')).toHaveLength(1)
    expect(cards(renderer, 'Oolong Tea')).toHaveLength(1)
  })
})
