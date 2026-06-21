/* ============================================================
   LibraryView — recent sort by last-activity (RED test, plan 1)

   Pins the fix for: recent sort must use
     max(createdAt, purchases[0]?.createdAt)
   not just createdAt alone.

   Scenario:
     - itemOld:  created 1 month ago, repurchased TODAY
     - itemNew:  created 1 week ago, no purchases

   Expected order under last-activity sort: [itemOld, itemNew]
   (itemOld's purchase timestamp > itemNew's createdAt)

   This test FAILS against the current code (createdAt-only sort)
   which puts itemNew first.
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
    boughtCount: 1,
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

// ── module mocks (mirror LibraryView.test.tsx boilerplate) ────────────────

const mockItems: Taste[] = []

jest.mock('@yon/shared', () => {
  const actual = jest.requireActual('@yon/shared')
  return { ...actual }
})

jest.mock('@/app/(tabs)/_useTastes', () => {
  const actual = jest.requireActual('@/app/(tabs)/_useTastes')
  return {
    ...actual,
    useRefreshableTastes: () => ({
      items: mockItems,
      loading: false,
      refresh: jest.fn().mockResolvedValue(undefined),
    }),
  }
})

jest.mock('@/app/(tabs)/_useActiveTaster', () => ({
  useActiveTaster: () => null,
}))

jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({ tasters: [], loading: false }),
}))

jest.mock('@/app/(tabs)/_useUserCoords', () => {
  const { haversineMeters } = require('@yon/shared')
  return {
    useUserCoords: () => null,
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

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { warningsEnabled: false, locationEnabled: false } }),
}))

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

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
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
        sort_recent: 'Recent',
        sort_nearby: 'Nearby',
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
        yum: 'YUM', meh: 'MEH', nah: 'NAH',
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
    FoodCard: ({ name }: { name: string }) => (
      <View testID={`card-${name}`}>
        <Text>{name}</Text>
      </View>
    ),
    Badge: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
      <View testID={testID}><Text>{children}</Text></View>
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

function cardOrder(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll(
      (n) =>
        String(n.type) === 'View' &&
        typeof n.props.testID === 'string' &&
        (n.props.testID as string).startsWith('card-'),
    )
    .map((n) => n.props.testID as string)
}

// ── tests ─────────────────────────────────────────────────────────────────

describe('LibraryView recent sort — last-activity (plan 1 regression)', () => {
  beforeEach(() => {
    mockItems.length = 0
    seq = 0
    jest.clearAllMocks()
  })

  afterEach(() => {
    mockItems.length = 0
  })

  /**
   * THE pinned regression:
   *
   * itemOld  → createdAt = 30 days ago, repurchased today
   *            lastActivity = today  (should be FIRST)
   *
   * itemNew  → createdAt = 7 days ago, no purchases
   *            lastActivity = 7 days ago (should be SECOND)
   *
   * Under the current createdAt-only sort, itemNew (7 days ago) sorts above
   * itemOld (30 days ago), which is the BUG.
   * After the fix (max(createdAt, purchases[0]?.createdAt)), itemOld sorts first.
   */
  it('puts a repurchased old item above a newer-created but never-repurchased item', () => {
    const now = new Date()

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const sevenDaysAgo  = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000).toISOString()
    const todayIso      = now.toISOString()

    // itemOld: created 30 days ago, has a purchase made today
    const itemOld = taste({
      name: 'Old Repurchased Ramen',
      createdAt: thirtyDaysAgo,
      boughtCount: 2,
      purchases: [
        {
          id: 'p1',
          tasteId: '1',
          price: null,
          place: null,
          createdAt: todayIso,   // repurchased TODAY
        },
      ],
    })

    // itemNew: created 7 days ago, no repurchases
    const itemNew = taste({
      name: 'New Boba',
      createdAt: sevenDaysAgo,
      boughtCount: 1,
      purchases: [],
    })

    mockItems.push(itemOld, itemNew)

    const renderer = renderLibrary()
    const order = cardOrder(renderer)

    // Both cards must be present
    expect(order).toContain('card-Old Repurchased Ramen')
    expect(order).toContain('card-New Boba')

    // itemOld's last-activity (today) > itemNew's last-activity (7 days ago),
    // so itemOld MUST appear first in the recent-sort grid.
    // This assertion FAILS under the current createdAt-only sort.
    expect(order.indexOf('card-Old Repurchased Ramen')).toBeLessThan(
      order.indexOf('card-New Boba'),
    )
  })

  /**
   * Sanity / golden path: an item with no purchases sorts by its createdAt —
   * no regression on the common case.
   */
  it('sorts two items with no purchases by createdAt desc (golden path)', () => {
    const now = new Date()
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()
    const tenDaysAgo  = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString()

    mockItems.push(
      taste({ name: 'Older Item', createdAt: tenDaysAgo,  purchases: [] }),
      taste({ name: 'Newer Item', createdAt: fiveDaysAgo, purchases: [] }),
    )

    const renderer = renderLibrary()
    const order = cardOrder(renderer)

    expect(order.indexOf('card-Newer Item')).toBeLessThan(
      order.indexOf('card-Older Item'),
    )
  })
})
