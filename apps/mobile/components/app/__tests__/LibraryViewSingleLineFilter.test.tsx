/* ============================================================
   RED tests — LibraryView single-line filter bar (plan 3).

   Pins:
   (A) The filter area is a SINGLE ROW — a container with
       testID="filter-row" that does NOT use flexWrap (or wraps
       only its children inside a horizontal ScrollView), containing
       all of: verdict icon buttons, category tag ScrollView, expand
       button, and sort segment — in browse/tasted mode.
   (B) Verdict icon buttons (testID="verdict-btn-yum/meh/nah") toggle
       the verdictFilter; re-tapping the active one clears it (toggle-off).
       They are HIDDEN in todo mode.
   (C) Tapping the expand button (testID="filter-expand-btn") opens
       a bottom sheet (testID="filter-sheet") implemented as an
       absoluteFill sibling View (NOT a Modal), showing all tags in
       a wrap grid. Selections in the sheet are two-way synced with
       the inline filter state.

   These tests FAIL against the current code because:
   - There is no "filter-row" container: verdict tags + category tags
     live inside the ScrollView in a flexWrap row (multi-line), and
     the sort segment is a separate row below them.
   - There are no "verdict-btn-yum/meh/nah" testIDs — verdict filters
     are plain <Tag> chips in a wrapping row.
   - There is no "filter-expand-btn" or "filter-sheet" anywhere in the
     component tree.

   When the plan-3 implementation lands these must turn GREEN without
   any change to the assertions here.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { View } from 'react-native'
import LibraryView from '../LibraryView'
import type { Taste } from '@yon/shared'

// ── react-native stubs ────────────────────────────────────────────────────────

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'useWindowDimensions') return () => ({ width: 360, height: 780 })
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

// ── taster plumbing — default: self-only ─────────────────────────────────────

jest.mock('@/app/(tabs)/_useActiveTaster', () => ({
  useActiveTaster: () => null,
}))

jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({ tasters: [{ id: 'ts_self', isSelf: true, displayName: 'Me' }], loading: false }),
}))

// ── tags / location / auth stubs ─────────────────────────────────────────────

let mockTagList: Array<{ id: string; name: string; createdAt: string }> = []
jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: mockTagList, loading: false }),
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

const mockSetParams = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), setParams: mockSetParams }),
  useLocalSearchParams: jest.fn(() => ({})),
}))

// ── i18n stub ─────────────────────────────────────────────────────────────────

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        my_tastes:    'My Tastes',
        nav_todo:     'To-Try',
        nothing_here: 'Nothing here yet.',
        all:          'All',
        search_log:   'Search your log…',
        sort_recent:  'Recent',
        sort_nearby:  'Nearby',
        yum:          'yum', meh: 'meh', nah: 'nah',
        v_yum:        'YUM', v_meh: 'MEH', v_nah: 'NAH',
        bought_n:     `Bought ${params?.n ?? 0}×`,
        filter_sheet_title: '筛选',
        filter_taste:       '口味',
        filter_tags:        '标签',
      }
      return map[key] ?? key
    },
    formatMoney: (v: string) => v,
  }),
}))

// ── ds component stubs ────────────────────────────────────────────────────────

jest.mock('@/components/ds', () => {
  const { View, Text, TouchableOpacity, ScrollView } = require('react-native')
  return {
    FoodCard: ({ name, testID }: { name?: string; testID?: string }) => (
      <View testID={testID ?? `card-${name}`}>
        <Text>{name}</Text>
      </View>
    ),
    Badge: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
      <View testID={testID}><Text>{children}</Text></View>
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
      children, onPress, active, testID,
    }: {
      children: React.ReactNode
      onPress?: () => void
      active?: boolean
      testID?: string
    }) => (
      <TouchableOpacity testID={testID} onPress={onPress} accessibilityState={{ selected: active }}>
        <Text>{children}</Text>
      </TouchableOpacity>
    ),
  }
})

// ── RecallResults stub ────────────────────────────────────────────────────────

jest.mock('@/components/app/RecallResults', () => ({
  RecallResults: () => null,
}))

// ── taste factory ─────────────────────────────────────────────────────────────

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

function findByTestID(renderer: TestRenderer.ReactTestRenderer, id: string) {
  return renderer.root.findAll((n) => n.props.testID === id)
}

function findOne(renderer: TestRenderer.ReactTestRenderer, id: string) {
  return findByTestID(renderer, id)[0]
}

// Switch to todo mode by tapping the dropdown
function switchToTodo(renderer: TestRenderer.ReactTestRenderer) {
  const dropdown = findOne(renderer, 'title-dropdown')
  act(() => { dropdown.props.onPress() })
  const todoItem = findOne(renderer, 'dropdown-item-todo')
  act(() => { todoItem.props.onPress() })
}

// ── (A) Single-line filter row ────────────────────────────────────────────────

describe('Plan 3 — (A) single-line filter row layout', () => {
  beforeEach(() => {
    seq = 0
    mockItems = []
    mockTagList = []
    jest.clearAllMocks()
  })

  it('(A1) renders a filter-row container in tasted/browse mode', () => {
    mockItems = [makeTaste({ name: 'Ramen', verdict: 'yum' })]
    const renderer = renderLibrary()

    // FAILS: no testID="filter-row" exists in the current implementation.
    const rows = findByTestID(renderer, 'filter-row')
    expect(rows.length).toBeGreaterThan(0)
  })

  it('(A2) filter-row is NOT a wrapping multi-line row (flexWrap must not be "wrap")', () => {
    mockTagList = [
      { id: '1', name: 'Burger', createdAt: '' },
      { id: '2', name: 'Coffee', createdAt: '' },
      { id: '3', name: 'Noodles', createdAt: '' },
    ]
    mockItems = [makeTaste({ name: 'Ramen', verdict: 'yum' })]
    const renderer = renderLibrary()

    // FAILS: no filter-row; current impl has flexWrap='wrap' around the chips.
    const row = findOne(renderer, 'filter-row')
    expect(row).toBeDefined()
    // The row itself must NOT wrap — it's a single horizontal line.
    expect(row.props.style?.flexWrap ?? row.props.style?.[0]?.flexWrap).not.toBe('wrap')
  })

  it('(A3) sort segment (Recent/Nearby) is inside filter-row, not a separate row below', () => {
    mockItems = [makeTaste({ name: 'Ramen', verdict: 'yum' })]
    const renderer = renderLibrary()

    // FAILS: sort segment is currently a sibling View outside the filter chips row.
    const row = findOne(renderer, 'filter-row')
    expect(row).toBeDefined()

    // sort-segment must be a descendant of filter-row
    const sortInRow = row.findAll((n) => n.props.testID === 'sort-segment')
    expect(sortInRow.length).toBeGreaterThan(0)
  })

  it('(A4) expand button (⌄) is inside filter-row', () => {
    mockItems = [makeTaste({ name: 'Ramen', verdict: 'yum' })]
    const renderer = renderLibrary()

    // FAILS: no expand button exists in the current implementation.
    const row = findOne(renderer, 'filter-row')
    expect(row).toBeDefined()

    const expandBtn = row.findAll((n) => n.props.testID === 'filter-expand-btn')
    expect(expandBtn.length).toBeGreaterThan(0)
  })
})

// ── (B) Verdict filtering lives in the ⌄ filter sheet, NOT inline ─────────────
//
// Bug fix (2026-06-17): the inline 😋😐🙅 verdict buttons crowded the single-line
// filter row so the category tag scroll was unusable (only ~1 chip visible).
// They were removed from the row; verdict filtering now happens only inside the
// expand (⌄) filter sheet. These tests pin: (a) NO inline verdict buttons exist,
// (b) the filter-row still exists, (c) verdict filtering still works via the sheet.

describe('Plan 3 / bug-2026-06-17 — (B) verdict filtering via the filter sheet (no inline buttons)', () => {
  beforeEach(() => {
    seq = 0
    mockItems = []
    mockTagList = []
    jest.clearAllMocks()
  })

  /** Find pressables in the sheet whose label text equals `label` (e.g. "😋 yum"). */
  function verdictTagInSheet(sheet: ReturnType<typeof findOne>, label: string) {
    return sheet.findAll(
      (n) =>
        typeof n.props.onPress === 'function' &&
        n.findAll(
          (c) => typeof c.props.children === 'string' && c.props.children === label,
        ).length > 0,
    )
  }

  it('(B1) NO inline verdict icon buttons render anywhere (filter-row still exists)', () => {
    mockItems = [makeTaste({ name: 'Ramen', verdict: 'yum' })]
    const renderer = renderLibrary()

    expect(findByTestID(renderer, 'verdict-btn-yum')).toHaveLength(0)
    expect(findByTestID(renderer, 'verdict-btn-meh')).toHaveLength(0)
    expect(findByTestID(renderer, 'verdict-btn-nah')).toHaveLength(0)

    // …but the single-line filter-row itself is unchanged (tags + expand + sort).
    expect(findByTestID(renderer, 'filter-row').length).toBeGreaterThan(0)
  })

  it('(B2) selecting a verdict in the filter sheet filters items to that verdict only', () => {
    mockItems = [
      makeTaste({ name: 'YumFood', verdict: 'yum' }),
      makeTaste({ name: 'NahFood', verdict: 'nah' }),
    ]
    const renderer = renderLibrary()

    act(() => { findOne(renderer, 'filter-expand-btn').props.onPress() })
    const yum = verdictTagInSheet(findOne(renderer, 'filter-sheet'), '😋 yum')
    expect(yum.length).toBeGreaterThan(0)
    act(() => { yum[0].props.onPress() })

    expect(findByTestID(renderer, 'card-YumFood').length).toBeGreaterThan(0)
    expect(findByTestID(renderer, 'card-NahFood')).toHaveLength(0)
  })

  it('(B3) re-selecting the active verdict in the sheet clears the filter (toggle-off)', () => {
    mockItems = [
      makeTaste({ name: 'YumFood', verdict: 'yum' }),
      makeTaste({ name: 'NahFood', verdict: 'nah' }),
    ]
    const renderer = renderLibrary()

    act(() => { findOne(renderer, 'filter-expand-btn').props.onPress() })
    const nahFirst = verdictTagInSheet(findOne(renderer, 'filter-sheet'), '🙅 nah')
    expect(nahFirst.length).toBeGreaterThan(0)
    act(() => { nahFirst[0].props.onPress() })

    expect(findByTestID(renderer, 'card-NahFood').length).toBeGreaterThan(0)
    expect(findByTestID(renderer, 'card-YumFood')).toHaveLength(0)

    // Re-tap the same verdict in the (still-open) sheet → toggle OFF.
    const nahAgain = verdictTagInSheet(findOne(renderer, 'filter-sheet'), '🙅 nah')
    act(() => { nahAgain[0].props.onPress() })

    expect(findByTestID(renderer, 'card-NahFood').length).toBeGreaterThan(0)
    expect(findByTestID(renderer, 'card-YumFood').length).toBeGreaterThan(0)
  })

  it('(B4) the filter sheet has NO verdict section in todo mode', () => {
    mockItems = [
      makeTaste({ name: 'Ramen', status: 'tasted', verdict: 'yum' }),
      makeTaste({ name: 'Wish', status: 'todo', verdict: null }),
    ]
    const renderer = renderLibrary()
    switchToTodo(renderer)

    act(() => { findOne(renderer, 'filter-expand-btn').props.onPress() })
    const sheets = findByTestID(renderer, 'filter-sheet')
    if (sheets.length > 0) {
      expect(verdictTagInSheet(sheets[0], '😋 yum')).toHaveLength(0)
    }
    // …and definitely no inline verdict buttons.
    expect(findByTestID(renderer, 'verdict-btn-yum')).toHaveLength(0)
  })
})

// ── (C) FilterSheet — expand button + absoluteFill sheet + two-way sync ───────

describe('Plan 3 — (C) FilterSheet expand and two-way sync', () => {
  beforeEach(() => {
    seq = 0
    mockItems = []
    mockTagList = []
    jest.clearAllMocks()
  })

  it('(C1) filter-sheet is NOT rendered initially', () => {
    mockTagList = [{ id: '1', name: 'Burger', createdAt: '' }]
    mockItems = [makeTaste({ name: 'Ramen', verdict: 'yum' })]
    const renderer = renderLibrary()

    // FAILS only if a sheet is incorrectly rendered by default.
    // This should pass once implemented — sheet closed by default.
    // We assert it here so that C2's "open" state is meaningful.
    expect(findByTestID(renderer, 'filter-sheet')).toHaveLength(0)
  })

  it('(C2) tapping filter-expand-btn opens filter-sheet (absoluteFill sibling, not Modal)', () => {
    mockTagList = [{ id: '1', name: 'Burger', createdAt: '' }]
    mockItems = [makeTaste({ name: 'Ramen', verdict: 'yum' })]
    const renderer = renderLibrary()

    // FAILS: no filter-expand-btn exists.
    const expandBtn = findOne(renderer, 'filter-expand-btn')
    expect(expandBtn).toBeDefined()

    act(() => { expandBtn.props.onPress() })

    // FAILS: no filter-sheet.
    const sheet = findByTestID(renderer, 'filter-sheet')
    expect(sheet.length).toBeGreaterThan(0)

    // The sheet must NOT be inside a Modal — it must be in the normal RN tree
    // (absoluteFill pattern, matching the plan-2 dropdown backdrop).
    let hasModalAncestor = false
    let node = sheet[0].parent
    while (node) {
      if (String(node.type) === 'Modal' || node.props?.testID === 'modal-portal') {
        hasModalAncestor = true
        break
      }
      node = node.parent
    }
    expect(hasModalAncestor).toBe(false)
  })

  it('(C3) filter-sheet shows ALL tags in its body (not just those in inline scroll)', () => {
    mockTagList = [
      { id: '1', name: 'Burger', createdAt: '' },
      { id: '2', name: 'Coffee', createdAt: '' },
      { id: '3', name: 'Noodles', createdAt: '' },
      { id: '4', name: 'Dessert', createdAt: '' },
    ]
    mockItems = [makeTaste({ name: 'Ramen', verdict: 'yum' })]
    const renderer = renderLibrary()

    // FAILS: no filter-expand-btn or filter-sheet.
    const expandBtn = findOne(renderer, 'filter-expand-btn')
    expect(expandBtn).toBeDefined()
    act(() => { expandBtn.props.onPress() })

    const sheet = findOne(renderer, 'filter-sheet')
    expect(sheet).toBeDefined()

    // All 4 tag names must appear somewhere inside the sheet.
    const tagNames = ['Burger', 'Coffee', 'Noodles', 'Dessert']
    for (const name of tagNames) {
      const found = sheet.findAll(
        (n) => typeof n.props.children === 'string' && n.props.children === name,
      )
      expect(found.length).toBeGreaterThan(0) // FAILS: no sheet content
    }
  })

  it('(C4) selecting a tag in filter-sheet updates the inline category filter (sheet → inline sync)', () => {
    mockTagList = [
      { id: '1', name: 'Burger', createdAt: '' },
      { id: '2', name: 'Noodles', createdAt: '' },
    ]
    mockItems = [
      makeTaste({ name: 'Burger King', verdict: 'yum', tags: ['Burger'] }),
      makeTaste({ name: 'Ramen', verdict: 'yum', tags: ['Noodles'] }),
    ]
    const renderer = renderLibrary()

    // FAILS: no filter-expand-btn.
    const expandBtn = findOne(renderer, 'filter-expand-btn')
    expect(expandBtn).toBeDefined()
    act(() => { expandBtn.props.onPress() })

    const sheet = findOne(renderer, 'filter-sheet')
    expect(sheet).toBeDefined()

    // Find and tap the 'Burger' tag inside the sheet.
    const burgerInSheet = sheet.findAll(
      (n) =>
        typeof n.props.children === 'string' &&
        n.props.children === 'Burger' &&
        typeof n.props.onPress === 'function',
    ).concat(
      sheet.findAll(
        (n) =>
          typeof n.props.onPress === 'function' &&
          n.findAll(
            (c) => typeof c.props.children === 'string' && c.props.children === 'Burger',
          ).length > 0,
      ),
    )
    expect(burgerInSheet.length).toBeGreaterThan(0) // FAILS: no sheet content
    act(() => { burgerInSheet[0].props.onPress() })

    // After selecting Burger in sheet, the card grid should filter to Burger only.
    expect(findByTestID(renderer, 'card-Burger King').length).toBeGreaterThan(0)
    expect(findByTestID(renderer, 'card-Ramen')).toHaveLength(0)
  })

  it('(C5) inline category tag selection is reflected as active in filter-sheet (inline → sheet sync)', () => {
    mockTagList = [
      { id: '1', name: 'Coffee', createdAt: '' },
    ]
    mockItems = [
      makeTaste({ name: 'Latte', verdict: 'yum', tags: ['Coffee'] }),
    ]
    const renderer = renderLibrary()

    // First, select Coffee via the inline horizontal scroll (it should be a
    // pressable with text "Coffee" in the filter-row area).
    // We find it by text in the filter-row.
    const filterRow = findOne(renderer, 'filter-row')
    // FAILS: no filter-row.
    expect(filterRow).toBeDefined()

    const coffeeInline = filterRow.findAll(
      (n) =>
        typeof n.props.onPress === 'function' &&
        n.findAll(
          (c) => typeof c.props.children === 'string' && c.props.children === 'Coffee',
        ).length > 0,
    )
    // If inline tag chips are inside a nested ScrollView inside filter-row, they still
    // count as descendants. We just need at least one pressable with "Coffee".
    expect(coffeeInline.length).toBeGreaterThan(0)
    act(() => { coffeeInline[0].props.onPress() })

    // Now open the sheet.
    const expandBtn = findOne(renderer, 'filter-expand-btn')
    expect(expandBtn).toBeDefined()
    act(() => { expandBtn.props.onPress() })

    const sheet = findOne(renderer, 'filter-sheet')
    expect(sheet).toBeDefined()

    // Inside the sheet, the 'Coffee' chip must be visually active (selected).
    // We check for accessibilityState.selected=true on the Coffee pressable in the sheet.
    const coffeeInSheet = sheet.findAll(
      (n) =>
        n.props.accessibilityState?.selected === true &&
        n.findAll(
          (c) => typeof c.props.children === 'string' && c.props.children === 'Coffee',
        ).length > 0,
    )
    expect(coffeeInSheet.length).toBeGreaterThan(0) // FAILS: no sheet
  })

  it('(C6) closing filter-sheet via its backdrop/close button hides the sheet', () => {
    mockTagList = [{ id: '1', name: 'Burger', createdAt: '' }]
    mockItems = [makeTaste({ name: 'Ramen', verdict: 'yum' })]
    const renderer = renderLibrary()

    // FAILS: no filter-expand-btn.
    const expandBtn = findOne(renderer, 'filter-expand-btn')
    expect(expandBtn).toBeDefined()
    act(() => { expandBtn.props.onPress() })

    expect(findByTestID(renderer, 'filter-sheet').length).toBeGreaterThan(0)

    // The sheet or its backdrop must provide a way to close it.
    // Try the sheet-close button first, then the sheet-backdrop.
    const closeBtn = findByTestID(renderer, 'filter-sheet-close')
    const backdrop = findByTestID(renderer, 'filter-sheet-backdrop')
    const dismisser = closeBtn[0] ?? backdrop[0]
    expect(dismisser).toBeDefined() // FAILS: no close mechanism exists yet

    act(() => { dismisser.props.onPress() })

    expect(findByTestID(renderer, 'filter-sheet')).toHaveLength(0)
  })
})

// ── Regression: plan-2 dropdown still works after plan-3 changes ──────────────

describe('Plan 3 — regression: plan-2 title dropdown unaffected', () => {
  beforeEach(() => {
    seq = 0
    mockItems = []
    mockTagList = []
    jest.clearAllMocks()
  })

  it('title-dropdown still switches between tasted/todo modes', () => {
    mockItems = [
      makeTaste({ name: 'Ramen', status: 'tasted', verdict: 'yum' }),
      makeTaste({ name: 'Wish', status: 'todo', verdict: null }),
    ]
    const renderer = renderLibrary()

    // tasted mode: Ramen visible, Wish not
    expect(findByTestID(renderer, 'card-Ramen').length).toBeGreaterThan(0)
    expect(findByTestID(renderer, 'card-Wish')).toHaveLength(0)

    switchToTodo(renderer)

    // todo mode: Wish visible, Ramen not
    expect(findByTestID(renderer, 'card-Wish').length).toBeGreaterThan(0)
    expect(findByTestID(renderer, 'card-Ramen')).toHaveLength(0)
  })

  it('filter-row and verdict buttons are absent in todo mode (verdict not applicable to todos)', () => {
    mockItems = [makeTaste({ name: 'Wish', status: 'todo', verdict: null })]
    const renderer = renderLibrary()

    switchToTodo(renderer)

    // In todo mode there should be no verdict icon buttons.
    expect(findByTestID(renderer, 'verdict-btn-yum')).toHaveLength(0)
    expect(findByTestID(renderer, 'verdict-btn-meh')).toHaveLength(0)
    expect(findByTestID(renderer, 'verdict-btn-nah')).toHaveLength(0)
  })
})

// ── (D) Header: CENTERED title-dropdown + top-right avatar, NO banner ─────────
//
// Bug fix (2026-06-17): the 我的口味 header was "炸裂" — the route rendered an
// empty avatar-only row ABOVE a left-aligned title, and the "正在查看 X 的口味"
// banner rendered twice (route + TasterSwitcher). The fix: LibraryView owns ONE
// PageHeader with the title-dropdown CENTERED and the avatar injected via
// `headerRight`; there is NO banner anywhere (the avatar confirms the taster).
describe('bug-2026-06-17 — (D) centered title-dropdown + top-right avatar, no banner', () => {
  beforeEach(() => {
    seq = 0
    mockItems = []
    mockTagList = []
    jest.clearAllMocks()
  })

  function renderWithAvatar() {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        <LibraryView headerRight={<View testID="my-avatar" />} />,
      )
    })
    return renderer
  }

  it('(D1) renders the avatar passed via headerRight', () => {
    mockItems = [makeTaste({ name: 'Ramen', verdict: 'yum' })]
    const renderer = renderWithAvatar()
    expect(findByTestID(renderer, 'my-avatar').length).toBeGreaterThan(0)
  })

  it('(D2) the title-dropdown is centered inside the PageHeader (alignItems center, no flex-end row)', () => {
    mockItems = [makeTaste({ name: 'Ramen', verdict: 'yum' })]
    const renderer = renderWithAvatar()

    // The title-dropdown still exists and is the viewMode switcher…
    const dropdown = findOne(renderer, 'title-dropdown')
    expect(dropdown).toBeDefined()

    // …and it sits inside a horizontally-centering wrapper (PageHeader's center
    // slot uses alignItems:'center'); no ancestor pins it to the right.
    let centered = false
    let node = dropdown.parent
    while (node) {
      const style = node.props.style
      const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style
      if (flat?.alignItems === 'center') centered = true
      if (flat?.justifyContent === 'flex-end') {
        throw new Error('title-dropdown must not live in a flex-end (right-aligned) row')
      }
      node = node.parent
    }
    expect(centered).toBe(true)
  })

  it('(D3) renders NO viewing-banner / header-viewing-banner (banner removed entirely)', () => {
    mockItems = [makeTaste({ name: 'Ramen', verdict: 'yum' })]
    const renderer = renderWithAvatar()
    expect(findByTestID(renderer, 'viewing-banner')).toHaveLength(0)
    expect(findByTestID(renderer, 'header-viewing-banner')).toHaveLength(0)
  })
})
