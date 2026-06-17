/* ============================================================
   ConfirmSheet unit tests.

   Pins the shared dim-overlay confirm contract:
   (a) visible=false renders nothing; visible=true renders title+body.
   (b) tapping the overlay calls onDismiss.
   (c) tapping the confirm button calls onConfirm.
   (d) exactly ONE button exists (no 继续编辑 / second action).

   Mount pattern follows docs/engineering/jest-async-leaks.md:
   `await act(async)` + afterEach unmount of every renderer.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Button } from '../Button'
import { ConfirmSheet } from '../ConfirmSheet'

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

async function render(ui: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(ui)
  })
  mountedRenderers.push(renderer)
  return renderer
}

afterEach(() => {
  act(() => {
    mountedRenderers.splice(0).forEach((r) => r.unmount())
  })
})

const baseProps = {
  title: 'Discard changes?',
  body: 'Your unsaved changes will be lost.',
  confirmLabel: 'Discard',
  onConfirm: jest.fn(),
  onDismiss: jest.fn(),
}

function findByText(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAll(
    (node) =>
      typeof node.props.children === 'string' && node.props.children === text,
  )
}

describe('ConfirmSheet — visibility', () => {
  it('renders null when visible=false', async () => {
    const renderer = await render(
      <ConfirmSheet {...baseProps} visible={false} />,
    )
    // The component returns null — tree root is null/empty.
    expect(renderer.toJSON()).toBeNull()
  })

  it('renders title and body when visible=true', async () => {
    const renderer = await render(
      <ConfirmSheet {...baseProps} visible testID="confirm-sheet" />,
    )
    expect(findByText(renderer, 'Discard changes?').length).toBeGreaterThan(0)
    expect(findByText(renderer, 'Your unsaved changes will be lost.').length).toBeGreaterThan(0)
  })
})

describe('ConfirmSheet — dismiss (overlay tap)', () => {
  it('calls onDismiss when the dim overlay is pressed', async () => {
    const onDismiss = jest.fn()
    const renderer = await render(
      <ConfirmSheet
        {...baseProps}
        visible
        onDismiss={onDismiss}
        testID="confirm-sheet"
      />,
    )
    // findByProps may resolve to the underlying native View — search for the
    // node that has both testID and onPress (the Pressable fiber instance).
    const overlay = renderer.root.findAll(
      (node) => node.props.testID === 'confirm-sheet' && typeof node.props.onPress === 'function',
    )
    expect(overlay.length).toBeGreaterThan(0)
    act(() => {
      overlay[0].props.onPress()
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('ConfirmSheet — confirm button', () => {
  it('calls onConfirm when the confirm button is pressed', async () => {
    const onConfirm = jest.fn()
    const renderer = await render(
      <ConfirmSheet
        {...baseProps}
        visible
        onConfirm={onConfirm}
        testID="confirm-sheet"
      />,
    )
    const confirmBtn = renderer.root.findByProps({ testID: 'confirm-sheet-confirm' })
    act(() => {
      confirmBtn.props.onPress({ nativeEvent: {} })
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('renders exactly ONE Button (no secondary/cancel action)', async () => {
    const renderer = await render(
      <ConfirmSheet {...baseProps} visible testID="confirm-sheet" />,
    )
    const buttons = renderer.root.findAllByType(Button)
    expect(buttons).toHaveLength(1)
  })
})
