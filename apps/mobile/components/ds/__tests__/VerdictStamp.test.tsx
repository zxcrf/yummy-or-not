/* ============================================================
   VerdictStamp tests — §6 requirements:
   1. Renders a View (no Pressable — static stamp)
   2. style? pass-through reaches the rendered View
      (pins the FoodCard position-via-style path)
   3. Correct verdict colors in rendered styles
   4. rotate prop applies a transform
   5. showFace=false omits the face text
   ============================================================ */
import TestRenderer, { act } from 'react-test-renderer'
import { StyleSheet } from 'react-native'
import { VerdictStamp } from '../VerdictStamp'

function render(props: React.ComponentProps<typeof VerdictStamp>) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<VerdictStamp {...props} />)
  })
  return renderer
}

function findOuterView(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((n) => (n.type as unknown as string) === 'View')[0]
}

describe('VerdictStamp — static render', () => {
  it('renders a View (no Pressable)', () => {
    const renderer = render({ verdict: 'yum' })
    const pressables = renderer.root.findAll(
      (n) => typeof n.type !== 'string' &&
        (n.type?.displayName === 'Pressable' || n.type?.name === 'Pressable'),
    )
    expect(pressables).toHaveLength(0)
    expect(findOuterView(renderer)).toBeTruthy()
  })

  it('renders YUM label by default', () => {
    const renderer = render({ verdict: 'yum' })
    const texts = renderer.root.findAll((n) => (n.type as unknown as string) === 'Text')
    const labels = texts.map((t) => t.props.children)
    expect(labels).toContain('YUM')
  })

  it('renders MEH label for meh verdict', () => {
    const renderer = render({ verdict: 'meh' })
    const texts = renderer.root.findAll((n) => (n.type as unknown as string) === 'Text')
    expect(texts.map((t) => t.props.children)).toContain('MEH')
  })

  it('renders NAH label for nah verdict', () => {
    const renderer = render({ verdict: 'nah' })
    const texts = renderer.root.findAll((n) => (n.type as unknown as string) === 'Text')
    expect(texts.map((t) => t.props.children)).toContain('NAH')
  })

  it('renders custom label when provided', () => {
    const renderer = render({ verdict: 'yum', label: 'GREAT' })
    const texts = renderer.root.findAll((n) => (n.type as unknown as string) === 'Text')
    expect(texts.map((t) => t.props.children)).toContain('GREAT')
  })

  it('omits face text when showFace=false', () => {
    const renderer = render({ verdict: 'yum', showFace: false })
    const texts = renderer.root.findAll((n) => (n.type as unknown as string) === 'Text')
    // Only one Text — the label; no face kaomoji
    expect(texts).toHaveLength(1)
    expect(texts[0].props.children).toBe('YUM')
  })

  it('shows face text when showFace=true (default)', () => {
    const renderer = render({ verdict: 'yum', showFace: true })
    const texts = renderer.root.findAll((n) => (n.type as unknown as string) === 'Text')
    // Two Texts: face + label
    expect(texts).toHaveLength(2)
  })
})

describe('VerdictStamp — verdict colors', () => {
  it('yum verdict uses verdictYum background color', () => {
    const renderer = render({ verdict: 'yum' })
    const view = findOuterView(renderer)
    const flat = StyleSheet.flatten(view.props.style)
    expect(flat.backgroundColor).toBe('#14c46b') // colors.verdictYum
  })

  it('meh verdict uses verdictMeh background color', () => {
    const renderer = render({ verdict: 'meh' })
    const view = findOuterView(renderer)
    const flat = StyleSheet.flatten(view.props.style)
    expect(flat.backgroundColor).toBe('#ffb20e') // colors.verdictMeh
  })

  it('nah verdict uses verdictNah background color', () => {
    const renderer = render({ verdict: 'nah' })
    const view = findOuterView(renderer)
    const flat = StyleSheet.flatten(view.props.style)
    expect(flat.backgroundColor).toBe('#ff3147') // colors.verdictNah
  })

  it('yum verdict uses verdictYum2 border color', () => {
    const renderer = render({ verdict: 'yum' })
    const view = findOuterView(renderer)
    const flat = StyleSheet.flatten(view.props.style)
    expect(flat.borderColor).toBe('#0a9b51') // colors.verdictYum2
  })
})

describe('VerdictStamp — style? pass-through (FoodCard position-via-style path)', () => {
  it('applies position style to the outer View', () => {
    const positionStyle = {
      position: 'absolute' as const,
      top: 8,
      right: 8,
    }
    const renderer = render({ verdict: 'yum', style: positionStyle })
    const view = findOuterView(renderer)
    const flat = StyleSheet.flatten(view.props.style)
    expect(flat.position).toBe('absolute')
    expect(flat.top).toBe(8)
    expect(flat.right).toBe(8)
  })

  it('caller style overrides base style when merged', () => {
    const renderer = render({ verdict: 'yum', style: { borderWidth: 10 } })
    const view = findOuterView(renderer)
    const flat = StyleSheet.flatten(view.props.style)
    // RN style arrays: last wins — caller's borderWidth should take effect
    expect(flat.borderWidth).toBe(10)
  })
})

describe('VerdictStamp — rotate prop', () => {
  it('applies a rotate transform when rotate is non-zero', () => {
    const renderer = render({ verdict: 'yum', rotate: -6 })
    const view = findOuterView(renderer)
    const flat = StyleSheet.flatten(view.props.style)
    // transform array should include a rotate entry
    const rotateEntry = (flat.transform as { rotate?: string }[] | undefined)
      ?.find((t) => 'rotate' in t)
    expect(rotateEntry?.rotate).toBe('-6deg')
  })

  it('has empty transform when rotate=0', () => {
    const renderer = render({ verdict: 'yum', rotate: 0 })
    const view = findOuterView(renderer)
    const flat = StyleSheet.flatten(view.props.style)
    // transform should be an empty array
    expect(flat.transform).toEqual([])
  })
})
