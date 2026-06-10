const React = require('react')

const useSharedValue = (init) => ({ value: init })
const useAnimatedStyle = (fn) => fn()
const withSpring = (v) => v
const withTiming = (v) => v
const withDelay = (_d, v) => v
const interpolateColor = (_v, _input, output) => output[0]
const runOnJS = (fn) => fn

// useReducedMotion: always returns false in tests (animation is "allowed").
// Tests that want reduced-motion behaviour can jest.mock this per-test.
const useReducedMotion = () => false

// useAnimatedReaction: in the Jest environment shared values are plain objects
// with no UI-thread reactivity.  We bridge by calling the reaction on every
// render (via useEffect with no stable dep list so it always re-runs after
// state changes) so the display state tracks whatever shared.value holds at
// that point — which, after withTiming resolves synchronously in tests, is
// the target value.
const useAnimatedReaction = (prepare, react) => {
  const { useEffect, useRef } = require('react')
  // We purposely omit deps here so the effect re-runs after every commit,
  // keeping display state in sync with shared.value in the synchronous mock.
  const prevRef = useRef(undefined)
  useEffect(() => {
    const result = prepare()
    if (result !== prevRef.current) {
      prevRef.current = result
      react(result, null)
    }
  })
}

const FadeIn = { duration: () => FadeIn }
const FadeOut = { duration: () => FadeOut }

const Animated = {
  View: React.forwardRef((props, ref) =>
    React.createElement('View', { ...props, ref })
  ),
  Text: React.forwardRef((props, ref) =>
    React.createElement('Text', { ...props, ref })
  ),
  ScrollView: React.forwardRef((props, ref) =>
    React.createElement('ScrollView', { ...props, ref })
  ),
}

module.exports = {
  __esModule: true,
  default: Animated,
  ...Animated,
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  useReducedMotion,
  withSpring,
  withTiming,
  withDelay,
  interpolateColor,
  runOnJS,
  interpolate: (v, _input, output) => output[0],
  interpolateColor,
  FadeIn,
  FadeOut,
  Easing: { in: (e) => e, out: (e) => e, ease: (v) => v, cubic: (v) => v },
}
