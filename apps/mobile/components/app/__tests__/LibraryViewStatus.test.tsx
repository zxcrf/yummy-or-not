/* ============================================================
   Regression tests — LibraryView A2 status tabs.
   Pins:
   1. Default tab is 已尝 (tasted) — todo items not shown by default.
   2. 想吃 tab shows todo items with todo_badge, not VerdictStamp.
   3. Switching to todo tab hides tasted items.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import LibraryView from '../LibraryView'
import type { Taste } from '@yon/shared'

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

// ---- mock shared ----------------------------------------------------------

jest.mock('@yon/shared', () => ({
  searchTastes: jest.fn(() => []),
}))

// ---- mock _useTastes / _useTags -------------------------------------------

let mockItems: Taste[] = []
jest.mock('@/app/(tabs)/_useTastes', () => ({
  useRefreshableTastes: () => ({ items: mockItems, loading: false, refresh: jest.fn() }),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [] }),
}))

// ---- mock expo-router -----------------------------------------------------

const mockPush = jest.fn()
const mockSetParams = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, setParams: mockSetParams }),
  useLocalSearchParams: () => ({}),
}))

// ---- mock providers -------------------------------------------------------

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        my_tastes: 'My Tastes',
        count_logged: '{n} logged',
        search_log: 'Search…',
        all: 'All',
        lib_tab_tasted: 'Tasted',
        lib_tab_todo: 'Want to Try',
        todo_badge: 'Want to Try',
        nothing_here: 'Nothing here.',
        bought_n: 'Bought {n}×',
        v_yum: 'YUM', v_meh: 'MEH', v_nah: 'NAH',
        yum: 'Yum', meh: 'Meh', nah: 'Nah',
      }
      return map[key] ?? key
    },
    formatMoney: (p: string | number) => String(p),
  }),
}))

// ---- mock ds components ---------------------------------------------------

jest.mock('@/components/ds', () => ({
  FoodCard: ({ name, todoLabel, verdictLabel, status, testID }: {
    name?: string; todoLabel?: string; verdictLabel?: string; status?: string; testID?: string
  }) => (
    <div data-testid={testID ?? 'food-card'} data-name={name} data-todo-label={todoLabel} data-verdict-label={verdictLabel} data-status={status}>
      {name}
      {status === 'todo' && todoLabel ? <span data-testid="todo-badge-label">{todoLabel}</span> : null}
    </div>
  ),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  Input: ({ value, onChangeText }: { value: string; onChangeText?: (t: string) => void }) => (
    <input value={value} onChange={(e) => onChangeText?.(e.target.value)} />
  ),
  Tag: ({ children, active, onPress }: {
    children: React.ReactNode; active?: boolean; onPress?: () => void
  }) => (
    <span data-active={active} onClick={onPress}>{children}</span>
  ),
}))

// ---- helpers --------------------------------------------------------------

function tastedTaste(overrides: Partial<Taste> = {}): Taste {
  return {
    id: 'tasted-1',
    name: 'Espresso',
    place: 'Cafe',
    price: '4.00',
    status: 'tasted',
    verdict: 'yum',
    tags: [],
    boughtCount: 1,
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

function todoTaste(overrides: Partial<Taste> = {}): Taste {
  return {
    id: 'todo-1',
    name: 'Matcha Latte',
    place: '',
    price: '',
    status: 'todo',
    verdict: null,
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

function render() {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<LibraryView />)
  })
  return renderer
}

function findTextNodes(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAll(
    (n) => typeof n.props.children === 'string' && n.props.children === text,
  )
}

function findTabNode(renderer: TestRenderer.ReactTestRenderer, testId: string) {
  return renderer.root.findAll((n) => n.props.testID === testId)
}

// ---- tests ----------------------------------------------------------------

describe('LibraryView A2 — status tabs', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockItems = []
  })

  it('defaults to tasted tab — shows tasted items, hides todo items', () => {
    mockItems = [tastedTaste(), todoTaste()]
    const renderer = render()

    // Tab labels present
    expect(findTextNodes(renderer, 'Tasted').length).toBeGreaterThan(0)
    expect(findTextNodes(renderer, 'Want to Try').length).toBeGreaterThan(0)

    // Tasted item shown
    const cards = renderer.root.findAll((n) => n.props['data-name'] === 'Espresso')
    expect(cards.length).toBeGreaterThan(0)

    // Todo item NOT shown by default
    const todoCards = renderer.root.findAll((n) => n.props['data-name'] === 'Matcha Latte')
    expect(todoCards).toHaveLength(0)
  })

  it('switching to todo tab shows todo items with todo badge, not verdict label', () => {
    mockItems = [tastedTaste(), todoTaste()]
    const renderer = render()

    // Click the 想吃 tab
    const todoTab = findTabNode(renderer, 'lib-tab-todo')
    expect(todoTab.length).toBeGreaterThan(0)
    act(() => { todoTab[0].props.onPress() })

    // Todo item now shown
    const todoCards = renderer.root.findAll((n) => n.props['data-name'] === 'Matcha Latte')
    expect(todoCards.length).toBeGreaterThan(0)

    // todoLabel is passed (not verdict label)
    const withTodoLabel = renderer.root.findAll(
      (n) => n.props['data-todo-label'] === 'Want to Try',
    )
    expect(withTodoLabel.length).toBeGreaterThan(0)

    // Tasted item not shown
    const tastedCards = renderer.root.findAll((n) => n.props['data-name'] === 'Espresso')
    expect(tastedCards).toHaveLength(0)
  })

  it('switching back to tasted tab shows tasted items and hides todo items', () => {
    mockItems = [tastedTaste(), todoTaste()]
    const renderer = render()

    // Go to todo tab then back to tasted
    const todoTab = findTabNode(renderer, 'lib-tab-todo')
    act(() => { todoTab[0].props.onPress() })

    const tastedTab = findTabNode(renderer, 'lib-tab-tasted')
    act(() => { tastedTab[0].props.onPress() })

    const tastedCards = renderer.root.findAll((n) => n.props['data-name'] === 'Espresso')
    expect(tastedCards.length).toBeGreaterThan(0)

    const todoCards = renderer.root.findAll((n) => n.props['data-name'] === 'Matcha Latte')
    expect(todoCards).toHaveLength(0)
  })

  // ── Defensive: FoodCard status prop drives badge, not verdict nullness ──────

  it('tasted item with null verdict does NOT show todo badge', () => {
    // Hypothetical: a tasted row whose verdict is null (data gap) must never
    // receive the todo badge — badge is gated on status, not verdict.
    mockItems = [tastedTaste({ id: 'gap', name: 'Null-verdict Tasted', verdict: null })]
    const renderer = render()

    // On the tasted tab, the item appears
    const cards = renderer.root.findAll((n) => n.props['data-name'] === 'Null-verdict Tasted')
    expect(cards.length).toBeGreaterThan(0)

    // status passed as 'tasted' — no todo badge
    const withTodoLabel = renderer.root.findAll(
      (n) => n.props['data-name'] === 'Null-verdict Tasted' && n.props['data-todo-label'] != null,
    )
    expect(withTodoLabel).toHaveLength(0)

    // No todo-badge-label span rendered
    expect(renderer.root.findAll((n) => n.props['data-testid'] === 'todo-badge-label')).toHaveLength(0)
  })

  it('todo item always shows todo badge regardless of verdict field', () => {
    // A todo item must always get the badge even if verdict were somehow non-null.
    mockItems = [todoTaste({ id: 'td-v', name: 'Todo With Verdict', verdict: 'yum' as const })]
    const renderer = render()

    // Switch to todo tab
    const todoTab = findTabNode(renderer, 'lib-tab-todo')
    act(() => { todoTab[0].props.onPress() })

    // Item present in todo tab
    const cards = renderer.root.findAll((n) => n.props['data-name'] === 'Todo With Verdict')
    expect(cards.length).toBeGreaterThan(0)

    // status='todo' passed → todo badge rendered
    const withTodoLabel = renderer.root.findAll(
      (n) => n.props['data-name'] === 'Todo With Verdict' && n.props['data-todo-label'] === 'Want to Try',
    )
    expect(withTodoLabel.length).toBeGreaterThan(0)
  })
})
