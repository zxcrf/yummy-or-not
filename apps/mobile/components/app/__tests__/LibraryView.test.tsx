/* ============================================================
   LibraryView — search and filter chip regression tests.

   Pins:
   1. Notes-content search hit: old substring filter (name/place only) could
      not find items matched only in notes — the card never rendered.
   2. Ranked order: a name-match item appears before a notes-only match.
   3. Filter chips render from mocked getTags (not hardcoded FILTERS).
   4. Tag fetch failure doesn't crash the view — only "All" chip shows.
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
        your_tastes: 'Your tastes',
        count_logged: `${params?.n ?? 0} logged`,
        search_log: 'Search your log…',
        all: 'All',
        nothing_here: 'Nothing here yet.',
        bought_n: `Bought ${params?.n ?? 0}×`,
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
    FoodCard: ({ name, testID }: { name: string; testID?: string }) => (
      <View testID={testID ?? `card-${name}`}><Text>{name}</Text></View>
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

// ── tests ─────────────────────────────────────────────────────────────────

describe('LibraryView search', () => {
  beforeEach(() => {
    mockItems.length = 0
    mockTagList = []
    jest.clearAllMocks()
  })

  it('renders a card when the query matches only the notes field (regression: old filter missed notes)', () => {
    // Old code: it.name.toLowerCase().includes(query) || it.place…
    // — notes was never checked, so this item would never render.
    mockItems.push(
      taste({ name: 'Mystery Drink', place: 'Café X', notes: 'jasmine flavor' }),
    )
    const renderer = renderLibrary()
    const searchInput = renderer.root.findByProps({ testID: 'Search your log…' })

    act(() => { searchInput.props.onChangeText('jasmine') })

    expect(textNodes(renderer, 'Mystery Drink')).toHaveLength(1)
  })

  it('ranks name-match above notes-only match', () => {
    // nameItem: "latte" in name → strong tier.
    // notesItem: "latte" only in notes → lower weighted score.
    mockItems.push(
      taste({ name: 'latte macchiato', notes: '' }),
      taste({ name: 'Random Drink', notes: 'tastes like a latte' }),
    )
    const renderer = renderLibrary()
    const searchInput = renderer.root.findByProps({ testID: 'Search your log…' })

    act(() => { searchInput.props.onChangeText('latte') })

    // Both cards must appear.
    expect(textNodes(renderer, 'latte macchiato')).toHaveLength(1)
    expect(textNodes(renderer, 'Random Drink')).toHaveLength(1)

    // Name-match must come first in the rendered tree.
    const allText = renderer.root
      .findAll((n) => String(n.type) === 'Text' && typeof n.props.children === 'string')
      .map((n) => n.props.children as string)
    const nameIdx = allText.indexOf('latte macchiato')
    const notesIdx = allText.indexOf('Random Drink')
    expect(nameIdx).toBeLessThan(notesIdx)
  })

  it('shows all items (unordered) when query is empty', () => {
    mockItems.push(taste({ name: 'Boba' }), taste({ name: 'Ramen' }))
    const renderer = renderLibrary()

    expect(textNodes(renderer, 'Boba')).toHaveLength(1)
    expect(textNodes(renderer, 'Ramen')).toHaveLength(1)
  })

  it('shows all items when query is a single character (guard)', () => {
    mockItems.push(taste({ name: 'Boba' }), taste({ name: 'Ramen' }))
    const renderer = renderLibrary()
    const searchInput = renderer.root.findByProps({ testID: 'Search your log…' })

    act(() => { searchInput.props.onChangeText('B') })

    expect(textNodes(renderer, 'Boba')).toHaveLength(1)
    expect(textNodes(renderer, 'Ramen')).toHaveLength(1)
  })
})

describe('LibraryView filter chips', () => {
  beforeEach(() => {
    mockItems.length = 0
    mockTagList = []
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
    // Legacy hardcoded chips that are NOT in the tag library must not appear.
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

// Helper: find a filter chip (mock Tag) by its exact label text.
// The mock Tag renders as a node with onPress + accessibilityState.selected.
// In the test renderer, react-native's TouchableOpacity renders as a host
// View-like node. We locate the chip by finding Text nodes with the label
// and then climbing to the nearest ancestor that carries an onPress handler.
function findFilterChip(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const textNodes = renderer.root.findAll(
    (n) => String(n.type) === 'Text' && n.props.children === label,
  )
  for (const tn of textNodes) {
    let node = tn.parent
    while (node) {
      if (typeof node.props.onPress === 'function') return node
      node = node.parent
    }
  }
  return undefined
}

describe('LibraryView verdict jump + filter reset composition', () => {
  beforeEach(() => {
    mockItems.length = 0
    mockTagList = []
    jest.clearAllMocks()
  })

  it('filters to yum only when verdictFilter=yum param is active', () => {
    mockItems.push(
      taste({ name: 'Yummy Ramen', verdict: 'yum' }),
      taste({ name: 'Nah Burger', verdict: 'nah' }),
    )
    // Override the module-level mock to inject an active verdictFilter param.
    const ExpoRouter = require('expo-router')
    ExpoRouter.useLocalSearchParams.mockReturnValueOnce({ verdict: 'yum' })
    const renderer = renderLibrary()
    // Only the yum item should be visible; nah item must be hidden.
    expect(textNodes(renderer, 'Yummy Ramen')).toHaveLength(1)
    expect(textNodes(renderer, 'Nah Burger')).toHaveLength(0)
  })

  it('search ranking composes with tag filter: non-matching tag hides items', () => {
    // Two items tagged 'Matcha'; one Oolong item tagged 'Oolong'.
    // After pressing the Matcha chip, the Oolong item must not appear.
    mockItems.push(
      taste({ name: 'matcha latte', tags: ['Matcha'], notes: '' }),
      taste({ name: 'Mystery Drink', tags: ['Matcha'], notes: 'tastes like matcha' }),
      taste({ name: 'Oolong Tea', tags: ['Oolong'], notes: '' }),
    )
    mockTagList = [
      { id: '1', name: 'Matcha', createdAt: '' },
      { id: '2', name: 'Oolong', createdAt: '' },
    ]
    const renderer = renderLibrary()

    // Before any filter, all three appear.
    expect(textNodes(renderer, 'matcha latte')).toHaveLength(1)
    expect(textNodes(renderer, 'Mystery Drink')).toHaveLength(1)
    expect(textNodes(renderer, 'Oolong Tea')).toHaveLength(1)

    // Press the 'Matcha' tag chip.
    const matchaChip = findFilterChip(renderer, 'Matcha')
    expect(matchaChip).toBeTruthy()
    act(() => { matchaChip!.props.onPress() })

    // Only Matcha-tagged items remain.
    expect(textNodes(renderer, 'matcha latte')).toHaveLength(1)
    expect(textNodes(renderer, 'Mystery Drink')).toHaveLength(1)
    expect(textNodes(renderer, 'Oolong Tea')).toHaveLength(0)
  })

  it('search query ranks name-match above notes-only match within active tag filter', () => {
    mockItems.push(
      taste({ name: 'matcha latte', tags: ['Matcha'], notes: '' }),
      taste({ name: 'Mystery Drink', tags: ['Matcha'], notes: 'tastes like matcha' }),
    )
    mockTagList = [{ id: '1', name: 'Matcha', createdAt: '' }]
    const renderer = renderLibrary()

    // Press Matcha chip to activate tag filter.
    const matchaChip = findFilterChip(renderer, 'Matcha')
    expect(matchaChip).toBeTruthy()
    act(() => { matchaChip!.props.onPress() })

    // Type a search query.
    const searchInput = renderer.root.findByProps({ testID: 'Search your log…' })
    act(() => { searchInput.props.onChangeText('matcha') })

    // Both should appear.
    expect(textNodes(renderer, 'matcha latte')).toHaveLength(1)
    expect(textNodes(renderer, 'Mystery Drink')).toHaveLength(1)

    // Name-match should come first.
    const allText = renderer.root
      .findAll((n) => String(n.type) === 'Text' && typeof n.props.children === 'string')
      .map((n) => n.props.children as string)
    const nameIdx = allText.indexOf('matcha latte')
    const notesIdx = allText.indexOf('Mystery Drink')
    expect(nameIdx).toBeLessThan(notesIdx)
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

    // Activate Matcha filter.
    const matchaChip = findFilterChip(renderer, 'Matcha')
    expect(matchaChip).toBeTruthy()
    act(() => { matchaChip!.props.onPress() })
    expect(textNodes(renderer, 'Oolong Tea')).toHaveLength(0)

    // Press All chip to reset.
    const allChip = findFilterChip(renderer, 'All')
    expect(allChip).toBeTruthy()
    act(() => { allChip!.props.onPress() })

    expect(textNodes(renderer, 'matcha latte')).toHaveLength(1)
    expect(textNodes(renderer, 'Oolong Tea')).toHaveLength(1)
  })
})
