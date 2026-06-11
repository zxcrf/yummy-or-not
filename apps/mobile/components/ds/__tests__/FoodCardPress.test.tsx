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
})
