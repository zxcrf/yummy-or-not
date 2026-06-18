/* ============================================================
   RED tests — LibraryView todo-dropdown (plan 2: fold 想吃 into title).

   Pins:
   (a) Selecting 想吃 from the title dropdown filters the list to
       status==='todo' ONLY — tasted items disappear, todo items appear.
   (b) The "想吃 N" count in the dropdown equals the current taster's
       todo count (not the global count, not the tasted count).
   (c) The 想吃 empty state (bookmark icon + nothing_here text) renders
       when viewMode=todo and there are no todo items.

   These tests FAIL against the current code because:
   - The title is a plain <Text> ({t('my_tastes')}), not a dropdown.
   - There is no viewMode state, no todo pool, no todo empty state in
     LibraryView. The component only renders tasted items unconditionally.

   When the implementation lands the tests must turn green WITHOUT any
   change to these assertions.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import LibraryView from '../LibraryView'
import type { Taste } from '@yon/shared'

// ── react-native stubs ────────────────────────────────────────────────────────

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

// ── shared mocks ──────────────────────────────────────────────────────────────

jest.mock('@yon/shared', () => {
  const actual = jest.requireActual('@yon/shared')
  return {
    ...actual,
    searchTastes: jest.fn(() => []),
    formatDistance: (m: number) => `${m}m`,
  }
})

// ── data hook — controllable per test ─────────────────────────────────────────

let mockItems: Taste[] = []
jest.mock('@/app/(tabs)/_useTastes', () => {
  const actual = jest.requireActual('@/app/(tabs)/_useTastes')
  return {
    ...actual,
    useRefreshableTastes: () => ({ items: mockItems, loading: false, refresh: jest.fn() }),
  }
})

// ── taster plumbing — default: self-only, no family personas ─────────────────

let mockActiveTaster: string | null = null
jest.mock('@/app/(tabs)/_useActiveTaster', () => ({
  useActiveTaster: () => mockActiveTaster,
}))

let mockTasters: Array<{ id: string; isSelf: boolean; displayName: string }> = [
  { id: 'ts_self', isSelf: true, displayName: 'Me' },
]
jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({ tasters: mockTasters, loading: false }),
}))

// ── tags / location / auth stubs ─────────────────────────────────────────────

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
  clearTagsCache: jest.fn(),
}))

jest.mock('@/app/(tabs)/_useUserCoords', () => ({
  useUserCoords: () => null,
  sortByNearest: (items: unknown[]) => items.map((item) => ({ item, distance: null })),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { locationEnabled: false } }),
}))

// ── router stub ───────────────────────────────────────────────────────────────

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), setParams: jest.fn() }),
  useLocalSearchParams: jest.fn(() => ({})),
}))

// ── i18n stub — maps the keys this plan adds ─────────────────────────────────
// nav_todo / lib_tab_tasted must be present so the dropdown labels are
// predictable in assertions below.

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        my_tastes:       'My Tastes',
        lib_tab_tasted:  'My Tastes',
        nav_todo:        'To-Try',
        nothing_here:    'Nothing here yet.',
        all:             'All',
        search_log:      'Search your log…',
        sort_recent:     'Recent',
        sort_nearby:     'Nearby',
        bought_n:        `Bought ${params?.n ?? 0}×`,
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
      }
      return map[key] ?? key
    },
    formatMoney: (v: string) => v,
  }),
}))

// ── ds component stubs ───────────────────────────────────────────────────────
// FoodCard exposes data-name + data-status so tests can assert on status.
// Icon exposes data-icon so the bookmark empty-state icon can be verified.
// The title dropdown will be a Pressable/TouchableOpacity; we stub Tag only for
// the filter chips (Tag is not used for the title).

jest.mock('@/components/ds', () => {
  const { View, Text, TouchableOpacity } = require('react-native')
  return {
    FoodCard: ({ name, status, testID }: { name?: string; status?: string; testID?: string }) => (
      <View testID={testID ?? `card-${name}`} accessibilityHint={status}>
        <Text>{name}</Text>
      </View>
    ),
    Icon: ({ name }: { name: string }) => (
      <View testID={`icon-${name}`} />
    ),
    Input: ({
      onChangeText, value, placeholder, accessibilityLabel,
    }: {
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
    Tag: ({
      children, onPress, active,
    }: {
      children: React.ReactNode
      onPress?: () => void
      active?: boolean
    }) => (
      <TouchableOpacity onPress={onPress} accessibilityState={{ selected: active }}>
        <Text>{children}</Text>
      </TouchableOpacity>
    ),
  }
})

// ── RecallResults stub ────────────────────────────────────────────────────────

jest.mock('@/components/app/RecallResults', () => ({
  RecallResults: () => null,
}))

// ── taste factories ───────────────────────────────────────────────────────────

let seq = 0
function makeTaste(overrides: Partial<Taste> & { name: string }): Taste {
  seq++
  return {
    id: `t${seq}`,
    place: '',
    price: '',
    status: 'tasted' as const,
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
    createdAt: `2026-06-17T0${seq % 9}:00:00.000Z`,
    ...overrides,
  }
}

// ── render helper ─────────────────────────────────────────────────────────────

function renderLibrary() {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<LibraryView />)
  })
  return renderer
}

// Find a node that carries testID="title-dropdown" (the new dropdown trigger).
// Returns undefined when the element doesn't exist (i.e., against current code).
function findTitleDropdown(renderer: TestRenderer.ReactTestRenderer) {
  const nodes = renderer.root.findAll((n) => n.props.testID === 'title-dropdown')
  return nodes[0]
}

// Find the dropdown menu (testID="title-dropdown-menu") — only visible when open.
function findDropdownMenu(renderer: TestRenderer.ReactTestRenderer) {
  const nodes = renderer.root.findAll((n) => n.props.testID === 'title-dropdown-menu')
  return nodes[0]
}

// Find a menu item by testID.
function findDropdownItem(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  const nodes = renderer.root.findAll((n) => n.props.testID === testID)
  return nodes[0]
}

// Find all rendered FoodCard stubs by their testID prefix.
function findCardsByPrefix(renderer: TestRenderer.ReactTestRenderer, prefix: string) {
  return renderer.root.findAll(
    (n) => typeof n.props.testID === 'string' && n.props.testID.startsWith(prefix),
  )
}

// Find cards for a specific name.
function findCard(renderer: TestRenderer.ReactTestRenderer, name: string) {
  return renderer.root.findAll((n) => n.props.testID === `card-${name}`)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('LibraryView title dropdown — todo mode filtering (plan 2 red tests)', () => {
  beforeEach(() => {
    seq = 0
    mockItems = []
    mockActiveTaster = null
    mockTasters = [{ id: 'ts_self', isSelf: true, displayName: 'Me' }]
    jest.clearAllMocks()
  })

  // ── (a) switching to 想吃 filters list to status==='todo' only ─────────────

  it('(a) selecting 想吃 from the title dropdown shows only status=todo items', () => {
    mockItems = [
      makeTaste({ name: 'Ramen', status: 'tasted', verdict: 'yum' }),
      makeTaste({ name: 'Boba', status: 'tasted', verdict: 'meh' }),
      makeTaste({ name: 'Sushi Wish', status: 'todo', verdict: null }),
    ]
    const renderer = renderLibrary()

    // Pre-condition: in default (tasted) mode both tasted cards are visible.
    expect(findCard(renderer, 'Ramen').length).toBeGreaterThan(0)
    expect(findCard(renderer, 'Boba').length).toBeGreaterThan(0)
    // The todo item must NOT appear in tasted mode.
    expect(findCard(renderer, 'Sushi Wish')).toHaveLength(0)

    // The title must be a dropdown trigger — this asserts the dropdown exists.
    const dropdown = findTitleDropdown(renderer)
    expect(dropdown).toBeDefined() // FAILS against current code (plain Text, no testID)

    // Open the dropdown and pick 想吃.
    act(() => { dropdown!.props.onPress() })
    const todoItem = findDropdownItem(renderer, 'dropdown-item-todo')
    expect(todoItem).toBeDefined() // FAILS — menu doesn't exist yet
    act(() => { todoItem!.props.onPress() })

    // After selecting todo mode: only the todo item is shown.
    expect(findCard(renderer, 'Sushi Wish').length).toBeGreaterThan(0)
    // Tasted items must be gone.
    expect(findCard(renderer, 'Ramen')).toHaveLength(0)
    expect(findCard(renderer, 'Boba')).toHaveLength(0)
  })

  it('(a) switching back to 我的口味 restores the tasted list', () => {
    mockItems = [
      makeTaste({ name: 'Espresso', status: 'tasted', verdict: 'yum' }),
      makeTaste({ name: 'Croissant Wish', status: 'todo', verdict: null }),
    ]
    const renderer = renderLibrary()

    // Switch to todo mode.
    const dropdown = findTitleDropdown(renderer)
    expect(dropdown).toBeDefined() // FAILS against current code
    act(() => { dropdown!.props.onPress() })
    act(() => { findDropdownItem(renderer, 'dropdown-item-todo')!.props.onPress() })

    expect(findCard(renderer, 'Espresso')).toHaveLength(0)

    // Switch back to tasted mode.
    act(() => { dropdown!.props.onPress() })
    const tastedItem = findDropdownItem(renderer, 'dropdown-item-tasted')
    expect(tastedItem).toBeDefined() // FAILS — menu item doesn't exist yet
    act(() => { tastedItem!.props.onPress() })

    expect(findCard(renderer, 'Espresso').length).toBeGreaterThan(0)
    expect(findCard(renderer, 'Croissant Wish')).toHaveLength(0)
  })

  // ── (b) 想吃 N count = current taster's todo count ────────────────────────

  it('(b) the todo count in the dropdown matches the current taster todo count', () => {
    // Mixed pool: 2 todos for self, 1 todo for a family member.
    mockTasters = [
      { id: 'ts_self', isSelf: true, displayName: 'Me' },
      { id: 'ts_wife', isSelf: false, displayName: 'Wife' },
    ]
    mockActiveTaster = null // viewing self
    mockItems = [
      makeTaste({ name: 'Self Todo 1', status: 'todo', verdict: null, tasterId: 'ts_self' }),
      makeTaste({ name: 'Self Todo 2', status: 'todo', verdict: null, tasterId: 'ts_self' }),
      makeTaste({ name: 'Wife Todo',   status: 'todo', verdict: null, tasterId: 'ts_wife' }),
      makeTaste({ name: 'Self Tasted', status: 'tasted', verdict: 'yum', tasterId: 'ts_self' }),
    ]

    const renderer = renderLibrary()

    // The dropdown trigger must carry the current taster's todo count.
    // Implementation must expose this via testID="title-dropdown" and a
    // testID="todo-count" child or accessibilityLabel / children text.
    // We look for a node with testID="todo-count" that shows "2".
    const dropdown = findTitleDropdown(renderer)
    expect(dropdown).toBeDefined() // FAILS against current code

    // Open dropdown to reveal the menu item with the count.
    act(() => { dropdown!.props.onPress() })

    const todoMenuItem = findDropdownItem(renderer, 'dropdown-item-todo')
    expect(todoMenuItem).toBeDefined() // FAILS — menu doesn't exist yet

    // The menu item must contain the number 2 (self's todo count, not 3).
    const allText: string[] = []
    todoMenuItem!.findAll((n) => {
      if (typeof n.props.children === 'string') allText.push(n.props.children)
      if (typeof n.props.children === 'number') allText.push(String(n.props.children))
      return false
    })
    const countText = allText.join(' ')
    expect(countText).toMatch(/2/) // 2 self todos, not 3 total
  })

  it('(b) todo count updates when a different taster is active', () => {
    mockTasters = [
      { id: 'ts_self', isSelf: true, displayName: 'Me' },
      { id: 'ts_wife', isSelf: false, displayName: 'Wife' },
    ]
    mockActiveTaster = 'ts_wife' // viewing wife's list
    mockItems = [
      makeTaste({ name: 'Self Todo',  status: 'todo',   verdict: null, tasterId: 'ts_self' }),
      makeTaste({ name: 'Wife Todo 1', status: 'todo',  verdict: null, tasterId: 'ts_wife' }),
      makeTaste({ name: 'Wife Todo 2', status: 'todo',  verdict: null, tasterId: 'ts_wife' }),
      makeTaste({ name: 'Wife Todo 3', status: 'todo',  verdict: null, tasterId: 'ts_wife' }),
    ]

    const renderer = renderLibrary()

    const dropdown = findTitleDropdown(renderer)
    expect(dropdown).toBeDefined() // FAILS against current code
    act(() => { dropdown!.props.onPress() })

    const todoMenuItem = findDropdownItem(renderer, 'dropdown-item-todo')
    expect(todoMenuItem).toBeDefined() // FAILS

    // Wife has 3 todos; the count must be 3, not 4 (self's is excluded).
    const allText: string[] = []
    todoMenuItem!.findAll((n) => {
      if (typeof n.props.children === 'string') allText.push(n.props.children)
      if (typeof n.props.children === 'number') allText.push(String(n.props.children))
      return false
    })
    expect(allText.join(' ')).toMatch(/3/)
  })

  // ── (c) 想吃 empty state ──────────────────────────────────────────────────

  it('(c) todo empty state shows bookmark icon + nothing_here when no todo items', () => {
    mockItems = [
      makeTaste({ name: 'Espresso', status: 'tasted', verdict: 'yum' }),
      // No todo items.
    ]
    const renderer = renderLibrary()

    const dropdown = findTitleDropdown(renderer)
    expect(dropdown).toBeDefined() // FAILS against current code
    act(() => { dropdown!.props.onPress() })
    act(() => { findDropdownItem(renderer, 'dropdown-item-todo')!.props.onPress() })

    // No food cards should be rendered.
    const allCards = findCardsByPrefix(renderer, 'card-')
    expect(allCards).toHaveLength(0)

    // The bookmark icon must be rendered (empty state).
    const bookmarkIcons = renderer.root.findAll((n) => n.props.testID === 'icon-bookmark')
    expect(bookmarkIcons.length).toBeGreaterThan(0) // FAILS — bookmark not in LibraryView yet

    // The nothing_here text must be rendered.
    const emptyText = renderer.root.findAll(
      (n) =>
        typeof n.props.children === 'string' &&
        n.props.children === 'Nothing here yet.',
    )
    expect(emptyText.length).toBeGreaterThan(0) // FAILS — empty state uses reciept icon, not bookmark
  })

  // ── (d) z-order: the open dropdown menu must paint OVER the filter/cards ───
  // RN paints later siblings on top. The dropdown overlay must therefore be a
  // LATER sibling than the filter-row/ScrollView in document order, else the
  // tag chips + cards paint over the menu and it looks "covered by the tags"
  // (user-reported UI bug). We assert the open menu node appears AFTER the
  // filter-row node in a depth-first walk of the tree.
  it('(d) the open dropdown menu renders after the filter-row (so it paints on top)', () => {
    mockItems = [makeTaste({ name: 'Ramen', status: 'tasted', verdict: 'yum' })]
    const renderer = renderLibrary()

    // Open the dropdown.
    const dropdown = findTitleDropdown(renderer)
    expect(dropdown).toBeDefined()
    act(() => { dropdown!.props.onPress() })

    // Depth-first ordered list of every node's testID.
    const order: string[] = []
    renderer.root.findAll((n) => {
      if (typeof n.props.testID === 'string') order.push(n.props.testID)
      return false
    })

    const filterRowIdx = order.indexOf('filter-row')
    const menuIdx = order.indexOf('title-dropdown-menu')

    expect(filterRowIdx).toBeGreaterThanOrEqual(0)
    expect(menuIdx).toBeGreaterThanOrEqual(0)
    // FAILS against the old layout (menu rendered before the ScrollView, so
    // menuIdx < filterRowIdx). Passes once the menu is a later sibling.
    expect(menuIdx).toBeGreaterThan(filterRowIdx)
  })

  it('(c) tasted empty state still uses the reciept icon (not bookmark)', () => {
    // Regression guard: the existing tasted empty state must not be replaced.
    mockItems = [] // no items at all
    const renderer = renderLibrary()

    // Default is tasted mode — the reciept icon should show.
    const receiptIcons = renderer.root.findAll((n) => n.props.testID === 'icon-reciept')
    expect(receiptIcons.length).toBeGreaterThan(0)

    // No bookmark icon in tasted empty state.
    const bookmarkIcons = renderer.root.findAll((n) => n.props.testID === 'icon-bookmark')
    expect(bookmarkIcons).toHaveLength(0)
  })
})
