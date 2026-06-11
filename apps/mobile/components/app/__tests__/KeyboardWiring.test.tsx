/* ============================================================
   Regression tests — keyboard wiring across AuthScreen, AddModal,
   and RecallView.

   These pin three specific regressions introduced by the
   react-native-keyboard-controller migration:

   1. AuthScreen: KeyboardAvoidingView must use behavior="padding" on
      ALL platforms. The old code branched on Platform.OS:
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      so Android silently got 'height' instead. The fix: import
      KeyboardAvoidingView from react-native-keyboard-controller and
      pass behavior="padding" unconditionally. Test fails against the
      old Platform.OS ternary.

   2. AddModal: The old RN KeyboardAvoidingView + manual
      scrollToEnd-on-focus hack have been removed entirely. No element
      in the tree should carry a `behavior` prop (the replacement,
      KeyboardAwareScrollView, has no `behavior` prop — it uses
      bottomOffset instead). Test fails if the old KAV is re-added.

   3. RecallView: The outer ScrollView must have both
      keyboardDismissMode="on-drag" and keyboardShouldPersistTaps=
      "handled" so the keyboard dismisses naturally when the user
      scrolls past results. Test fails if either prop is absent or
      wrong.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Platform } from 'react-native'
import AuthScreen from '../AuthScreen'
import AddModal from '../AddModal'
import RecallView from '../RecallView'

// ── shared mocks ──────────────────────────────────────────────────────────────

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    lang: 'en',
    setLang: jest.fn(),
  }),
}))

// ── AuthScreen mocks ──────────────────────────────────────────────────────────

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    providers: [],
    refresh: jest.fn(),
    user: { warningsEnabled: true },
  }),
}))

jest.mock('@/components/ds', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Icon: () => null,
  IconButton: () => null,
  Input: () => null,
  LangSwitcher: () => null,
  Tag: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Textarea: () => null,
  VerdictPicker: () => null,
  VerdictStamp: () => null,
}))

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
}))

// ── AddModal mocks ────────────────────────────────────────────────────────────

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}))

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}))

jest.mock('@yon/shared', () => ({
  TAG_CHOICES: [],
  createTaste: jest.fn(),
  createTag: jest.fn(),
  searchTastes: jest.fn().mockReturnValue([]),
  LANGS: [],
  loginEmail: jest.fn(),
  registerEmail: jest.fn(),
  oauthStartUrl: jest.fn(),
  requestOtp: jest.fn(),
  verifyOtp: jest.fn(),
}))

jest.mock('@/app/(tabs)/_useTastes', () => ({
  invalidateTastes: jest.fn(async () => []),
  useRefreshableTastes: () => ({ items: [], refresh: jest.fn() }),
}))

jest.mock('@/app/(tabs)/_useTags', () => ({
  useTags: () => ({ tags: [], loading: false }),
  invalidateTagsCache: jest.fn(),
  clearTagsCache: jest.fn(),
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}))

// ── RecallView mocks ──────────────────────────────────────────────────────────

const mockWindowDimensions = jest.fn(() => ({ width: 390, height: 744, scale: 2, fontScale: 2 }))

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'useWindowDimensions') return () => mockWindowDimensions()
      return Reflect.get(target, prop, receiver)
    },
  })
})

jest.mock('expo-image', () => ({ Image: () => null }))

// ── helpers ───────────────────────────────────────────────────────────────────

/** Find all nodes in the tree that have a given prop with a given value. */
function findAllWithProp(
  renderer: TestRenderer.ReactTestRenderer,
  prop: string,
  value: unknown,
): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAll((node) => node.props[prop] === value)
}

/** Find all nodes in the tree that have a given prop (any value). */
function findAllHavingProp(
  renderer: TestRenderer.ReactTestRenderer,
  prop: string,
): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAll((node) => prop in node.props)
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. AuthScreen — behavior="padding" on all platforms
// ══════════════════════════════════════════════════════════════════════════════

describe('AuthScreen keyboard wrapper', () => {
  let realOS: typeof Platform.OS

  beforeEach(() => {
    realOS = Platform.OS
  })

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: realOS })
  })

  // The regression: old code did `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`.
  // On Android this produced behavior="height", which the keyboard-controller
  // package handles differently (and was wrong for our layout). The fix is a
  // flat behavior="padding" from the library's KeyboardAvoidingView.
  it('uses behavior="padding" on Android (regression: old code used "height")', () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AuthScreen />)
    })

    // At least one element in the tree must carry behavior="padding".
    const paddingNodes = findAllWithProp(renderer, 'behavior', 'padding')
    expect(paddingNodes.length).toBeGreaterThan(0)

    // No element may carry behavior="height" — that was the old Android branch.
    const heightNodes = findAllWithProp(renderer, 'behavior', 'height')
    expect(heightNodes).toHaveLength(0)
  })

  it('uses behavior="padding" on iOS (same flat value, no platform branch)', () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' })
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AuthScreen />)
    })

    const paddingNodes = findAllWithProp(renderer, 'behavior', 'padding')
    expect(paddingNodes.length).toBeGreaterThan(0)

    const heightNodes = findAllWithProp(renderer, 'behavior', 'height')
    expect(heightNodes).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. AddModal — old RN KeyboardAvoidingView + scroll hack are gone
// ══════════════════════════════════════════════════════════════════════════════

describe('AddModal keyboard wiring', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  // The regression: AddModal previously wrapped the entire form in an RN
  // KeyboardAvoidingView (behavior="padding" or "height"). Its removal means
  // no element in the rendered tree should carry a `behavior` prop. The new
  // KeyboardAwareScrollView uses `bottomOffset` instead. This test would fail
  // if the old KAV were added back.
  it('has no element with a behavior prop (old RN KeyboardAvoidingView is gone)', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
    })

    const behaviorNodes = findAllHavingProp(renderer, 'behavior')
    expect(behaviorNodes).toHaveLength(0)
  })

  // The regression: bottomOffset={16} only cleared the keyboard itself.
  // The sticky footer (KeyboardStickyView) floats up over the scroll viewport
  // when the keyboard opens, so a focused bottom field (notes, custom tag)
  // would sit BEHIND the footer. Fix: bottomOffset = footerHeight + 16.
  //
  // Two assertions:
  // 1. Seed: before onLayout fires, bottomOffset is already > 16 (seeded with
  //    an estimate so the very first focus clears the footer).
  // 2. Post-layout: after a synthetic onLayout event with a specific footer
  //    height, bottomOffset becomes exactly that height + 16.
  //
  // The test must fail against the old bottomOffset={16}: assertion 1 fails
  // because 16 is not > 16, and assertion 2 fails because 16 ≠ measuredH + 16.
  it('seeds bottomOffset above 16 before layout and updates it to footerHeight+16 after onLayout', () => {
    const { KeyboardAwareScrollView } = require('react-native-keyboard-controller')

    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
    })

    // 1. Seed check: before any layout event, bottomOffset must already exceed
    //    the bare keyboard margin so the first focus still clears the footer.
    const scroll = renderer.root.findByType(KeyboardAwareScrollView)
    expect(scroll.props.bottomOffset).toBeGreaterThan(16)

    // 2. Post-layout: fire a synthetic onLayout on the footer and assert the
    //    scroll's bottomOffset updates to exactly measuredHeight + 16.
    const measuredHeight = 88
    const footer = renderer.root.findByProps({ testID: 'add-actions-footer' })
    act(() => {
      footer.props.onLayout({ nativeEvent: { layout: { height: measuredHeight } } })
    })

    const scrollAfter = renderer.root.findByType(KeyboardAwareScrollView)
    expect(scrollAfter.props.bottomOffset).toBe(measuredHeight + 16)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. RecallView — keyboard props on results ScrollView
// ══════════════════════════════════════════════════════════════════════════════

describe('RecallView keyboard dismissal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // The regression: RecallView's results scroll lacked keyboard interaction
  // props, so the keyboard would stay up while scrolling (bad UX) and taps
  // on results would be swallowed by the keyboard dismiss gesture.
  // Both props must be present on the same element.
  it('has keyboardDismissMode="on-drag" on the results ScrollView', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<RecallView />)
    })

    const nodes = findAllWithProp(renderer, 'keyboardDismissMode', 'on-drag')
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('has keyboardShouldPersistTaps="handled" on the results ScrollView', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<RecallView />)
    })

    const nodes = findAllWithProp(renderer, 'keyboardShouldPersistTaps', 'handled')
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('both keyboard props live on the same ScrollView node', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<RecallView />)
    })

    const nodes = renderer.root.findAll(
      (node) =>
        node.props.keyboardDismissMode === 'on-drag' &&
        node.props.keyboardShouldPersistTaps === 'handled',
    )
    expect(nodes.length).toBeGreaterThan(0)
  })
})
