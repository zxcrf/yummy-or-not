/* ============================================================
   VerdictPicker tests — §6 requirements:
   1. onChange fires when an option is pressed
   2. Selected option gets correct verdict colors
   3. accessibilityState.checked=true on selected option
   4. usePressScale(bouncy) 0.95 — Pressable renders for each option
   5. style? pass-through on the outer row container
   ============================================================ */
import TestRenderer, { act } from 'react-test-renderer'
import { StyleSheet } from 'react-native'
import { VerdictPicker } from '../VerdictPicker'

function render(props: React.ComponentProps<typeof VerdictPicker>) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<VerdictPicker {...props} />)
  })
  return renderer
}

function findPressables(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    (node) =>
      typeof node.type !== 'string' &&
      (node.type?.displayName === 'Pressable' || node.type?.name === 'Pressable'),
  )
}

// Find the Animated.View wrapper for each option.
// Each OptItem renders: Pressable > Animated.View (host 'View' in mock) > face Text + label Text
// The Animated.View carries the option background + border styles.
// Since OptItem is its own component, n.parent won't be 'Pressable' — instead we
// find all View nodes that carry borderWidth (the optBase style), which uniquely
// identifies the Animated.View option frames.
function findOptionViews(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((n) => {
    if ((n.type as unknown as string) !== 'View') return false
    const flat = StyleSheet.flatten(n.props.style)
    // optBase has borderWidth:3 and paddingVertical defined
    return flat != null && flat.borderWidth === 3 && flat.paddingVertical != null
  })
}

describe('VerdictPicker — renders 3 options', () => {
  it('renders a Pressable for each verdict option', () => {
    const renderer = render({ value: null, onChange: jest.fn() })
    const pressables = findPressables(renderer)
    expect(pressables).toHaveLength(3)
  })

  it('renders YUM / MEH / NAH labels', () => {
    const renderer = render({ value: null })
    const texts = renderer.root.findAll((n) => (n.type as unknown as string) === 'Text')
    const labels = texts.map((t) => t.props.children as string)
    expect(labels).toContain('YUM')
    expect(labels).toContain('MEH')
    expect(labels).toContain('NAH')
  })

  it('renders custom labels when provided', () => {
    const renderer = render({
      value: null,
      labels: { yum: 'LOVE IT', meh: 'MEH', nah: 'NOPE' },
    })
    const texts = renderer.root.findAll((n) => (n.type as unknown as string) === 'Text')
    const labels = texts.map((t) => t.props.children as string)
    expect(labels).toContain('LOVE IT')
    expect(labels).toContain('NOPE')
  })
})

describe('VerdictPicker — onChange', () => {
  it('calls onChange with the correct verdict when yum is pressed', () => {
    const onChange = jest.fn()
    const renderer = render({ value: null, onChange })

    const pressables = findPressables(renderer)
    act(() => {
      pressables[0].props.onPress()
    })
    expect(onChange).toHaveBeenCalledWith('yum')
  })

  it('calls onChange with meh when the second option is pressed', () => {
    const onChange = jest.fn()
    const renderer = render({ value: null, onChange })

    const pressables = findPressables(renderer)
    act(() => {
      pressables[1].props.onPress()
    })
    expect(onChange).toHaveBeenCalledWith('meh')
  })

  it('calls onChange with nah when the third option is pressed', () => {
    const onChange = jest.fn()
    const renderer = render({ value: null, onChange })

    const pressables = findPressables(renderer)
    act(() => {
      pressables[2].props.onPress()
    })
    expect(onChange).toHaveBeenCalledWith('nah')
  })

  it('does not throw when onChange is absent', () => {
    const renderer = render({ value: null })
    const pressables = findPressables(renderer)
    expect(() => {
      act(() => {
        pressables[0].props.onPress()
      })
    }).not.toThrow()
  })
})

describe('VerdictPicker — selected state', () => {
  it('sets accessibilityState.checked=true on the selected option', () => {
    const renderer = render({ value: 'yum', onChange: jest.fn() })
    const pressables = findPressables(renderer)
    // yum is index 0
    expect(pressables[0].props.accessibilityState?.checked).toBe(true)
    expect(pressables[1].props.accessibilityState?.checked).toBe(false)
    expect(pressables[2].props.accessibilityState?.checked).toBe(false)
  })

  it('sets accessibilityState.checked=true on meh when meh is selected', () => {
    const renderer = render({ value: 'meh', onChange: jest.fn() })
    const pressables = findPressables(renderer)
    expect(pressables[0].props.accessibilityState?.checked).toBe(false)
    expect(pressables[1].props.accessibilityState?.checked).toBe(true)
    expect(pressables[2].props.accessibilityState?.checked).toBe(false)
  })

  it('no option has checked=true when value is null', () => {
    const renderer = render({ value: null, onChange: jest.fn() })
    const pressables = findPressables(renderer)
    for (const p of pressables) {
      expect(p.props.accessibilityState?.checked).toBe(false)
    }
  })

  it('selected yum option uses verdictYum background color', () => {
    const renderer = render({ value: 'yum', onChange: jest.fn() })
    const optViews = findOptionViews(renderer)
    expect(optViews).toHaveLength(3)
    // First option frame corresponds to yum
    const flat = StyleSheet.flatten(optViews[0].props.style)
    expect(flat.backgroundColor).toBe('#14c46b') // colors.verdictYum
  })

  it('selected nah option uses verdictNah background color', () => {
    const renderer = render({ value: 'nah', onChange: jest.fn() })
    const optViews = findOptionViews(renderer)
    expect(optViews).toHaveLength(3)
    // nah is index 2
    const flat = StyleSheet.flatten(optViews[2].props.style)
    expect(flat.backgroundColor).toBe('#ff3147') // colors.verdictNah
  })

  it('unselected option uses white background', () => {
    const renderer = render({ value: 'yum', onChange: jest.fn() })
    const optViews = findOptionViews(renderer)
    expect(optViews).toHaveLength(3)
    // meh (index 1) is not selected
    const flat = StyleSheet.flatten(optViews[1].props.style)
    expect(flat.backgroundColor).toBe('#ffffff') // colors.white
  })
})

describe('VerdictPicker — press motion (bouncy 0.95)', () => {
  it('each option has onPressIn and onPressOut handlers', () => {
    const renderer = render({ value: null, onChange: jest.fn() })
    const pressables = findPressables(renderer)
    for (const p of pressables) {
      expect(typeof p.props.onPressIn).toBe('function')
      expect(typeof p.props.onPressOut).toBe('function')
    }
  })

  it('each option has accessibilityRole=radio', () => {
    const renderer = render({ value: null, onChange: jest.fn() })
    const pressables = findPressables(renderer)
    for (const p of pressables) {
      expect(p.props.accessibilityRole).toBe('radio')
    }
  })
})

describe('VerdictPicker — staticRender (Modal-safe, no Reanimated)', () => {
  // Inside a React Native <Modal> on the New Architecture, a flex:1
  // Reanimated Animated.View fails to lay out its Text children, so the option
  // boxes render blank (the promote sheet bug). staticRender drops Reanimated
  // for the option frames; press feedback degrades to an opacity dim applied
  // via the Pressable's style FUNCTION — which is the observable marker that the
  // static path is active.
  it('uses a style function on each option Pressable (opacity press feedback)', () => {
    const renderer = render({ value: null, onChange: jest.fn(), staticRender: true })
    const pressables = findPressables(renderer)
    expect(pressables).toHaveLength(3)
    for (const p of pressables) {
      expect(typeof p.props.style).toBe('function')
    }
  })

  it('the animated path keeps a non-function (static object) Pressable style', () => {
    const renderer = render({ value: null, onChange: jest.fn() })
    const pressables = findPressables(renderer)
    for (const p of pressables) {
      expect(typeof p.props.style).not.toBe('function')
    }
  })

  it('still renders all three faces and labels in static mode', () => {
    const renderer = render({
      value: null,
      staticRender: true,
      labels: { yum: '好吃', meh: '一般', nah: '别买' },
    })
    const texts = renderer.root
      .findAll((n) => (n.type as unknown as string) === 'Text')
      .map((t) => t.props.children as string)
    expect(texts).toContain('好吃')
    expect(texts).toContain('一般')
    expect(texts).toContain('别买')
    // faces from OPTS
    expect(texts).toContain('◕‿◕')
  })

  it('fires onChange from a static option press', () => {
    const onChange = jest.fn()
    const renderer = render({ value: null, onChange, staticRender: true })
    const pressables = findPressables(renderer)
    act(() => {
      pressables[2].props.onPress()
    })
    expect(onChange).toHaveBeenCalledWith('nah')
  })
})

describe('VerdictPicker — style? pass-through', () => {
  it('applies style to the outer row container', () => {
    const renderer = render({
      value: null,
      style: { marginTop: 16 },
    })
    // The outer container is the first View in the tree (the row wrapper)
    const outerView = renderer.root.findAll((n) => (n.type as unknown as string) === 'View')[0]
    const flat = StyleSheet.flatten(outerView.props.style)
    expect(flat.marginTop).toBe(16)
  })
})
