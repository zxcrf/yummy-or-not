/* ============================================================
   Regression — issue #46 → #55 → #125 → #126 → #154 (the recurrence that
   survived FIVE targeted fixes). Diagnosed on-device via the [MORPH] logcat
   overlay: the entrance morph reached progress=1.0 perfectly, then the Android
   crop-return ACTIVITY RECREATION desynced reanimated's native view from the JS
   SharedValue — JS still held progress=1.0 ("BAIL open p=1.00") but the native
   view no longer followed it, so the form vanished (cream blank / FAB-circle
   artifact over the list).

   Why every prior fix failed: they all targeted the OPEN TRIGGER ("make
   assertOpen fire / hard-write progress=1"). But the form's visibility was
   COUPLED to progress (AddModal rendered INSIDE the morph container, sized by
   interpolate(progress)). When progress desynced, no re-write of progress could
   bring the form back — the native view ignores the write.

   The fix DECOUPLES visibility from the animation:
     - <AddModal> lives in a plain, always-opaque, full-screen layer whose
       opacity is a pure function of a plain React `phase` state, NOT progress.
     - The morph is a TRANSIENT overlay removed by a plain setTimeout (not the
       animation callback), so a preempted/stranded morph self-clears.

   These tests model the device failure with a PREEMPTED spring (progress never
   leaves ~0, exactly like the post-recreation desync) and pin:
     1. after the entrance timer, the form layer is full-screen + opaque even
        though progress never reached 1 — the form does NOT depend on progress;
     2. the transient morph overlay is REMOVED after the entrance timer even
        though the spring never settled (no stranded FAB-circle artifact);
     3. the form stays visible across an open-phase re-render (the recreation
        re-render) — opacity stays 1 independent of progress;
     4. a fast cancel before the entrance timer does NOT get re-opened by the
        still-pending entrance timer.

   Against the OLD code these FAIL: there is no separate opaque form layer (the
   AddModal-bearing node is the morph container, whose width = interpolate(
   preempted progress) = FAB_W, never SW), and the morph container is never
   removed.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Dimensions } from 'react-native'

const SW = Dimensions.get('window').width
const FAB_W = 58 // the morph's FAB-rect width at progress≈0

const mockBack = jest.fn()
const mockReplace = jest.fn()

// Capture the close handler AddRoute hands the modal so we can drive a close.
let onCloseFromModal: () => void = () => {}

jest.mock('expo-router', () => {
  const React = require('react')
  return {
    router: {
      back: (...a: unknown[]) => mockBack(...a),
      replace: (...a: unknown[]) => mockReplace(...a),
    },
    // The NEW code does not use useFocusEffect, but the OLD code does — provide
    // it (modelled as a mount effect) so the RED run against old code fails on
    // the visibility ASSERTION, not on a missing-mock TypeError.
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(cb, [])
    },
  }
})

jest.mock('@/providers/AddTransitionProvider', () => ({
  useAddTransition: () => ({ fabLayout: { value: null } }),
}))

// A unique testID ('add-modal-marker') so we can locate the AddModal node
// regardless of what layer wraps it. The decoupled form layer must place THIS
// node inside a full-screen opaque container whose opacity is driven by phase,
// not progress.
jest.mock('@/components/app/AddModal', () => ({
  __esModule: true,
  default: ({ onClose }: { onClose: () => void; onSaved: (id: string) => void }) => {
    const React = require('react')
    onCloseFromModal = onClose
    return React.createElement('View', { testID: 'add-modal-marker' })
  },
}))

// The error boundary must pass children through untouched when nothing throws.
jest.mock('@/components/app/AddErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children,
}))

jest.mock('@/components/ds', () => ({ Icon: () => null }))

/* Reanimated mock modelling a FULLY-PREEMPTED entrance spring: withSpring never
   advances progress (stays at its init 0), exactly like the post-activity-
   recreation desync where the native view ignores the SharedValue. useSharedValue
   is a stable object so reads are consistent. The decoupled form layer must NOT
   depend on progress ever reaching 1. */
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
    withSpring: () => 0, // PREEMPTED: progress never leaves 0
    withTiming: (v: number) => v, // close target applied; callback never fires here
    runOnJS: (fn: (...args: unknown[]) => void) => fn,
    interpolate: lerp,
    interpolateColor: (v: number, input: number[], output: string[]) =>
      v >= input[input.length - 1] ? output[output.length - 1] : output[0],
    Easing: { in: (e: unknown) => e, ease: undefined },
    FadeIn: { duration: () => ({}) },
    FadeOut: { duration: () => ({}) },
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const AddRoute = require('../add').default

function flatten(style: unknown): Record<string, unknown> | null {
  if (!style) return null
  if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean))
  return style as Record<string, unknown>
}

/** The decoupled opaque form layer: a full-screen View that is an ancestor of
 *  the AddModal marker AND carries the cream backgroundColor. Its width/height
 *  must be full-screen (absoluteFill → 0/0/0/0 with position absolute) and its
 *  opacity must be progress-INDEPENDENT. */
function findFormLayer(renderer: TestRenderer.ReactTestRenderer) {
  const marker = renderer.root.findAll(
    (n) => (n.type as unknown) === 'View' && n.props.testID === 'add-modal-marker',
  )
  if (marker.length === 0) throw new Error('AddModal marker not rendered')
  // Walk up to the nearest View carrying the cream form background.
  let node: TestRenderer.ReactTestInstance | null = marker[0]
  while (node) {
    if ((node.type as unknown) === 'View') {
      const s = flatten(node.props.style)
      if (s && s.backgroundColor === '#fff6e6') return node
    }
    node = node.parent
  }
  throw new Error('opaque cream form layer not found above AddModal')
}

/** Locate the transient morph overlay container (the rounded rect with an
 *  EXPLICIT numeric width/height + borderRadius). The steady form layer uses
 *  StyleSheet.absoluteFill (position + 0 insets, NO width/borderRadius keys) so
 *  it is never matched here — that structural difference is exactly what lets
 *  this distinguish "overlay removed" (new code) from "overlay recolored but
 *  still present" (old code's progress=1 backstop). Returns null when removed. */
function findMorphOverlay(renderer: TestRenderer.ReactTestRenderer) {
  const views = renderer.root.findAll((n) => (n.type as unknown) === 'View')
  return (
    views.find((n) => {
      const s = flatten(n.props.style)
      return (
        !!s &&
        s.position === 'absolute' &&
        typeof s.width === 'number' &&
        'borderRadius' in s &&
        'backgroundColor' in s
      )
    }) ?? null
  )
}

/** A transition touch shield: a full-screen (absoluteFill — no width key) View
 *  with pointerEvents 'auto' and NO backgroundColor (transparent). The opaque
 *  form layer also goes pointerEvents 'auto' (when open) but carries the cream
 *  backgroundColor, so excluding bg isolates the shield. */
function findTouchShields(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((n) => {
    if ((n.type as unknown) !== 'View') return false
    if (n.props.pointerEvents !== 'auto') return false
    const s = flatten(n.props.style)
    return !!s && s.position === 'absolute' && s.left === 0 && !('backgroundColor' in s)
  })
}

describe('AddRoute — form visibility is decoupled from the morph progress', () => {
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

  it('shows a full-screen opaque form even when the entrance spring is preempted', () => {
    expect(SW).toBeGreaterThan(FAB_W)

    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddRoute />)
    })

    // Drive past the entrance timer → phase flips to 'open'.
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    act(() => {
      renderer.update(<AddRoute />)
    })

    // FAILS against old code: there is no opaque cream form layer wrapping
    // AddModal — AddModal sits inside the morph container, whose width is
    // interpolate(preempted progress=0) === FAB_W, never full-screen.
    const layer = findFormLayer(renderer)
    const s = flatten(layer.props.style)!
    expect(s.opacity).toBe(1) // visible — and NOT a function of progress
    // absoluteFill → full-screen via position:absolute + 0 insets.
    expect(s.position).toBe('absolute')
    expect(s.left).toBe(0)
    expect(s.right).toBe(0)
    expect(s.top).toBe(0)
    expect(s.bottom).toBe(0)

    act(() => {
      renderer.unmount()
    })
  })

  it('removes the transient morph overlay after the entrance timer (no stranded FAB circle)', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddRoute />)
    })

    // During entrance the overlay exists (and, with the spring preempted, is at
    // the FAB rect — the exact stranded artifact the bug shows).
    expect(findMorphOverlay(renderer)).not.toBeNull()
    expect(flatten(findMorphOverlay(renderer)!.props.style)!.width).toBe(FAB_W)

    act(() => {
      jest.advanceTimersByTime(1000)
    })
    act(() => {
      renderer.update(<AddRoute />)
    })

    // FAILS against old code: the morph container is the form host and is never
    // removed, so a preempted spring strands it as the FAB circle forever.
    expect(findMorphOverlay(renderer)).toBeNull()

    act(() => {
      renderer.unmount()
    })
  })

  it('keeps the form visible across an open-phase re-render (activity recreation while open)', () => {
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
    expect(flatten(findFormLayer(renderer).props.style)!.opacity).toBe(1)

    // Simulate the recreation re-render: React re-renders the SAME tree (the
    // device case where progress desyncs but state survives). The form layer's
    // opacity is driven by phase state, so it stays 1 regardless of progress.
    act(() => {
      renderer.update(<AddRoute />)
    })
    expect(flatten(findFormLayer(renderer).props.style)!.opacity).toBe(1)
    expect(findMorphOverlay(renderer)).toBeNull()

    act(() => {
      renderer.unmount()
    })
  })

  it('cancel after open removes the form content and navigates', () => {
    const marker = (r: TestRenderer.ReactTestRenderer) =>
      r.root.findAll((n) => n.props.testID === 'add-modal-marker').length

    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddRoute />)
    })
    // Reach 'open' — the form content (and its Cancel handler) mounts here.
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    act(() => {
      renderer.update(<AddRoute />)
    })
    expect(marker(renderer)).toBe(1)

    // Cancel → phase 'closing': content is unmounted (FadeOut on device) and the
    // close-nav backstop fires. The form never lingers.
    act(() => {
      onCloseFromModal()
    })
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    act(() => {
      renderer.update(<AddRoute />)
    })
    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(marker(renderer)).toBe(0)

    act(() => {
      renderer.unmount()
    })
  })

  it('blocks touches from leaking to the Library during the transition (transparentModal)', () => {
    // /add is a transparentModal — without a shield, a tap on a list card during
    // the entrance morph would navigate the screen behind the opening Add form.
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddRoute />)
    })

    // During entrance the form layer is pointerEvents 'none', so a full-screen
    // transparent shield (pointerEvents 'auto') must exist to consume the taps.
    expect(findTouchShields(renderer).length).toBeGreaterThanOrEqual(1)

    // Once open, the shield is gone — the opaque form layer captures touches.
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    act(() => {
      renderer.update(<AddRoute />)
    })
    expect(findTouchShields(renderer).length).toBe(0)
    expect(findFormLayer(renderer).props.pointerEvents).toBe('auto')

    act(() => {
      renderer.unmount()
    })
  })

  it('dissolves the exit overlay so the pink FAB "+" never lands and hangs on close', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<AddRoute />)
    })
    // Reach 'open' first.
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    act(() => {
      renderer.update(<AddRoute />)
    })

    // Cancel: phase → 'closing', progress → 0 (mock applies the target). The
    // overlay must be faded out (opacity 0) at progress 0 rather than landing as
    // a crisp pink FAB circle that visibly hangs until the route unmounts.
    act(() => {
      onCloseFromModal()
    })
    act(() => {
      renderer.update(<AddRoute />)
    })
    const overlay = findMorphOverlay(renderer)
    expect(overlay).not.toBeNull()
    expect(flatten(overlay!.props.style)!.opacity).toBe(0)

    act(() => {
      renderer.unmount()
    })
  })
})
