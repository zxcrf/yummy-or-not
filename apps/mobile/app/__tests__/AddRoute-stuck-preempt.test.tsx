/* ============================================================
   Regression test — issue #46 → #55 → (this) recurrence:
   stuck pink FAB-rect overlay after photo/video crop.

   Why a SECOND stuck-overlay test exists:
   The original AddRoute-stuck.test.tsx models the open spring as
   never-settling but lets `withTiming` settle INSTANTLY. That hid
   the real failure: on a device the heal animation is ALSO
   preemptible. The #55 fix (a withTiming watchdog) shipped green
   under that mock yet still regressed in the field, because under a
   real Android relayout / activity-recreation storm BOTH the open
   spring and any heal animation get preempted.

   This test removes that blind spot: the open spring NEVER settles
   (withSpring returns the start value forever). The route must STILL
   reach full-screen-open — which is only possible via a hard,
   NON-animated `progress.value = 1` write. It also pins:
     - the close guard: a backstop firing while a close is in flight
       must NOT snap the modal back open (would strand navigation);
     - the touch-trap fix: the morph container is pointerEvents
       box-none so a stranded rect can never deaden the list.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Dimensions } from 'react-native'

const SW = Dimensions.get('window').width
const FAB_W = 58 // AddRoute's default FAB rect width at progress=0

const mockBack = jest.fn()
const mockReplace = jest.fn()

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    router: {
      back: (...a: unknown[]) => mockBack(...a),
      replace: (...a: unknown[]) => mockReplace(...a),
    },
    // The fix re-asserts open on focus; model focus as a mount effect.
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(cb, [])
    },
  }
})

jest.mock('@/providers/AddTransitionProvider', () => ({
  useAddTransition: () => ({ fabLayout: { value: null } }),
}))

// Capture the close handler AddRoute hands to the modal so we can drive a
// close from the test (for the close-guard assertion).
let onCloseFromModal: () => void = () => {}
jest.mock('@/components/app/AddModal', () => ({
  __esModule: true,
  default: ({ onClose }: { onClose: () => void }) => {
    onCloseFromModal = onClose
    return null
  },
}))

jest.mock('@/components/ds', () => ({ Icon: () => null }))

/* Reanimated mock modelling a FULLY-PREEMPTED open:
   - withSpring NEVER settles -> always returns the start value (0). This is the
     crux: the open animation can never, on its own, reach 1.
   - withTiming resolves to its target and fires its callback (used only by the
     close handlers here) — the open path no longer relies on it at all.
   - useSharedValue returns a STABLE mutable object so the deadline timer can
     mutate `.value` between renders (the hard write under test). */
jest.mock('react-native-reanimated', () => {
  const React = require('react')
  const AnimatedView = React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
    React.createElement('View', { ...props, ref }),
  )
  const lerp = (v: number, input: number[], output: number[]) => {
    const i0 = input[0]
    const i1 = input[input.length - 1]
    const o0 = output[0]
    const o1 = output[output.length - 1]
    if (v <= i0) return o0
    if (v >= i1) return o1
    return o0 + (o1 - o0) * ((v - i0) / (i1 - i0))
  }
  return {
    __esModule: true,
    default: { View: AnimatedView },
    View: AnimatedView,
    useSharedValue: (init: unknown) => {
      const ref = React.useRef({ value: init })
      return ref.current
    },
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withSpring: () => 0, // preempted: never reaches the target
    // Preempted too: an open `withTiming(1, …)` yields the START value (0), it
    // never advances toward its target. This is the inversion that makes the
    // test device-realistic — the #55 withTiming watchdog could NOT heal under
    // a real relayout storm, so it must not "settle" here either. The close
    // handlers target 0 anyway, and still get their completion callback so
    // router.back / router.replace fire (matching the interrupted-close path).
    withTiming: (_v: unknown, _cfg: unknown, cb?: (finished: boolean) => void) => {
      cb?.(true)
      return 0
    },
    runOnJS: (fn: (...args: unknown[]) => void) => fn,
    interpolate: lerp,
    interpolateColor: (v: number, input: number[], output: string[]) =>
      v >= input[input.length - 1] ? output[output.length - 1] : output[0],
    Easing: { in: (e: unknown) => e, ease: undefined },
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const AddRoute = require('../add').default

function flatten(style: unknown): Record<string, unknown> | null {
  if (!style) return null
  if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean))
  return style as Record<string, unknown>
}

function findContainer(renderer: TestRenderer.ReactTestRenderer) {
  const views = renderer.root.findAll((n) => (n.type as unknown) === 'View')
  const container = views.find((n) => {
    const s = flatten(n.props.style)
    return (
      !!s &&
      s.position === 'absolute' &&
      typeof s.width === 'number' &&
      'borderRadius' in s &&
      'backgroundColor' in s
    )
  })
  if (!container) throw new Error('morph container not found')
  return container
}

function containerWidth(renderer: TestRenderer.ReactTestRenderer): number {
  return flatten(findContainer(renderer).props.style)!.width as number
}

describe('AddRoute open survives a fully-preempted spring (issue #55 recurrence)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockBack.mockClear()
    mockReplace.mockClear()
    onCloseFromModal = () => {}
  })
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('reaches full-screen open via a hard non-animated write when the open spring never settles', () => {
    expect(SW).toBeGreaterThan(FAB_W)

    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddRoute />)
    })

    // Bug condition: the open spring is preempted, so the morph is stranded at
    // the FAB rect. No animation can ever heal this.
    expect(containerWidth(renderer)).toBe(FAB_W)

    // Let the non-animated backstop deadline fire.
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    act(() => {
      renderer.update(<AddRoute />)
    })

    // Healed by the direct `progress.value = 1` write — NOT by any animation.
    expect(containerWidth(renderer)).toBe(SW)

    act(() => {
      renderer.unmount()
    })
  })

  it('does NOT snap back open when a close is already in flight', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddRoute />)
    })

    // Heal to fully open first.
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    act(() => {
      renderer.update(<AddRoute />)
    })
    expect(containerWidth(renderer)).toBe(SW)

    // Start a close: closing.current becomes true and progress drives to 0.
    act(() => {
      onCloseFromModal()
    })
    expect(mockBack).toHaveBeenCalledTimes(1)

    // Any pending/late backstop must respect the close guard and NOT re-open.
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    act(() => {
      renderer.update(<AddRoute />)
    })
    expect(containerWidth(renderer)).not.toBe(SW)

    act(() => {
      renderer.unmount()
    })
  })

  it('keeps the morph container pointerEvents box-none so it never traps touches', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddRoute />)
    })

    expect(findContainer(renderer).props.pointerEvents).toBe('box-none')

    act(() => {
      renderer.unmount()
    })
  })
})
