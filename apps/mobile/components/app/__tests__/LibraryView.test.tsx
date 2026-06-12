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

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))

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
