const React = require('react')

const useSharedValue = (init) => ({ value: init })
const useAnimatedStyle = (fn) => fn()
const withSpring = (v) => v
const withTiming = (v) => v
const withDelay = (_d, v) => v
const interpolateColor = (_v, _input, output) => output[0]
const runOnJS = (fn) => fn

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
  withSpring,
  withTiming,
  withDelay,
  interpolateColor,
  runOnJS,
  interpolate: (v, _input, output) => output[0],
  interpolateColor,
  FadeIn,
  FadeOut,
  Easing: { in: (e) => e, out: (e) => e, ease: (v) => v },
}
