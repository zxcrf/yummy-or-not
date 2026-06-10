/* ============================================================
   Regression test — issue #55: stuck FAB-rect overlay after
   photo crop (regression of #46 via a different trigger).

   User feedback: opening /add via the bottom red "+" FAB, then
   picking a photo and confirming the Android crop with an EMPTY
   form, leaves a stuck red "+" shape with an overlay/mask — no
   interaction, only hardware back dismisses, form state lost.
   Typing the food name first (raising the keyboard) avoids it.

   Root cause: the open morph is driven by a single shared value
   `progress` moved 0->1 by a ONE-SHOT useEffect (add.tsx). There
   is no invariant forcing `progress` to a terminal state, so when
   the Android crop-return relayout interrupts the open spring,
   `progress` is stranded near 0 and the container renders the pink
   FAB rect forever (width 58, radius 29, #ff2e88) with AddModal
   faded out. Nothing ever heals it.

   This test models an INTERRUPTED open spring (withSpring never
   settles) and pins the fix: the route must still reach its
   terminal full-screen open state (self-healing via a focus
   re-assert + a watchdog), instead of staying stranded at the
   FAB rect.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Dimensions } from 'react-native'

// Real screen width the component morphs to at progress=1 (jest-expo default).
const SW = Dimensions.get('window').width
const FAB_W = 58 // AddRoute's default FAB rect width at progress=0

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    router: { back: jest.fn(), replace: jest.fn() },
    // The fix re-asserts the open animation on focus. Model focus as a
    // mount effect. Harmless against the old code (which never imports it).
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(cb, [])
    },
  }
})

jest.mock('@/providers/AddTransitionProvider', () => ({
  // null fabLayout -> AddRoute uses its default FAB rect (width 58).
  useAddTransition: () => ({ fabLayout: { value: null } }),
}))

jest.mock('@/components/app/AddModal', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('@/components/ds', () => ({ Icon: () => null }))

/* Reanimated mock modelling an INTERRUPTED open spring:
   - withSpring(target) NEVER settles -> returns the start value 0
     (the orphaned/cancelled spring left by the Android crop return).
   - withTiming(target) DOES resolve to its target (used by the close
     handlers and by the fix's watchdog terminal-state guard).
   - interpolate is a real linear interpolation so we can observe the
     container width move from the FAB rect (58) to full screen (400).
   - useSharedValue returns a STABLE mutable object (like a real shared
     value) so a timer can mutate `.value` between renders. */
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
    withSpring: () => 0, // interrupted: never reaches the target
    withTiming: (v: unknown, _cfg: unknown, cb?: (finished: boolean) => void) => {
      cb?.(true)
      return v
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

// The morphing container: position:absolute with width + borderRadius +
// backgroundColor (the pink FAB rect that grows to full screen).
function containerWidth(renderer: TestRenderer.ReactTestRenderer): number {
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
  return flatten(container.props.style)!.width as number
}

describe('AddRoute open self-heals after an interrupted spring (issue #55)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('reaches the full-screen open state even when the open spring is interrupted', () => {
    // Sanity: the screen must be wider than the FAB rect for this test to mean
    // anything (otherwise stranded and healed states are indistinguishable).
    expect(SW).toBeGreaterThan(FAB_W)

    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddRoute />)
    })

    // Bug condition: the open spring was interrupted, so right now the
    // container is stranded at the FAB rect (this is what the user sees).
    expect(containerWidth(renderer)).toBe(FAB_W)

    // Give every self-healing path time to fire (focus re-assert + watchdog).
    act(() => {
      jest.advanceTimersByTime(1500)
    })
    act(() => {
      renderer.update(<AddRoute />)
    })

    // After self-healing, the container must be full screen — NOT stranded
    // at the pink FAB rect. Fails against the one-shot-effect code.
    expect(containerWidth(renderer)).toBe(SW)

    act(() => {
      renderer.unmount()
    })
  })
})
