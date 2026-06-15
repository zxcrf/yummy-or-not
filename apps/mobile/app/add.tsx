/* Container Transform: FAB rect morphs into full-screen Add modal.
   A single persistent container animates from FAB bounds {x,y,58,58,r:29}
   to full screen {0,0,SW,SH,r:0}. Source content (+ icon) fades out early,
   destination content (AddModal) fades in through the same container.
   On close: reverse. */

import { useCallback, useEffect, useRef } from 'react'
import { AppState, StyleSheet, useWindowDimensions } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  Easing,
  interpolate,
  interpolateColor,
} from 'react-native-reanimated'
import { router, useFocusEffect } from 'expo-router'

import AddModal from '@/components/app/AddModal'
import { Icon } from '@/components/ds'
import { useAddTransition } from '@/providers/AddTransitionProvider'

const SPRING = { damping: 20, stiffness: 180, mass: 0.9 }
// How long after an open-assert we wait before the HARD, non-animated terminal
// write lands. withSpring/withTiming are interruptible; this deadline is the
// un-preemptible backstop (see assertOpen).
const OPEN_BACKSTOP_MS = 350
// Close mirror of OPEN_BACKSTOP_MS. The close animation drives progress→0 and
// fires navigation (router.back / replace) from its completion callback — but
// withTiming is interruptible, so the same Android relayout / activity-recreation
// storm that preempts the open spring can also swallow the close completion.
// When that happens the callback never runs → the route never unmounts → it
// lingers as the FAB-rect morph at progress≈0 (a solid #ff2e88 circle + white
// plus over the list). This deadline is the un-preemptible guarantee that
// navigation happens regardless. Longer than the 350ms close so the pretty
// animated path wins on a healthy frame.
const CLOSE_BACKSTOP_MS = 500

export default function AddRoute() {
  const { width: SW, height: SH } = useWindowDimensions()
  const { fabLayout } = useAddTransition()
  const fab = fabLayout.value ?? { x: SW / 2 - 29, y: SH - 80, width: 58, height: 58 }
  const closing = useRef(false)
  const backstopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Close-path navigation guard + backstop. `navAction` holds the pending
  // navigation (back, or replace→detail) so both the animation completion and
  // the un-preemptible deadline below run the SAME action exactly once.
  const navAction = useRef<(() => void) | null>(null)
  const navigated = useRef(false)
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const progress = useSharedValue(0)

  // Drive the entrance morph to its terminal OPEN state and GUARANTEE it gets
  // there. The pretty path is `withSpring`; the durable guarantee is a hard,
  // NON-animated `progress.value = 1` backstop.
  //
  // Why the backstop must be non-animated: withSpring/withTiming are both
  // interruptible. The Android photo/video crop activity returns through a
  // relayout / activity-recreation storm that preempts even a heal animation,
  // stranding `progress` below 1 → the pink FAB-rect overlay that traps touches
  // over the list. This regressed across #46 → #55 precisely because every
  // prior heal (open spring, then a withTiming watchdog) was itself animated
  // and so could be preempted too. A direct SharedValue write cannot be.
  //
  // Armed on two independent triggers so no crop-return path is missed:
  //   - focus (route mount / remount — covers activity recreation that restores
  //     the route from the autosaved draft), and
  //   - AppState 'active' (fires when the app foregrounds after the crop
  //     activity, even when the JS tree did NOT remount and focus never re-ran).
  // Every arm is guarded on `!closing.current` so a deadline firing mid-close
  // can never snap the modal back open and strand navigation.
  const assertOpen = useCallback(() => {
    if (closing.current || progress.value >= 0.999) return
    progress.value = withSpring(1, SPRING)
    if (backstopTimer.current) clearTimeout(backstopTimer.current)
    backstopTimer.current = setTimeout(() => {
      if (!closing.current && progress.value < 0.999) progress.value = 1
    }, OPEN_BACKSTOP_MS)
  }, [progress])

  useFocusEffect(assertOpen)

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') assertOpen()
    })
    return () => {
      sub.remove()
      if (backstopTimer.current) clearTimeout(backstopTimer.current)
      if (navTimer.current) clearTimeout(navTimer.current)
    }
  }, [assertOpen])

  const containerStyle = useAnimatedStyle(() => {
    const p = progress.value
    return {
      position: 'absolute',
      left: interpolate(p, [0, 1], [fab.x, 0]),
      top: interpolate(p, [0, 1], [fab.y, 0]),
      width: interpolate(p, [0, 1], [fab.width, SW]),
      height: interpolate(p, [0, 1], [fab.height, SH]),
      borderRadius: interpolate(p, [0, 1], [fab.width / 2, 0]),
      backgroundColor: interpolateColor(
        p,
        [0, 0.5, 1],
        ['#ff2e88', '#fff0e0', '#fff6e6'],
      ),
      overflow: 'hidden' as const,
    }
  })

  const sourceStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.3], [1, 0], 'clamp'),
    transform: [{ scale: interpolate(progress.value, [0, 0.3], [1, 0.5], 'clamp') }],
  }))

  const destStyle = useAnimatedStyle(() => ({
    flex: 1,
    opacity: interpolate(progress.value, [0.25, 0.65], [0, 1], 'clamp'),
  }))

  // Run the pending close navigation exactly once. Called from BOTH the close
  // animation's completion callback (the pretty path) and the CLOSE_BACKSTOP_MS
  // deadline (the guarantee). Whichever fires first navigates; the `navigated`
  // latch makes the loser a no-op so we never double-navigate.
  const runNav = useCallback(() => {
    if (navigated.current) return
    navigated.current = true
    if (navTimer.current) clearTimeout(navTimer.current)
    navAction.current?.()
  }, [])

  // Start the close morph (progress→0) AND arm the un-preemptible nav backstop.
  // If the animation completes normally its callback runs runNav; if the storm
  // swallows it, the deadline runs runNav instead — either way the route
  // unmounts and can never strand as the FAB-rect overlay.
  const startClose = (duration: number, action: () => void) => {
    if (closing.current) return
    closing.current = true
    navAction.current = action
    progress.value = withTiming(0, { duration, easing: Easing.in(Easing.ease) }, () => {
      runOnJS(runNav)()
    })
    if (navTimer.current) clearTimeout(navTimer.current)
    navTimer.current = setTimeout(runNav, CLOSE_BACKSTOP_MS)
  }

  const handleClose = () => {
    startClose(350, () => router.back())
  }

  const handleSaved = (id: string) => {
    startClose(300, () => router.replace(`/taste/${id}`))
  }

  return (
    <Animated.View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* box-none so the morph chrome itself never captures touches — only the
          AddModal destination layer below does. Defense-in-depth: even if the
          morph were ever stranded mid-open, taps that miss the modal content
          pass through to the list instead of hitting a dead pink rect. */}
      <Animated.View style={containerStyle} pointerEvents="box-none">
        {/* Source: FAB content (+ icon), fades out early */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              width: fab.width,
              height: fab.height,
              alignItems: 'center',
              justifyContent: 'center',
            },
            sourceStyle,
          ]}
        >
          <Icon name="plus" size={28} color="#fff" />
        </Animated.View>

        {/* Destination: AddModal content, fades in */}
        <Animated.View style={destStyle}>
          <AddModal onClose={handleClose} onSaved={handleSaved} />
        </Animated.View>
      </Animated.View>
    </Animated.View>
  )
}
