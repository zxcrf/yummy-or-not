/* ============================================================
   Regression tests — TodoView (想吃 tab, nav restructure).
   Pins:
   1. TodoView renders ONLY status='todo' records — tasted items excluded.
   2. Each todo card carries the todo_badge label.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import TodoView from '../TodoView'
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

// ---- mock _useTastes ------------------------------------------------------

let mockItems: Taste[] = []
jest.mock('@/app/(tabs)/_useTastes', () => ({
  useRefreshableTastes: () => ({ items: mockItems, loading: false, refresh: jest.fn() }),
}))

// ---- mock expo-router -----------------------------------------------------

const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// ---- mock providers -------------------------------------------------------

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        nav_todo: 'To-Try',
        count_logged: '{n} logged',
        search_log: 'Search…',
        todo_badge: 'Want to Try',
        nothing_here: 'Nothing here.',
        bought_n: 'Bought {n}×',
      }
      return map[key] ?? key
    },
    formatMoney: (p: string | number) => String(p),
  }),
}))

// ---- mock ds components ---------------------------------------------------

jest.mock('@/components/ds', () => ({
  FoodCard: ({ name, todoLabel, status, testID }: {
    name?: string; todoLabel?: string; status?: string; testID?: string
  }) => (
    <div data-testid={testID ?? 'food-card'} data-name={name} data-todo-label={todoLabel} data-status={status}>
      {name}
    </div>
  ),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  Input: ({ value, onChangeText }: { value: string; onChangeText?: (t: string) => void }) => (
    <input value={value} onChange={(e) => onChangeText?.(e.target.value)} />
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
    renderer = TestRenderer.create(<TodoView />)
  })
  return renderer
}

// ---- tests ----------------------------------------------------------------

describe('TodoView — 想吃 tab', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockItems = []
  })

  it('renders only todo records — tasted items are excluded', () => {
    mockItems = [tastedTaste(), todoTaste()]
    const renderer = render()

    const todoCards = renderer.root.findAll((n) => n.props['data-name'] === 'Matcha Latte')
    expect(todoCards.length).toBeGreaterThan(0)

    const tastedCards = renderer.root.findAll((n) => n.props['data-name'] === 'Espresso')
    expect(tastedCards).toHaveLength(0)
  })

  it('passes the todo_badge label to every todo card', () => {
    mockItems = [todoTaste()]
    const renderer = render()

    const withTodoLabel = renderer.root.findAll(
      (n) => n.props['data-name'] === 'Matcha Latte' && n.props['data-todo-label'] === 'Want to Try',
    )
    expect(withTodoLabel.length).toBeGreaterThan(0)
  })

  it('shows the empty state when there are no todo records', () => {
    mockItems = [tastedTaste()]
    const renderer = render()

    const cards = renderer.root.findAll((n) => n.props['data-name'] != null)
    expect(cards).toHaveLength(0)
    const empty = renderer.root.findAll(
      (n) => typeof n.props.children === 'string' && n.props.children === 'Nothing here.',
    )
    expect(empty.length).toBeGreaterThan(0)
  })
})
