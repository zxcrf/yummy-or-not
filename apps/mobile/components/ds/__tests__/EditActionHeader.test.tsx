/* ============================================================
   EditActionHeader regression tests.

   Pins the unified 3-slot action bar contract (ADR 0001):
   1. renders cancelLabel / title / primaryLabel.
   2. pressing cancel calls onCancel.
   3. pressing primary calls onPrimary.
   4. primaryDisabled blocks onPrimary (Pressable.disabled at OS level).
   5. primaryLoading renders <ActivityIndicator>, NOT the primary label.
   6. variant 'screen' applies borderBottomWidth 3; 'sheet' does not.

   Mount pattern follows docs/engineering/jest-async-leaks.md:
   `await act(async)` + afterEach unmount of every renderer.
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { ActivityIndicator } from 'react-native'

// Provide a deterministic safe-area inset without a provider (matches the
// AddModalFooter test pattern). The component calls useSafeAreaInsets().
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}))

import { EditActionHeader } from '../EditActionHeader'

// Track every mounted renderer so afterEach can unmount it — prevents the
// Linux CI exit-1 async-leak class (act-warning grep must stay 0).
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
  onCancel: jest.fn(),
  cancelLabel: 'Cancel',
  title: 'Edit taste',
  onPrimary: jest.fn(),
  primaryLabel: 'Save',
}

function findByText(renderer: TestRenderer.ReactTestRenderer, text: string) {
  return renderer.root.findAll(
    (node) =>
      typeof node.props.children === 'string' && node.props.children === text,
  )
}

describe('EditActionHeader — slot labels', () => {
  it('renders cancelLabel, title, and primaryLabel', async () => {
    const renderer = await render(<EditActionHeader {...baseProps} />)
    expect(findByText(renderer, 'Cancel').length).toBeGreaterThan(0)
    expect(findByText(renderer, 'Edit taste').length).toBeGreaterThan(0)
    expect(findByText(renderer, 'Save').length).toBeGreaterThan(0)
  })
})

describe('EditActionHeader — cancel slot', () => {
  it('calls onCancel when the left control is pressed', async () => {
    const onCancel = jest.fn()
    const renderer = await render(
      <EditActionHeader {...baseProps} onCancel={onCancel} cancelTestID="cancel-btn" />,
    )
    const cancel = renderer.root.findByProps({ testID: 'cancel-btn' })
    act(() => {
      cancel.props.onPress()
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('EditActionHeader — primary slot', () => {
  it('calls onPrimary when the right command is pressed', async () => {
    const onPrimary = jest.fn()
    const renderer = await render(
      <EditActionHeader {...baseProps} onPrimary={onPrimary} primaryTestID="primary-btn" />,
    )
    const primary = renderer.root.findByProps({ testID: 'primary-btn' })
    act(() => {
      primary.props.onPress({ nativeEvent: {} })
    })
    expect(onPrimary).toHaveBeenCalledTimes(1)
  })

  it('blocks onPrimary when primaryDisabled (Pressable disabled at OS level)', async () => {
    const onPrimary = jest.fn()
    const renderer = await render(
      <EditActionHeader
        {...baseProps}
        onPrimary={onPrimary}
        primaryTestID="primary-btn"
        primaryDisabled
      />,
    )
    // The underlying Button Pressable carries disabled=true so the OS blocks
    // the tap — a real user tap never reaches onPrimary.
    const disabledPressable = renderer.root.findAll(
      (node) =>
        node.props.testID === 'primary-btn' && node.props.disabled === true,
    )
    expect(disabledPressable.length).toBeGreaterThan(0)
  })
})

describe('EditActionHeader — primaryLoading', () => {
  it('renders ActivityIndicator instead of the primary label', async () => {
    const renderer = await render(
      <EditActionHeader {...baseProps} primaryLabel="Save" primaryLoading />,
    )
    expect(() => renderer.root.findByType(ActivityIndicator)).not.toThrow()
    expect(findByText(renderer, 'Save').length).toBe(0)
  })
})

describe('EditActionHeader — variant bottom border', () => {
  function flatStyles(renderer: TestRenderer.ReactTestRenderer) {
    // Collect every node style (object or array) flattened into plain objects.
    const out: Record<string, unknown>[] = []
    renderer.root.findAll(() => true).forEach((node) => {
      const s = node.props.style
      if (!s) return
      ;(Array.isArray(s) ? s : [s]).forEach((entry) => {
        if (entry && typeof entry === 'object') out.push(entry as Record<string, unknown>)
      })
    })
    return out
  }

  it("variant 'screen' applies borderBottomWidth 3", async () => {
    const renderer = await render(<EditActionHeader {...baseProps} variant="screen" />)
    const hasBorder = flatStyles(renderer).some((s) => s.borderBottomWidth === 3)
    expect(hasBorder).toBe(true)
  })

  it("variant 'sheet' does NOT apply a bottom border", async () => {
    const renderer = await render(<EditActionHeader {...baseProps} variant="sheet" />)
    const hasBorder = flatStyles(renderer).some((s) => s.borderBottomWidth === 3)
    expect(hasBorder).toBe(false)
  })
})
