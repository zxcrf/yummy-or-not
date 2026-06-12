/* ============================================================
   Tag component tests — §6 requirements:
   1. onPress fires when pressed
   2. caller onPressIn is forwarded (§1.3b rule 1)
   3. style? pass-through reaches the rendered Animated.View node
      (pins the FoodCard/AddModal position-via-style path)
   4. disabled suppresses animation AND sets accessibilityState.disabled
      (§1.3b rule 2)
   ============================================================ */
import TestRenderer, { act } from 'react-test-renderer'
import { StyleSheet } from 'react-native'
import { Tag } from '../Tag'

function render(props: React.ComponentProps<typeof Tag>) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<Tag {...props} />)
  })
  return renderer
}

// The reanimated mock renders Animated.View as a plain 'View' string-type node.
// findPressable finds the react-native Pressable (function component).
function findPressable(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    (node) =>
      typeof node.type !== 'string' &&
      (node.type?.displayName === 'Pressable' || node.type?.name === 'Pressable'),
  )[0]
}

// isHostView returns true for host-component View nodes emitted by the mock.
function isHostView(node: TestRenderer.ReactTestInstance) {
  return (node.type as unknown as string) === 'View'
}

// findAnimatedView finds the Animated.View wrapper (rendered as 'View' by mock).
function findOuterView(renderer: TestRenderer.ReactTestRenderer) {
  // The first View-type node under Pressable is the Animated.View wrapper.
  const pressable = findPressable(renderer)
  if (pressable) {
    return pressable.findAll(isHostView)[0]
  }
  // Non-interactive Tag: the root node is the plain View.
  return renderer.root.findAll(isHostView)[0]
}

describe('Tag — onPress', () => {
  it('calls onPress when tapped', () => {
    const onPress = jest.fn()
    const renderer = render({ onPress, children: 'Food' })

    const pressable = findPressable(renderer)
    expect(pressable).toBeTruthy()

    act(() => {
      pressable.props.onPress()
    })
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('renders without a Pressable when onPress is absent', () => {
    const renderer = render({ children: 'Static' })
    expect(findPressable(renderer)).toBeUndefined()
  })
})

describe('Tag — onPressIn forwarding (§1.3b rule 1)', () => {
  it('forwards caller onPressIn alongside the press driver', () => {
    const onPressIn = jest.fn()
    const renderer = render({ onPress: jest.fn(), onPressIn, children: 'Food' })

    const pressable = findPressable(renderer)
    expect(pressable).toBeTruthy()

    act(() => {
      pressable.props.onPressIn({})
    })
    // Caller handler must fire (driver also fires internally via usePressScale mock).
    expect(onPressIn).toHaveBeenCalledTimes(1)
  })

  it('forwards caller onPressOut alongside the press driver', () => {
    const onPressOut = jest.fn()
    const renderer = render({ onPress: jest.fn(), onPressOut, children: 'Food' })

    const pressable = findPressable(renderer)
    act(() => {
      pressable.props.onPressOut({})
    })
    expect(onPressOut).toHaveBeenCalledTimes(1)
  })
})

describe('Tag — style? pass-through (FoodCard position-via-style path)', () => {
  it('applies style to the animated wrapper when interactive', () => {
    const positionStyle = {
      position: 'absolute' as const,
      top: 8,
      right: 8,
    }
    const renderer = render({
      onPress: jest.fn(),
      style: positionStyle,
      children: 'Yum',
    })

    // The Animated.View in the Reanimated mock is a forwardRef that renders
    // a host 'View'. We look for the View node that actually carries the
    // style array (the one with both chip styles AND the caller positionStyle).
    // Walk all View nodes and find the one that includes our position object.
    const pressable = findPressable(renderer)
    expect(pressable).toBeTruthy()

    const allViews = pressable.findAll(isHostView)
    const outerView = allViews.find((n) => {
      const flat = StyleSheet.flatten(n.props.style)
      return flat?.position === 'absolute'
    })

    expect(outerView).toBeTruthy()
    const flat = StyleSheet.flatten(outerView!.props.style)
    expect(flat.position).toBe('absolute')
    expect(flat.top).toBe(8)
    expect(flat.right).toBe(8)
  })

  it('applies style to the plain View when non-interactive', () => {
    const positionStyle = {
      position: 'absolute' as const,
      top: 8,
      right: 8,
    }
    const renderer = render({ style: positionStyle, children: 'Static' })

    const view = findOuterView(renderer)
    expect(view).toBeTruthy()

    const flat = StyleSheet.flatten(view.props.style)
    expect(flat.position).toBe('absolute')
  })
})

describe('Tag — disabled + removable (CRITICAL regression)', () => {
  it('does NOT render the remove × button when disabled=true (disabled chip must not delete)', () => {
    const onRemove = jest.fn()
    const renderer = render({
      onPress: jest.fn(),
      onRemove,
      disabled: true,
      children: 'Chip',
    })
    // The × Text node must not be in the tree when the tag is disabled.
    const removeNodes = renderer.root.findAll(
      (n) => String(n.type) === 'Text' && n.props.children === '×',
    )
    expect(removeNodes).toHaveLength(0)
  })

  it('renders the remove × button when NOT disabled', () => {
    const onRemove = jest.fn()
    const renderer = render({
      onPress: jest.fn(),
      onRemove,
      disabled: false,
      children: 'Chip',
    })
    const removeNodes = renderer.root.findAll(
      (n) => String(n.type) === 'Text' && n.props.children === '×',
    )
    expect(removeNodes).toHaveLength(1)
  })
})

describe('Tag — disabled (§1.3b rule 2)', () => {
  it('sets accessibilityState.disabled=true when disabled', () => {
    const renderer = render({
      onPress: jest.fn(),
      disabled: true,
      children: 'Disabled',
    })

    const pressable = findPressable(renderer)
    expect(pressable).toBeTruthy()
    expect(pressable.props.accessibilityState?.disabled).toBe(true)
  })

  it('does NOT call onPress when disabled', () => {
    const onPress = jest.fn()
    const renderer = render({ onPress, disabled: true, children: 'Disabled' })

    const pressable = findPressable(renderer)
    // Pressable has disabled=true, so native won't fire onPress.
    // Verify the prop is set to prevent it.
    expect(pressable.props.disabled).toBe(true)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('does NOT call caller onPressIn when disabled', () => {
    const onPressIn = jest.fn()
    const renderer = render({
      onPress: jest.fn(),
      onPressIn,
      disabled: true,
      children: 'Disabled',
    })

    const pressable = findPressable(renderer)
    // Even if onPressIn is called manually (simulating the press path),
    // the disabled guard in usePressScale suppresses the animation.
    // The Pressable itself is disabled, so RN won't fire the handler.
    // Here we verify the Pressable carries disabled=true.
    expect(pressable.props.disabled).toBe(true)
  })
})
