/* ============================================================
   Regression — static (non-interactive) Tag forwards testID and
   accessibilityLabel to the root View.

   Finding: the static Tag path (onPress absent) omitted ...rest,
   silently dropping testID and a11y props.

   Fix: explicitly destructure and forward testID, accessibilityLabel,
   accessibilityHint, accessibilityRole from rest to the root View.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Tag } from '../Tag'

function render(props: React.ComponentProps<typeof Tag>) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<Tag {...props} />)
  })
  return renderer
}

describe('Tag static — testID forwarded (finding: rest props dropped)', () => {
  it('forwards testID to root View when no onPress', () => {
    const renderer = render({ testID: 'tag-food', children: 'Food' })
    const nodes = renderer.root.findAll((n) => n.props.testID === 'tag-food')
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('forwards accessibilityLabel to root View when no onPress', () => {
    const renderer = render({ accessibilityLabel: 'Food category', children: 'Food' })
    const nodes = renderer.root.findAll(
      (n) => n.props.accessibilityLabel === 'Food category',
    )
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('forwards accessibilityRole to root View when no onPress', () => {
    const renderer = render({
      accessibilityRole: 'text' as const,
      children: 'Static',
    })
    const nodes = renderer.root.findAll((n) => n.props.accessibilityRole === 'text')
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('still renders without any rest props (no error)', () => {
    expect(() => {
      act(() => {
        TestRenderer.create(<Tag>Static</Tag>)
      })
    }).not.toThrow()
  })
})

describe('Tag interactive — rest props still forwarded via Pressable', () => {
  it('testID reaches the Pressable when onPress present', () => {
    const renderer = render({
      testID: 'tag-interactive',
      onPress: jest.fn(),
      children: 'Click me',
    })
    const nodes = renderer.root.findAll((n) => n.props.testID === 'tag-interactive')
    expect(nodes.length).toBeGreaterThan(0)
  })
})
