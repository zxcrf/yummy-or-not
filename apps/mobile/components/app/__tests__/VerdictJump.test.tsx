import TestRenderer, { act } from 'react-test-renderer'
import type { Taste } from '@yon/shared'

import LibraryView from '../LibraryView'
import StatsView from '../StatsView'
import YouView from '../YouView'

const mockPush = jest.fn()
const mockSetParams = jest.fn()
let mockRouteParams: { verdict?: string | string[] } = {}
const mockItems: Taste[] = []
let mockTagList: Array<{ id: string; name: string; createdAt: string }> = []
const mockUpdateUser = jest.fn()

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockRouteParams,
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    setParams: (...args: unknown[]) => mockSetParams(...args),
  }),
}))

jest.mock('@yon/shared', () => {
  const actual = jest.requireActual('@yon/shared')
  return {
    ...actual,
    LANGS: [
      { code: 'zh', label: 'Chinese', native: '中文' },
      { code: 'en', label: 'English', native: 'English' },
    ],
    getStats: jest.fn().mockRejectedValue(new Error('offline')),
    updateUser: (...args: unknown[]) => mockUpdateUser(...args),
  }
})

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    lang: 'en',
    setLang: jest.fn(),
    formatMoney: (value: number | string) => String(value),
    t: (key: string, params?: Record<string, unknown>) =>
      (
        {
          all: 'All',
          auth_signout: 'Sign out',
          bought_n: `Bought ${params?.n ?? 0}x`,
          count_logged: `${params?.n ?? 0} logged`,
          meh: 'meh',
          my_tastes: 'My tastes',
          nah: 'nah',
          nothing_here: 'Nothing here',
          pro_plan: 'Pro',
          saved_amt: `${params?.amt ?? ''} saved`,
          saved_sub: 'saved sub',
          search_log: 'Search',
          set_location: 'Location',
          set_private: 'Private',
          set_warnings: 'Warnings',
          settings: 'Settings',
          stats_title: 'Stats',
          tastes_logged: `${params?.n ?? 0} tastes logged`,
          v_meh: 'MEH',
          v_nah: 'NAH',
          v_yum: 'YUM',
          yum: 'yum',
        } as Record<string, string>
      )[key] ?? key,
  }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      avatar: '',
      displayName: 'Mina Park',
      plan: 'free',
      warningsEnabled: false,
    },
    signOut: jest.fn(),
    patchUser: jest.fn(),
  }),
}))

jest.mock('@/app/(tabs)/_useTastes', () => ({
  useRefreshableTastes: () => ({
    items: mockItems,
    loading: false,
    refresh: jest.fn().mockResolvedValue(undefined),
  }),
}))

// LibraryView's Nearby-sort plumbing — stubbed so the test never loads
// expo-location and the grid keeps its (recent) order.
jest.mock('@/app/(tabs)/_useUserCoords', () => ({
  useUserCoords: () => null,
  sortByNearest: (items: Array<unknown>) => items.map((item) => ({ item, distance: null })),
}))

// LibraryView's recall mode is exercised in RecallResults.test; here it's
// stubbed so these verdict-jump tests don't depend on its internals.
jest.mock('@/components/app/RecallResults', () => ({
  RecallResults: () => null,
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({
    tags: mockTagList,
    loading: false,
  }),
}))

jest.mock('@/components/app/AnimatedNumber', () => ({
  __esModule: true,
  default: ({ value, testID, ...props }: { value: number; testID?: string }) => {
    const { Text } = require('react-native')
    return (
      <Text testID={testID} {...props}>
        {String(value)}
      </Text>
    )
  },
}))

jest.mock('@/components/ds', () => ({
  Avatar: ({ name }: { name: string }) => {
    const { Text } = require('react-native')
    return <Text>{name}</Text>
  },
  Button: ({
    children,
    onPress,
    ...props
  }: {
    children: React.ReactNode
    onPress?: () => void
  }) => {
    const { Text, TouchableOpacity } = require('react-native')
    return (
      <TouchableOpacity accessibilityRole="button" onPress={onPress} {...props}>
        <Text>{children}</Text>
      </TouchableOpacity>
    )
  },
  Card: ({ children, ...props }: { children: React.ReactNode }) => {
    const { View } = require('react-native')
    return <View {...props}>{children}</View>
  },
  FoodCard: ({ name }: { name: string }) => {
    const { Text, View } = require('react-native')
    return (
      <View testID={`card-${name}`}>
        <Text>{name}</Text>
      </View>
    )
  },
  Icon: () => null,
  Input: ({
    onChangeText,
    value,
    placeholder,
    accessibilityLabel,
  }: {
    onChangeText?: (next: string) => void
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
  LangSwitcher: () => null,
  Switch: () => null,
  Tag: ({
    active,
    children,
    onPress,
  }: {
    active?: boolean
    children: React.ReactNode
    onPress?: () => void
  }) => {
    const { Text, TouchableOpacity } = require('react-native')
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={onPress}
      >
        <Text>{children}</Text>
      </TouchableOpacity>
    )
  },
}))

function makeTaste(name: string, verdict: 'yum' | 'meh' | 'nah'): Taste {
  return {
    id: `${name}-${verdict}`,
    name,
    place: '',
    price: '1',
    status: 'tasted',
    verdict,
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
  }
}

function findPressableWithLabel(
  renderer: TestRenderer.ReactTestRenderer,
  label: string,
) {
  return renderer.root.find(
    (node) =>
      node.props.accessibilityRole === 'button' &&
      node.findAll(
        (child) => typeof child.props.children === 'string' && child.props.children === label,
      ).length > 0,
  )
}

function findCards(renderer: TestRenderer.ReactTestRenderer, name: string) {
  return renderer.root.findAll(
    (node) => String(node.type) === 'View' && node.props.testID === `card-${name}`,
  )
}

describe('verdict tile navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRouteParams = {}
    mockItems.length = 0
    mockTagList = []
  })

  it.each([
    ['yum'],
    ['meh'],
    ['nah'],
  ] as const)('StatsView pushes Library route for %s', (verdict) => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        <StatsView
          items={[
            makeTaste('A', 'yum'),
            makeTaste('B', 'meh'),
            makeTaste('C', 'nah'),
          ]}
        />,
      )
    })

    act(() => {
      findPressableWithLabel(renderer, verdict).props.onPress()
    })

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(tabs)',
      params: { verdict },
    })
  })

  it.each([
    ['yum'],
    ['meh'],
    ['nah'],
  ] as const)('YouView pushes Library route for %s', (verdict) => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        <YouView
          items={[
            makeTaste('A', 'yum'),
            makeTaste('B', 'meh'),
            makeTaste('C', 'nah'),
          ]}
        />,
      )
    })

    act(() => {
      findPressableWithLabel(renderer, verdict).props.onPress()
    })

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(tabs)',
      params: { verdict },
    })
  })
})

describe('LibraryView verdict param', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRouteParams = { verdict: 'nah' }
    mockItems.length = 0
    mockItems.push(
      makeTaste('Yum item', 'yum'),
      makeTaste('Meh item', 'meh'),
      makeTaste('Nah item', 'nah'),
    )
    mockTagList = []
  })

  it('filters to the route verdict and clears when the active verdict chip is pressed', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<LibraryView />)
    })

    expect(findCards(renderer, 'Nah item')).toHaveLength(1)
    expect(findCards(renderer, 'Yum item')).toHaveLength(0)
    expect(findCards(renderer, 'Meh item')).toHaveLength(0)

    const verdictChip = findPressableWithLabel(renderer, 'nah')
    expect(verdictChip.props.accessibilityState.selected).toBe(true)

    act(() => {
      verdictChip.props.onPress()
    })

    expect(mockSetParams).toHaveBeenCalledWith({ verdict: undefined })
    expect(findCards(renderer, 'Nah item')).toHaveLength(1)
    expect(findCards(renderer, 'Yum item')).toHaveLength(1)
    expect(findCards(renderer, 'Meh item')).toHaveLength(1)
  })

  it('drops the route verdict param when All clears the verdict filter', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<LibraryView />)
    })

    act(() => {
      findPressableWithLabel(renderer, 'All').props.onPress()
    })

    expect(mockSetParams).toHaveBeenCalledWith({ verdict: undefined })
    expect(findCards(renderer, 'Nah item')).toHaveLength(1)
    expect(findCards(renderer, 'Yum item')).toHaveLength(1)
    expect(findCards(renderer, 'Meh item')).toHaveLength(1)
  })
})
