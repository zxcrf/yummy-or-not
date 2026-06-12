import TestRenderer, { act } from 'react-test-renderer'

jest.mock('expo-image', () => ({ Image: () => null }), { virtual: true })

import { FoodCard } from '../FoodCard'

function render(props: React.ComponentProps<typeof FoodCard>) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<FoodCard {...props} />)
  })
  return renderer
}

function findPressables(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((node) => {
    if (typeof node.type === 'string') return false
    return node.type?.displayName === 'Pressable' || node.type?.name === 'Pressable'
  })
}

describe('FoodCard press handling', () => {
  it('routes taps through a react-native Pressable when onPress is set', () => {
    const onPress = jest.fn()
    const renderer = render({ name: 'x', onPress })

    const pressables = findPressables(renderer)
    expect(pressables).toHaveLength(1)
    expect(pressables[0].props.onPress).toBe(onPress)

    act(() => {
      pressables[0].props.onPress()
    })
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  // Regression: the inner CardFrame must NOT receive the `interactive` variant
  // when wrapped in a Pressable. `interactive` injects a Tamagui `pressStyle`,
  // which registers a native touch responder on CardFrame; nested inside the
  // outer Pressable it wins the gesture and swallows the tap, so onPress never
  // fires on device (cards stopped opening detail). react-test-renderer can't
  // simulate native responder negotiation, so we pin the structural cause: no
  // node may carry interactive={true} (nor a pressStyle) in the onPress path.
  it('does not give CardFrame an interactive/pressStyle responder under Pressable', () => {
    const renderer = render({ name: 'x', onPress: jest.fn() })
    const offenders = renderer.root.findAll(
      (node) =>
        node.props?.interactive === true || node.props?.pressStyle != null,
    )
    expect(offenders).toHaveLength(0)
  })

  // A caller could try to forward `interactive`/`pressStyle` through ...rest;
  // FoodCard must NOT pass unknown props through to inner nodes. These props
  // are no longer part of FoodCardProps (they were Tamagui-era), so the cast
  // simulates a JS caller or a `as any` boundary forwarding stale props.
  it('drops interactive/pressStyle even when passed via props', () => {
    const renderer = render({
      name: 'x',
      onPress: jest.fn(),
      // deliberately forwarding now-invalid props via any-cast (JS boundary sim)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ interactive: true, pressStyle: { scale: 0.9 } } as any),
    })
    // Scope under the Pressable so we inspect the rendered CardFrame subtree,
    // not the FoodCard root element's own incoming props.
    const pressable = findPressables(renderer)[0]
    const offenders = pressable.findAll(
      (node) =>
        node.props?.interactive === true || node.props?.pressStyle != null,
    )
    expect(offenders).toHaveLength(0)
  })

  it('still renders a non-interactive card when onPress is absent', () => {
    const renderer = render({ name: 'x' })
    expect(findPressables(renderer)).toHaveLength(0)
  })
})
