/* Container Transform: FAB rect morphs into full-screen Add modal.
   A single persistent container animates from FAB bounds {x,y,58,58,r:29}
   to full screen {0,0,SW,SH,r:0}. Source content (+ icon) fades out early,
   destination content (AddModal) fades in through the same container.
   On close: reverse. */

import { useEffect, useRef } from 'react'
import { StyleSheet, useWindowDimensions } from 'react-native'
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
import { router } from 'expo-router'

import AddModal from '@/components/app/AddModal'
import { Icon } from '@/components/ds'
import { useAddTransition } from '@/providers/AddTransitionProvider'

const SPRING = { damping: 20, stiffness: 180, mass: 0.9 }

export default function AddRoute() {
  const { width: SW, height: SH } = useWindowDimensions()
  const { fabLayout } = useAddTransition()
  const fab = fabLayout.value ?? { x: SW / 2 - 29, y: SH - 80, width: 58, height: 58 }
  const closing = useRef(false)

  const progress = useSharedValue(0)

  useEffect(() => {
    progress.value = withSpring(1, SPRING)
  }, [progress])

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
        [0, 0.4, 1],
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
    opacity: interpolate(progress.value, [0.4, 0.75], [0, 1], 'clamp'),
  }))

  const handleClose = () => {
    if (closing.current) return
    closing.current = true
    progress.value = withTiming(0, {
      duration: 350,
      easing: Easing.in(Easing.ease),
    }, () => {
      runOnJS(router.back)()
    })
  }

  const handleSaved = (id: string) => {
    if (closing.current) return
    closing.current = true
    progress.value = withTiming(0, {
      duration: 300,
      easing: Easing.in(Easing.ease),
    }, () => {
      runOnJS(router.replace)(`/taste/${id}`)
    })
  }

  return (
    <Animated.View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={containerStyle}>
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
