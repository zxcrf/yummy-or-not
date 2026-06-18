/* ============================================================
   Regression — PageHeader centered title must not clip its glyphs.

   User report: 「我的口味」/「标签管理」/「家人」 centered titles had their
   top and bottom clipped on Android. Cause: the 28px bold title had no
   explicit lineHeight, so the default line box was tighter than the ink
   bounds of bold CJK glyphs and Android cropped them.

   These tests pin the fix at the SOURCE layer (the style), independent of
   any device render: the title style must declare an explicit lineHeight
   that is at least as large as the fontSize, and must keep
   includeFontPadding on (the ascent/descent padding that protects glyphs).

   FAILS against the old code (no lineHeight on the title style → undefined,
   which is < fontSize). Passes once the explicit line box is added.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { StyleSheet } from 'react-native'
import { PageHeader } from '../PageHeader'

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

function render(node: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(node)
  })
  return renderer
}

// Find the <Text> node that carries the string title and return its flattened style.
function titleStyleFor(title: string) {
  const renderer = render(<PageHeader title={title} />)
  const textNode = renderer.root.findAll(
    (n) =>
      (n.type as unknown) === 'Text' &&
      // react-test-renderer host 'Text' has children equal to the string.
      (n.props.children === title ||
        (Array.isArray(n.props.children) && n.props.children.includes(title))),
  )[0]
  expect(textNode).toBeDefined()
  return StyleSheet.flatten(textNode.props.style) as Record<string, unknown>
}

describe('PageHeader centered string title — anti-clip line box', () => {
  it.each(['我的口味', '标签管理', '家人'])(
    'gives "%s" an explicit lineHeight >= fontSize so glyphs are not clipped',
    (title) => {
      const style = titleStyleFor(title)
      const fontSize = style.fontSize as number
      const lineHeight = style.lineHeight as number | undefined

      expect(typeof fontSize).toBe('number')
      // The regression: lineHeight must exist and not be tighter than the glyph.
      expect(typeof lineHeight).toBe('number')
      expect(lineHeight).toBeGreaterThanOrEqual(fontSize)
    },
  )

  it('keeps includeFontPadding on (protects ascent/descent of bold CJK glyphs)', () => {
    const style = titleStyleFor('我的口味')
    expect(style.includeFontPadding).toBe(true)
  })
})
