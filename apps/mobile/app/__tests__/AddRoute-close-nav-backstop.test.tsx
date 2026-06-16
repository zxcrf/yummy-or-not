/* ============================================================
   Regression test — stuck FAB-rect overlay RECURRENCE (post-#125),
   close/save path. User report 2026-06-15: after confirming an add the
   weird overlay returned, now a solid #ff2e88 circle with a white plus
   and no border — i.e. the morph stranded at progress≈0 (the FAB source
   state) instead of unmounting.

   Why #125 did not catch this: #125 hardened only the OPEN path (a hard
   non-animated progress→1 backstop). The CLOSE / SAVE path still fires
   navigation (router.back / router.replace) from the close animation's
   `withTiming` COMPLETION callback — which is interruptible. Under the
   same Android relayout / activity-recreation storm the completion is
   swallowed, the callback never runs, the route never unmounts, and it
   lingers as the red FAB-rect morph over the list.

   This test models a PREEMPTED close: `withTiming` returns its target but
   NEVER fires its callback. Navigation must STILL happen — proving it is
   driven by the un-preemptible CLOSE_BACKSTOP_MS deadline, not the
   animation. Without the backstop both assertions below fail (router.back
   / router.replace are never called → the route is stranded).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'

const mockBack = jest.fn()
const mockReplace = jest.fn()

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    router: {
      back: (...a: unknown[]) => mockBack(...a),
      replace: (...a: unknown[]) => mockReplace(...a),
    },
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(cb, [])
    },
  }
})

jest.mock('@/providers/AddTransitionProvider', () => ({
  useAddTransition: () => ({ fabLayout: { value: null } }),
}))

// Capture BOTH handlers AddRoute hands the modal so the test can drive a
// cancel-close and a save-close.
let onCloseFromModal: () => void = () => {}
let onSavedFromModal: (id: string) => void = () => {}
jest.mock('@/components/app/AddModal', () => ({
  __esModule: true,
  default: ({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) => {
    onCloseFromModal = onClose
    onSavedFromModal = onSaved
    return null
  },
}))

jest.mock('@/components/ds', () => ({ Icon: () => null }))

/* Reanimated mock modelling a PREEMPTED close:
   - withSpring settles to its target instantly so the OPEN path is healthy
     (open is not what's under test here).
   - withTiming returns its target value but NEVER fires its completion
     callback — the device-realistic "the storm ate the close completion"
     case. The only thing that can navigate is the CLOSE_BACKSTOP_MS timer. */
jest.mock('react-native-reanimated', () => {
  const React = require('react')
  const AnimatedView = React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
    React.createElement('View', { ...props, ref }),
  )
  return {
    __esModule: true,
    default: { View: AnimatedView },
    View: AnimatedView,
    useSharedValue: (init: unknown) => {
      const ref = React.useRef({ value: init })
      return ref.current
    },
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withSpring: (v: number) => v, // open settles instantly
    withTiming: (v: number) => v, // close: target applied, callback NEVER fires
    runOnJS: (fn: (...args: unknown[]) => void) => fn,
    interpolate: (v: number, input: number[], output: number[]) => {
      const i0 = input[0]
      const i1 = input[input.length - 1]
      const o0 = output[0]
      const o1 = output[output.length - 1]
      if (v <= i0) return o0
      if (v >= i1) return o1
      return o0 + (o1 - o0) * ((v - i0) / (i1 - i0))
    },
    interpolateColor: (v: number, input: number[], output: string[]) =>
      v >= input[input.length - 1] ? output[output.length - 1] : output[0],
    Easing: { in: (e: unknown) => e, ease: undefined },
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const AddRoute = require('../add').default

describe('AddRoute close/save navigates even when the close animation is preempted', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockBack.mockClear()
    mockReplace.mockClear()
    onCloseFromModal = () => {}
    onSavedFromModal = () => {}
  })
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('Cancel: navigation fires via the backstop deadline, not the animation callback', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddRoute />)
    })

    act(() => {
      onCloseFromModal()
    })
    // The animation completion is preempted (mock never calls the callback),
    // so nothing has navigated yet.
    expect(mockBack).not.toHaveBeenCalled()

    // The un-preemptible deadline fires → the route navigates exactly once.
    act(() => {
      jest.advanceTimersByTime(600)
    })
    expect(mockBack).toHaveBeenCalledTimes(1)

    act(() => {
      renderer.unmount()
    })
  })

  it('Save: replace→detail fires via the backstop deadline, exactly once', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddRoute />)
    })

    act(() => {
      onSavedFromModal('taste-42')
    })
    expect(mockReplace).not.toHaveBeenCalled()

    act(() => {
      jest.advanceTimersByTime(600)
    })
    expect(mockReplace).toHaveBeenCalledTimes(1)
    expect(mockReplace).toHaveBeenCalledWith('/taste/taste-42')

    act(() => {
      renderer.unmount()
    })
  })

  it('does not double-navigate when both the animation callback and the deadline run', () => {
    // Re-mock withTiming to ALSO fire its callback (the healthy-frame path),
    // proving the `navigated` latch makes the deadline a no-op afterwards.
    const reanimated = require('react-native-reanimated')
    const original = reanimated.withTiming
    reanimated.withTiming = (v: number, _cfg: unknown, cb?: (f: boolean) => void) => {
      cb?.(true)
      return v
    }
    try {
      let renderer!: TestRenderer.ReactTestRenderer
      act(() => {
        renderer = TestRenderer.create(<AddRoute />)
      })
      act(() => {
        onCloseFromModal()
      })
      // Animation callback already navigated once.
      expect(mockBack).toHaveBeenCalledTimes(1)
      // The pending deadline must NOT navigate again.
      act(() => {
        jest.advanceTimersByTime(600)
      })
      expect(mockBack).toHaveBeenCalledTimes(1)
      act(() => {
        renderer.unmount()
      })
    } finally {
      reanimated.withTiming = original
    }
  })
})
