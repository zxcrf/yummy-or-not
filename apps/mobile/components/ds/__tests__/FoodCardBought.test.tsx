/* ============================================================
   Regression — FoodCard purchase badge must be hidden for todo cards.

   Bug: boughtCount is derived server-side as `1 + purchaseCount`, so a fresh
   todo (zero purchases) reports boughtCount=1. FoodCard rendered the
   "购买 N 次" / "Bought N×" tag whenever boughtCount was truthy, with no
   status guard, so EVERY 想吃 (todo) card showed "购买 1 次". Todos have never
   been bought — the badge must only appear on tasted cards.
   ============================================================ */

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

function hasText(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return (
    renderer.root.findAll((n) => n.props && n.props.children === text).length > 0
  )
}

describe('FoodCard — purchase badge by status', () => {
  it('shows the bought badge for a tasted card with boughtCount', () => {
    const renderer = render({
      name: 'Espresso',
      status: 'tasted',
      verdict: 'yum',
      boughtCount: 1,
      boughtLabel: '购买 1 次',
    })
    expect(hasText(renderer, '购买 1 次')).toBe(true)
  })

  it('hides the bought badge for a todo card even when boughtCount is 1', () => {
    const renderer = render({
      name: 'Matcha Latte',
      status: 'todo',
      boughtCount: 1,
      boughtLabel: '购买 1 次',
      todoLabel: '想吃',
    })
    expect(hasText(renderer, '购买 1 次')).toBe(false)
  })
})
