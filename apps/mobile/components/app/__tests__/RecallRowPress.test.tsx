import TestRenderer, { act } from 'react-test-renderer'
import RecallView from '../RecallView'

const mockWindowDimensions = jest.fn(() => ({ width: 390, height: 744, scale: 2, fontScale: 2 }))
const mockPush = jest.fn()

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'useWindowDimensions') return () => mockWindowDimensions()
      return Reflect.get(target, prop, receiver)
    },
  })
})

jest.mock('@yon/shared', () => ({
  searchTastes: jest.fn().mockReturnValue([]),
}))

let mockItems: Array<Record<string, unknown>> = []
jest.mock('@/app/(tabs)/_useTastes', () => ({
  useRefreshableTastes: () => ({ items: mockItems, refresh: jest.fn() }),
}))

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { warningsEnabled: true } }),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        recall_title: 'Tasted it before?',
        recall_sub: 'Search before you spend.',
        recall_placeholder: 'Try matcha…',
        recently_recalled: 'Recently recalled',
        v_yum: 'YUM',
        v_meh: 'MEH',
        v_nah: 'NAH',
      })[key] ?? key,
  }),
}))

jest.mock('@/components/ds', () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => {
    const { Pressable: RNPressable, Text } = require('react-native')
    return (
      <RNPressable onPress={onPress}>
        <Text>{children}</Text>
      </RNPressable>
    )
  },
  Card: ({ children }: { children: React.ReactNode }) => {
    const { View } = require('react-native')
    return <View>{children}</View>
  },
  Icon: () => null,
  Input: ({
    value,
    onChangeText,
    placeholder,
  }: {
    value: string
    onChangeText: (text: string) => void
    placeholder?: string
  }) => {
    const { TextInput } = require('react-native')
    return <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} />
  },
  VerdictStamp: ({ label }: { label: string }) => {
    const { Text } = require('react-native')
    return <Text>{label}</Text>
  },
}))

jest.mock('expo-image', () => ({ Image: () => null }), { virtual: true })

function renderRecallView() {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<RecallView />)
  })
  return renderer
}

function findPressables(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((node) => {
    if (typeof node.type === 'string') return false
    return node.type?.displayName === 'Pressable' || node.type?.name === 'Pressable'
  })
}

describe('RecallRow press handling', () => {
  // Track renderers so afterEach can unmount and flush the 250 ms debounce
  // timer that RecallView arms on every mount. Without fake timers the real
  // timer fires after environment teardown on Linux, triggering a React
  // re-render into a torn-down module Proxy and flipping jest exit to 1.
  const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    mockItems = [
      {
        id: 'taste-1',
        name: 'Brown sugar boba',
        place: 'Tea shop',
        verdict: 'yum',
        warnBeforeBuy: false,
        date: '2 days ago',
      },
    ]
  })

  afterEach(() => {
    act(() => { jest.runAllTimers() })
    act(() => { mountedRenderers.forEach((r) => r.unmount()) })
    mountedRenderers.length = 0
    jest.useRealTimers()
  })

  it('routes recent-row taps through a react-native Pressable', () => {
    const renderer = renderRecallView()
    mountedRenderers.push(renderer)

    const pressables = findPressables(renderer)
    expect(pressables.length).toBeGreaterThan(0)

    const rowPressable = pressables.find((node) => typeof node.props.onPress === 'function')
    expect(rowPressable).toBeTruthy()

    act(() => {
      rowPressable!.props.onPress()
    })
    expect(mockPush).toHaveBeenCalledWith('/taste/taste-1')
  })
})
