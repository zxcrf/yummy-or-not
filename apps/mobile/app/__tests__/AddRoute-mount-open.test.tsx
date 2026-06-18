/* ============================================================
   Regression — stuck pink FAB circle on OPEN when the focus event
   is missed (issues #46→#55→#125→#126, this recurrence).

   The user hit a stranded morph two ways that share ONE root cause:
     - tap + right after returning from a card detail (detail→back→add):
       /add is pushed while navigation is still settling and the focus
       event for the fresh mount can be dropped;
     - add a photo: Android recreates the activity on crop-return, so
       AddRoute REMOUNTS with progress back at 0; if the app was already
       'active' the AppState listener registers too late to catch it.
   In both, every existing arm (useFocusEffect, AppState 'active') is
   missed → assertOpen never runs → the morph strands at progress≈0
   (the pink FAB circle over the list).

   The blind spot in AddRoute-stuck-preempt.test.tsx: it mocks
   useFocusEffect AS a mount effect, conflating focus with mount — so it
   could never catch a MISSED focus event. This test inverts that: it
   models useFocusEffect as a NO-OP and never fires AppState 'active'.
   The route must STILL reach full-screen open — which is only possible
   if a deterministic mount effect drives assertOpen.

   Verified fail-old (no mount effect → stays at FAB width forever) /
   pass-new (mount effect → hard backstop opens it).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Dimensions } from 'react-native'

const SW = Dimensions.get('window').width
const FAB_W = 58 // AddRoute's default FAB rect width at progress=0

const mockBack = jest.fn()
const mockReplace = jest.fn()

// CRUCIAL: useFocusEffect is a NO-OP here — it models the device case where the
// focus event is dropped for the freshly mounted route. The open must not
// depend on it.
jest.mock('expo-router', () => ({
  router: {
    back: (...a: unknown[]) => mockBack(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
  },
  useFocusEffect: () => {
    /* focus event missed — intentionally does nothing */
  },
}))

jest.mock('@/providers/AddTransitionProvider', () => ({
  useAddTransition: () => ({ fabLayout: { value: null } }),
}))

jest.mock('@/components/app/AddModal', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('@/components/ds', () => ({ Icon: () => null }))

/* Reanimated mock modelling a FULLY-PREEMPTED open spring (same as the preempt
   test): withSpring never settles, so the ONLY way to reach open is the hard,
   non-animated progress.value = 1 write armed by assertOpen. useSharedValue is
   a stable mutable object so the deadline timer can mutate .value. */
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

// AppState.addEventListener is left as the real jest-expo stub; we simply never
// dispatch a 'active' change, so that arm never fires either.

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

describe('AddRoute opens on mount even when the focus event is missed', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockBack.mockClear()
    mockReplace.mockClear()
  })
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('reaches full-screen open via the mount-armed hard backstop (focus never fires)', () => {
    expect(SW).toBeGreaterThan(FAB_W)

    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddRoute />)
    })

    // Bug condition: spring preempted + focus missed → stranded at the FAB rect.
    expect(containerWidth(renderer)).toBe(FAB_W)

    // Only the deterministic mount effect's hard backstop can heal this.
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    act(() => {
      renderer.update(<AddRoute />)
    })

    // FAILS against old code (no mount effect → assertOpen never ran → still FAB_W).
    expect(containerWidth(renderer)).toBe(SW)

    act(() => {
      renderer.unmount()
    })
  })

  it('re-opens after a crop-recreation remount (fresh mount, focus still missed)', () => {
    // First mount opens.
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddRoute />)
    })
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    act(() => {
      renderer.update(<AddRoute />)
    })
    expect(containerWidth(renderer)).toBe(SW)

    // Simulate Android activity recreation on crop-return: full unmount + fresh
    // mount (new SharedValue at 0). Focus is STILL a no-op.
    act(() => {
      renderer.unmount()
    })
    let renderer2!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer2 = TestRenderer.create(<AddRoute />)
    })
    // Stranded again at FAB rect on the fresh mount...
    expect(containerWidth(renderer2)).toBe(FAB_W)

    // ...until the mount effect's backstop fires.
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    act(() => {
      renderer2.update(<AddRoute />)
    })
    expect(containerWidth(renderer2)).toBe(SW)

    act(() => {
      renderer2.unmount()
    })
  })
})
