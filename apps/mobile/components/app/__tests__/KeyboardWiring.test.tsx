/* ============================================================
   Regression tests — keyboard wiring across AuthScreen, AddModal,
   and LibraryView.

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

   3. LibraryView: The outer ScrollView must have both
      keyboardDismissMode="on-drag" and keyboardShouldPersistTaps=
      "handled" so the keyboard dismisses naturally when the user
      scrolls past results (recall search now lives inside Library).
      Test fails if either prop is absent or wrong.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Platform } from 'react-native'
import AuthScreen from '../AuthScreen'
import AddModal from '../AddModal'
import LibraryView from '../LibraryView'

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
  EditActionHeader: () => null,
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
  requestPasswordReset: jest.fn(),
  verifyPasswordReset: jest.fn(),
  setAuthToken: jest.fn(),
  extractResetToken: () => null,
}))

// AuthScreen mounts the reset deep-link capture hook; stub it to "no deep link"
// so this keyboard-focused test needn't wire expo-linking.
jest.mock('../useResetTokenCapture', () => ({ useResetTokenCapture: () => null }))

jest.mock('@/app/(tabs)/_useTastes', () => {
  const actual = jest.requireActual('@/app/(tabs)/_useTastes')
  return {
    ...actual,
    invalidateTastes: jest.fn(async () => []),
    useRefreshableTastes: () => ({ items: [], refresh: jest.fn() }),
  }
})

jest.mock('@/app/(tabs)/_useActiveTaster', () => ({
  useActiveTaster: () => null,
}))
jest.mock('@/app/(tabs)/_useTasters', () => ({
  useTasters: () => ({ tasters: [], loading: false }),
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

  // The save/cancel actions moved from a keyboard-riding sticky footer to the
  // top EditActionHeader (see ADR 0001). The top header never overlaps the
  // keyboard, so bottomOffset no longer reserves a footer height — it is a
  // small constant (the bare 16dp keyboard margin). There is also no longer a
  // footerHeight state nor an "add-actions-footer" onLayout target.
  //
  // The test must fail against the old footerHeight-coupled code: that seeded
  // bottomOffset > 16 and recomputed it from a footer onLayout.
  it('uses a constant bottomOffset of 16 (footer moved to the top header)', () => {
    const { KeyboardAwareScrollView } = require('react-native-keyboard-controller')

    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddModal onClose={() => {}} onSaved={() => {}} />)
    })

    const scroll = renderer.root.findByType(KeyboardAwareScrollView)
    expect(scroll.props.bottomOffset).toBe(16)

    // The deleted sticky footer must be gone entirely.
    expect(
      renderer.root.findAllByProps({ testID: 'add-actions-footer' }),
    ).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. LibraryView — keyboard props on the (recall + browse) results ScrollView
// ══════════════════════════════════════════════════════════════════════════════

describe('LibraryView keyboard dismissal', () => {
  const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    act(() => { mountedRenderers.forEach((r) => r.unmount()) })
    mountedRenderers.length = 0
  })

  // The regression: the search results scroll lacked keyboard interaction
  // props, so the keyboard would stay up while scrolling (bad UX) and taps
  // on results would be swallowed by the keyboard dismiss gesture. Recall
  // search now lives inside Library, so its outer ScrollView must carry both.
  it('has keyboardDismissMode="on-drag" on the results ScrollView', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<LibraryView />)
    })
    mountedRenderers.push(renderer)

    const nodes = findAllWithProp(renderer, 'keyboardDismissMode', 'on-drag')
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('has keyboardShouldPersistTaps="handled" on the results ScrollView', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<LibraryView />)
    })
    mountedRenderers.push(renderer)

    const nodes = findAllWithProp(renderer, 'keyboardShouldPersistTaps', 'handled')
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('both keyboard props live on the same ScrollView node', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<LibraryView />)
    })
    mountedRenderers.push(renderer)

    const nodes = renderer.root.findAll(
      (node) =>
        node.props.keyboardDismissMode === 'on-drag' &&
        node.props.keyboardShouldPersistTaps === 'handled',
    )
    expect(nodes.length).toBeGreaterThan(0)
  })
})
