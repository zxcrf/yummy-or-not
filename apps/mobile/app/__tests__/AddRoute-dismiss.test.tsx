/* ============================================================
   Regression tests — issue #46: stuck transparent overlay.

   User feedback: after picking a photo and confirming the Android
   crop screen, the app showed a dead, touch-blocking overlay over
   the tabs; only a swipe-back gesture recovered it.

   Root cause: AddRoute's close/save handlers pop the transparent
   modal route only when the reanimated completion callback reports
   finished === true. When the animation is cancelled/interrupted
   (e.g. the crop activity backgrounds or recreates the host
   activity), `finished` is false, `router.back()` never runs, and
   the invisible `transparentModal` screen keeps swallowing every
   touch.

   These tests pin the fix: the route must be dismissed even when
   the close animation does NOT finish.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import AddRoute from '../add'

const mockBack = jest.fn()
const mockReplace = jest.fn()

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    router: {
      back: (...args: unknown[]) => mockBack(...args),
      replace: (...args: unknown[]) => mockReplace(...args),
    },
    // AddRoute re-asserts the open animation on focus; model it as a mount effect.
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(cb, [])
    },
  }
})

jest.mock('@/providers/AddTransitionProvider', () => ({
  useAddTransition: () => ({ fabLayout: { value: null } }),
}))

let mockOnCloseFromModal: () => void = () => {}
let mockOnSavedFromModal: (id: string) => void = () => {}

jest.mock('@/components/app/AddModal', () => {
  const mock = ({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) => {
    mockOnCloseFromModal = onClose
    mockOnSavedFromModal = onSaved
    return null
  }
  return { __esModule: true, default: mock }
})

jest.mock('@/components/ds', () => ({
  Icon: () => null,
}))

// Reanimated mock where animations get INTERRUPTED: the completion
// callback fires with finished === false (what happens on Android when
// the crop activity cancels the timing animation).
jest.mock('react-native-reanimated', () => {
  const React = require('react')
  const AnimatedView = React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
    React.createElement('View', { ...props, ref }),
  )
  return {
    __esModule: true,
    default: { View: AnimatedView },
    View: AnimatedView,
    useSharedValue: (init: unknown) => ({ value: init }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withSpring: (v: unknown) => v,
    withTiming: (v: unknown, _cfg: unknown, callback?: (finished: boolean) => void) => {
      callback?.(false) // animation interrupted, did NOT finish
      return v
    },
    runOnJS: (fn: (...args: unknown[]) => void) => fn,
    interpolate: (_v: unknown, _i: unknown, output: number[]) => output[0],
    interpolateColor: (_v: unknown, _i: unknown, output: string[]) => output[0],
    Easing: { in: (e: unknown) => e, ease: undefined },
    FadeIn: { duration: () => ({}) },
    FadeOut: { duration: () => ({}) },
  }
})

// The form (with its Cancel/Save handlers) mounts at phase 'open', reached via
// the entrance timer — advance past it so AddModal renders and hands AddRoute
// its onClose/onSaved before we drive a close.
function mountToOpen(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<AddRoute />)
  })
  act(() => {
    jest.advanceTimersByTime(600)
  })
  act(() => {
    renderer.update(<AddRoute />)
  })
  return renderer
}

describe('AddRoute dismissal (issue #46)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockBack.mockClear()
    mockReplace.mockClear()
  })
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('pops the route on close even when the close animation is interrupted', () => {
    const renderer = mountToOpen()

    act(() => {
      mockOnCloseFromModal()
    })

    // The transparentModal screen must never be stranded: back() must run
    // even though the animation reported finished === false.
    expect(mockBack).toHaveBeenCalledTimes(1)
    act(() => {
      renderer.unmount()
    })
  })

  it('navigates to the created taste on save even when the animation is interrupted', () => {
    const renderer = mountToOpen()

    act(() => {
      mockOnSavedFromModal('taste-123')
    })

    expect(mockReplace).toHaveBeenCalledTimes(1)
    expect(mockReplace).toHaveBeenCalledWith('/taste/taste-123')
    act(() => {
      renderer.unmount()
    })
  })
})
