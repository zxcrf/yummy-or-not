/* ============================================================
   Regression — Button / IconButton apply pressedShadow.button on press.

   Finding: usePressNudge translated the button but never collapsed
   shadowOffset during press, so iOS pressed state didn't match the
   material-motion spec (5x5 → 0x0).

   Fix: Pressable render-prop form detects `pressed` and applies
   pressedShadow.button to the Animated.View style array.

   These tests verify that:
   1. When Pressable reports pressed=false, the shadow is NOT collapsed.
   2. When Pressable reports pressed=true, pressedShadow.button IS applied
      (shadowOffset {width:0, height:0}).
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { StyleSheet } from 'react-native'
import Animated from 'react-native-reanimated'
import { Button } from '../Button'
import { IconButton } from '../IconButton'

// Helper: flatten all style objects on an Animated.View node into one.
function flatStyle(node: TestRenderer.ReactTestInstance): Record<string, unknown> {
  return StyleSheet.flatten(node.props.style) ?? {}
}

// Find the Animated.View (rendered as a host 'View' by the Reanimated mock).
function findAnimatedView(renderer: TestRenderer.ReactTestRenderer) {
  const views = renderer.root.findAll((n) => (n.type as unknown as string) === 'View')
  // The outermost View that carries the Button frame styles (has borderWidth).
  return views.find((n) => {
    const s = flatStyle(n)
    return typeof s.borderWidth === 'number'
  })
}

describe('Button — pressedShadow.button applied on press (finding: shadow collapse)', () => {
  it('does NOT apply pressedShadow in unpressed state', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<Button>Test</Button>)
    })
    const frame = findAnimatedView(renderer)
    expect(frame).toBeTruthy()
    // In the default (unpressed) render-prop state the collapsed shadow
    // must not be present — popShadow.sm is {width:3,height:3}.
    const s = flatStyle(frame!)
    expect(s.shadowOffset).not.toEqual({ width: 0, height: 0 })
  })

  it('applies pressedShadow.button (0x0) when pressed=true', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      // Render with pressed=true by wrapping with a mock Pressable.
      // We test the render-prop result directly by calling the Pressable
      // children function.
      renderer = TestRenderer.create(<Button>Test</Button>)
    })

    // Find the Pressable and call its children function with pressed=true.
    const pressable = renderer.root.findAll(
      (n) => typeof n.type !== 'string' &&
        (n.type?.displayName === 'Pressable' || n.type?.name === 'Pressable'),
    )[0]
    expect(pressable).toBeTruthy()

    // The children of Pressable is a render-prop function; call it with pressed=true
    // and check the style includes the collapsed shadow.
    const renderProp = pressable.props.children
    expect(typeof renderProp).toBe('function')

    let pressedTree: TestRenderer.ReactTestRenderer
    act(() => {
      pressedTree = TestRenderer.create(renderProp({ pressed: true }))
    })

    const views = pressedTree!.root.findAll((n) => (n.type as unknown as string) === 'View')
    const frame = views.find((n) => {
      const s = flatStyle(n)
      return typeof s.borderWidth === 'number'
    })
    expect(frame).toBeTruthy()
    const s = flatStyle(frame!)
    // pressedShadow.button has shadowOffset {width:0, height:0}
    expect(s.shadowOffset).toEqual({ width: 0, height: 0 })
  })
})

describe('IconButton — pressedShadow.button applied on press (finding: shadow collapse)', () => {
  it('applies pressedShadow.button (0x0) when pressed=true', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<IconButton>X</IconButton>)
    })

    const pressable = renderer.root.findAll(
      (n) => typeof n.type !== 'string' &&
        (n.type?.displayName === 'Pressable' || n.type?.name === 'Pressable'),
    )[0]
    expect(pressable).toBeTruthy()

    const renderProp = pressable.props.children
    expect(typeof renderProp).toBe('function')

    let pressedTree: TestRenderer.ReactTestRenderer
    act(() => {
      pressedTree = TestRenderer.create(renderProp({ pressed: true }))
    })

    const views = pressedTree!.root.findAll((n) => (n.type as unknown as string) === 'View')
    const frame = views.find((n) => {
      const s = flatStyle(n)
      return typeof s.borderWidth === 'number'
    })
    expect(frame).toBeTruthy()
    const s = flatStyle(frame!)
    expect(s.shadowOffset).toEqual({ width: 0, height: 0 })
  })

  it('does NOT apply collapsed shadow when disabled', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(<IconButton disabled>X</IconButton>)
    })

    const pressable = renderer.root.findAll(
      (n) => typeof n.type !== 'string' &&
        (n.type?.displayName === 'Pressable' || n.type?.name === 'Pressable'),
    )[0]
    const renderProp = pressable.props.children
    let pressedTree: TestRenderer.ReactTestRenderer
    act(() => {
      pressedTree = TestRenderer.create(renderProp({ pressed: true }))
    })

    const views = pressedTree!.root.findAll((n) => (n.type as unknown as string) === 'View')
    const frame = views.find((n) => {
      const s = flatStyle(n)
      return typeof s.borderWidth === 'number'
    })
    expect(frame).toBeTruthy()
    // disabled=true → pressedShadow.button must NOT be applied
    const s = flatStyle(frame!)
    expect(s.shadowOffset).not.toEqual({ width: 0, height: 0 })
  })
})
