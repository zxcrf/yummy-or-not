/* ============================================================
   Bug fix (2026-06-17) — 标签管理 / 家人 pushed-screen headers.

   Reported: these two screens had the wrong top color (white native
   header over a cream body), a left-aligned (not centered) title, and a
   native back-arrow instead of the app's unified 取消 control.

   The fix drops the native Stack header (headerShown:false) and renders
   the shared PageHeader: CENTERED title + top-left 取消 (testID
   "header-cancel") that pops the stack via router.back().

   These pin:
   - the native header is OFF (options.headerShown === false),
   - a 取消 control renders (NOT a back-arrow) and calls router.back(),
   - the screen title text is present (rendered by PageHeader, centered).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'

// PageHeader calls useSafeAreaInsets — stub with zero insets (no provider in jest).
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

// Capture the options passed to <Stack.Screen> and stub useRouter.
let capturedOptions: Record<string, unknown> | undefined
const mockBack = jest.fn()
const mockReplace = jest.fn()
let mockCanGoBack = true
jest.mock('expo-router', () => ({
  Stack: {
    Screen: (props: { options?: Record<string, unknown> }) => {
      capturedOptions = props.options
      return null
    },
  },
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
    push: jest.fn(),
  }),
}))

jest.mock('@/providers/I18nProvider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        cancel: '取消',
        tag_manage: '标签管理',
        family_entry: '家人',
      }
      return map[key] ?? key
    },
  }),
}))

// Stub the heavy body views so we only exercise the route's header chrome.
jest.mock('@/components/app/TagManageView', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@/components/app/TasterManageView', () => ({
  __esModule: true,
  default: () => null,
}))

import TagsScreen from '../tags'
import FamilyScreen from '../family'

const mounted: TestRenderer.ReactTestRenderer[] = []
afterEach(() => {
  act(() => mounted.forEach((r) => r.unmount()))
  mounted.length = 0
  capturedOptions = undefined
  mockCanGoBack = true
  jest.clearAllMocks()
})

function render(Screen: React.ComponentType) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<Screen />)
  })
  mounted.push(renderer)
  return renderer
}

function findOne(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  return renderer.root.findAll((n) => n.props.testID === testID)[0]
}
function hasText(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return (
    renderer.root.findAll(
      (n) => typeof n.props.children === 'string' && n.props.children === text,
    ).length > 0
  )
}

describe.each([
  ['标签管理 (/tags)', TagsScreen, '标签管理'],
  ['家人 (/family)', FamilyScreen, '家人'],
])('%s — unified 取消 header', (_label, Screen, title) => {
  it('turns the native Stack header OFF', () => {
    render(Screen)
    expect(capturedOptions?.headerShown).toBe(false)
  })

  it('renders a 取消 control (not a back-arrow) that pops via router.back() when a back stack exists', () => {
    mockCanGoBack = true
    const renderer = render(Screen)
    const cancel = findOne(renderer, 'header-cancel')
    expect(cancel).toBeDefined()
    expect(hasText(renderer, '取消')).toBe(true)

    act(() => cancel.props.onPress())
    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('取消 falls back to the home tabs (replace) on a direct/deep-linked entry (no back stack)', () => {
    mockCanGoBack = false
    const renderer = render(Screen)

    act(() => findOne(renderer, 'header-cancel').props.onPress())
    expect(mockBack).not.toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)')
  })

  it('renders the centered screen title', () => {
    const renderer = render(Screen)
    expect(hasText(renderer, title)).toBe(true)
  })
})
