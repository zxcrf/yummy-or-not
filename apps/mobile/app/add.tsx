/* Container Transform: FAB rect morphs into the full-screen Add modal.
   ────────────────────────────────────────────────────────────────────────
   CRITICAL ARCHITECTURE (see .ai/pitfalls/add-morph-visibility-coupled-to-sharedvalue.md):

   The form's VISIBILITY is decoupled from the morph animation. <AddModal> lives
   in a plain, always-opaque, full-screen layer whose presence is gated by a
   plain React `phase` state — NEVER by the reanimated `progress` SharedValue.

   Why: the Android photo/crop flow returns through an ACTIVITY RECREATION that
   desyncs reanimated's native view from its JS SharedValue. The old design
   rendered <AddModal> *inside* the morph container (size/opacity = f(progress)),
   so when progress desynced the form vanished — the bug that survived #46→#55→
   #125→#126→#154. Re-writing `progress.value = 1` does NOT fix it (the native
   view ignores the write). Decoupling does: once `phase === 'open'`, the form is
   a pure RN view that survives recreation like any normal screen.

   The morph is demoted to a TRANSIENT entrance/exit overlay that is removed by a
   plain `setTimeout` (not the animation-completion callback, which the recreation
   storm can swallow). A preempted/stranded overlay self-clears on the timer, so
   it can never persist as the FAB-circle artifact over the list. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  Easing,
  interpolate,
  interpolateColor,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated'
import { router } from 'expo-router'

import AddModal from '@/components/app/AddModal'
import AddErrorBoundary from '@/components/app/AddErrorBoundary'
import { Icon } from '@/components/ds'
import { useAddTransition } from '@/providers/AddTransitionProvider'

const SPRING = { damping: 20, stiffness: 180, mass: 0.9 }
// Lifetime of the entrance overlay. A plain timer (NOT the spring's settle
// callback) removes it after this long, regardless of whether the spring
// actually finished — so an Android relayout / activity-recreation storm that
// preempts the spring can never strand the overlay. Kept slightly longer than
// the spring's visual settle so the cream rect is already full-screen when it
// hands off to the (same-cream) form layer beneath it.
const ENTER_MS = 480
const CLOSE_MS = 300
// Close mirror: navigation fires from BOTH the close animation's completion AND
// this un-preemptible deadline, whichever lands first (runNav is latched). The
// recreation storm can swallow the animated callback; this timer cannot.
const CLOSE_BACKSTOP_MS = 500

type Phase = 'entering' | 'open' | 'closing'

export default function AddRoute() {
  const { width: SW, height: SH } = useWindowDimensions()
  const { fabLayout } = useAddTransition()
  const fab = fabLayout.value ?? { x: SW / 2 - 29, y: SH - 80, width: 58, height: 58 }

  // The single source of truth for what is on screen. Plain React state so it
  // survives an activity-recreation re-render exactly like any other component
  // state — the morph's SharedValue does NOT gate visibility.
  const [phase, setPhase] = useState<Phase>('entering')

  // Drives ONLY the transient morph overlay. Never gates the form.
  const progress = useSharedValue(0)

  // Synchronous close latch. `phase` is React state and commits asynchronously,
  // so two close/save calls in the SAME render turn (e.g. a cancel+save race)
  // could both pass a `phase === 'closing'` guard before the re-render lands —
  // overwriting navAction and re-arming the animation/timer (the second action
  // would win, e.g. saving then landing on the Library instead of the new
  // taste). A ref flips synchronously, so the second call is a true no-op.
  const closingRef = useRef(false)
  const navAction = useRef<(() => void) | null>(null)
  const navigated = useRef(false)
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Entrance: play the morph, then HARD-remove the overlay on a plain timer.
  // When the timer fires we flip to 'open' → the overlay unmounts and the form
  // layer (already mounted underneath) becomes the visible, bulletproof screen.
  // Runs once on mount (covers initial push AND any remount): the entrance
  // always completes via the timer, so there is no trigger to "miss".
  useEffect(() => {
    progress.value = withSpring(1, SPRING)
    // Functional update: only promote entering→open. If a close started before
    // the entrance timer fired (fast cancel), this must NOT clobber 'closing'
    // back to 'open' and re-show the form mid-exit.
    const t = setTimeout(() => setPhase((p) => (p === 'entering' ? 'open' : p)), ENTER_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (navTimer.current) clearTimeout(navTimer.current)
    }
  }, [])

  // Run the pending close navigation exactly once — from whichever of the close
  // animation callback or the CLOSE_BACKSTOP_MS deadline fires first.
  const runNav = useCallback(() => {
    if (navigated.current) return
    navigated.current = true
    if (navTimer.current) clearTimeout(navTimer.current)
    navAction.current?.()
  }, [])

  // Start the exit morph (full-screen → FAB) AND arm the un-preemptible nav
  // backstop. The form layer hides immediately (phase==='closing'); the overlay
  // shrinks back to the FAB. Navigation is guaranteed by runNav regardless of
  // whether the animation completes, so the route always unmounts.
  const startClose = useCallback(
    (action: () => void) => {
      if (closingRef.current) return
      closingRef.current = true
      navAction.current = action
      setPhase('closing')
      progress.value = 1
      progress.value = withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.ease) }, () => {
        runOnJS(runNav)()
      })
      if (navTimer.current) clearTimeout(navTimer.current)
      navTimer.current = setTimeout(runNav, CLOSE_BACKSTOP_MS)
    },
    [progress, runNav],
  )

  const handleClose = useCallback(() => {
    startClose(() => router.back())
  }, [startClose])

  const handleSaved = useCallback(
    (id: string) => {
      startClose(() => router.replace(`/taste/${id}`))
    },
    [startClose],
  )

  const containerStyle = useAnimatedStyle(() => {
    const p = progress.value
    return {
      position: 'absolute',
      left: interpolate(p, [0, 1], [fab.x, 0]),
      top: interpolate(p, [0, 1], [fab.y, 0]),
      width: interpolate(p, [0, 1], [fab.width, SW]),
      height: interpolate(p, [0, 1], [fab.height, SH]),
      borderRadius: interpolate(p, [0, 1], [fab.width / 2, 0]),
      backgroundColor: interpolateColor(p, [0, 0.5, 1], ['#ff2e88', '#fff0e0', '#fff6e6']),
      // On CLOSE, dissolve the overlay through its final stretch so it never
      // lands as a crisp pink FAB circle (+ icon) that visibly hangs for the
      // frames between progress reaching 0 and the route unmounting. Entrance
      // keeps full opacity (the FAB grows in solidly).
      opacity: phase === 'closing' ? interpolate(p, [0, 0.35], [0, 1], 'clamp') : 1,
      overflow: 'hidden' as const,
    }
  })

  const sourceStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.3], [1, 0], 'clamp'),
    transform: [{ scale: interpolate(progress.value, [0, 0.3], [1, 0.5], 'clamp') }],
  }))

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* TRANSITION TOUCH SHIELD.
          /add is a transparentModal, so during the entrance/exit the Library
          underneath stays visible AND touchable. Without this, a tap on a list
          card mid-morph would navigate the screen behind the opening Add form.
          A transparent full-screen View with pointerEvents 'auto' consumes those
          touches (RN does not alpha-test hit detection). Rendered only while NOT
          open and beneath the form/overlay (which are pointerEvents none during
          the transition), so it catches everything that would otherwise leak.
          When 'open', the opaque form layer (pointerEvents auto) takes over. */}
      {phase !== 'open' ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="auto" />
      ) : null}

      {/* STEADY, BULLETPROOF FORM LAYER.
          Full-screen; its opacity/visibility is a pure function of the plain
          `phase` state, NEVER of `progress` — this is what survives activity
          recreation (a normal RN view that no SharedValue can hide).
          Background is opaque cream only when 'open'; transparent while
          'closing' so the morph shrink + Library reveal show through.

          The form CONTENT mounts only at 'open' and is wrapped in reanimated
          layout animations (FadeIn/FadeOut). These are SAFE: their RESTING style
          is the static opacity above (so a recreation just shows the form — it
          can never strand at a SharedValue-driven opacity); they only animate
          the one-shot mount/unmount transition, giving the form content the
          materialize-in / dissolve-out feel without re-coupling visibility to
          `progress`. */}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: phase === 'closing' ? 'transparent' : '#fff6e6',
            opacity: phase === 'entering' ? 0 : 1,
          },
        ]}
        pointerEvents={phase === 'open' ? 'auto' : 'none'}
      >
        {phase === 'open' ? (
          <Animated.View
            style={{ flex: 1 }}
            entering={FadeIn.duration(240)}
            exiting={FadeOut.duration(160)}
          >
            <AddErrorBoundary onClose={handleClose}>
              <AddModal onClose={handleClose} onSaved={handleSaved} />
            </AddErrorBoundary>
          </Animated.View>
        ) : null}
      </View>

      {/* TRANSIENT MORPH OVERLAY — entrance & exit only.
          Removed when phase flips to 'open' (entrance timer) or when the route
          unmounts after close. pointerEvents none so it never traps touches even
          if a frame strands. */}
      {phase !== 'open' ? (
        <Animated.View style={containerStyle} pointerEvents="none">
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
        </Animated.View>
      ) : null}
    </View>
  )
}
