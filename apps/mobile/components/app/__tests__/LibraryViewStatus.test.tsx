/* ============================================================
   Regression tests — LibraryView is tasted-only (nav restructure).
   The 已尝/想吃 segment toggle was removed; 想吃 now lives in its own
   tab. Pins:
   1. Library renders ONLY tasted records — todo items are never shown.
   2. The 已尝/想吃 segment toggle is gone (no lib-status-tabs / tab nodes).
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
// Keep the real filterTastesByTaster (persona scoping); override only the hook.
jest.mock('@/app/(tabs)/_useTastes', () => {
  const actual = jest.requireActual('@/app/(tabs)/_useTastes')
  return {
    ...actual,
    useRefreshableTastes: () => ({ items: mockItems, loading: false, refresh: jest.fn() }),
  }
})

jest.mock('@/app/(tabs)/_useActiveTaster', () => ({
  useActiveTaster: () => null,
}))
jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({ tasters: [], loading: false }),
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

describe('LibraryView — tasted-only (segment toggle removed)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockItems = []
  })

  it('renders only tasted records — todo items are never shown', () => {
    mockItems = [tastedTaste(), todoTaste()]
    const renderer = render()

    // Tasted item shown
    const cards = renderer.root.findAll((n) => n.props['data-name'] === 'Espresso')
    expect(cards.length).toBeGreaterThan(0)

    // Todo item NOT shown — it lives in the dedicated 想吃 tab now
    const todoCards = renderer.root.findAll((n) => n.props['data-name'] === 'Matcha Latte')
    expect(todoCards).toHaveLength(0)
  })

  it('no longer renders the 已尝/想吃 segment toggle', () => {
    mockItems = [tastedTaste(), todoTaste()]
    const renderer = render()

    // Toggle container + both tab nodes are gone.
    expect(findTabNode(renderer, 'lib-status-tabs')).toHaveLength(0)
    expect(findTabNode(renderer, 'lib-tab-tasted')).toHaveLength(0)
    expect(findTabNode(renderer, 'lib-tab-todo')).toHaveLength(0)

    // The toggle's labels are no longer rendered as standalone tab text.
    expect(findTextNodes(renderer, 'Tasted')).toHaveLength(0)
  })

  it('tasted item with null verdict renders without a todo badge', () => {
    // A tasted row whose verdict is null (data gap) must never get the todo
    // badge — badge is gated on status, not verdict nullness.
    mockItems = [tastedTaste({ id: 'gap', name: 'Null-verdict Tasted', verdict: null })]
    const renderer = render()

    const cards = renderer.root.findAll((n) => n.props['data-name'] === 'Null-verdict Tasted')
    expect(cards.length).toBeGreaterThan(0)

    const withTodoLabel = renderer.root.findAll(
      (n) => n.props['data-name'] === 'Null-verdict Tasted' && n.props['data-todo-label'] != null,
    )
    expect(withTodoLabel).toHaveLength(0)
  })
})
