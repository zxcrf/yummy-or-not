/* ============================================================
   Regression test for the AddModal photo preview.

   Bug: the preview used a raw HTML <img> element. On native (EAS
   APK) builds that crashed the whole screen the instant a photo was
   selected/cropped:
     "View config getter callback for component `img` must be a
      function (received `undefined`)."

   These tests pin the fix: the preview must render via react-native's
   <Image> (a real RN host component), never a raw `img`, and it must
   pass the picked uri straight through as the Image source.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Image } from 'react-native'
import { PhotoPreview } from '../PhotoPreview'

const URI = 'file:///tmp/cropped-photo.jpg'

function renderPreview(uri: string): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<PhotoPreview uri={uri} />)
  })
  return renderer
}

describe('PhotoPreview', () => {
  it('renders a real react-native Image, not a raw <img>', () => {
    const renderer = renderPreview(URI)

    // A real RN Image element must be present in the tree.
    expect(renderer.root.findByType(Image)).toBeTruthy()

    // And the serialized host tree must never contain a raw `img` element —
    // that is exactly what crashed native builds.
    const tree = JSON.stringify(renderer.toJSON())
    expect(tree).not.toMatch(/"type":\s*"img"/)
  })

  it('passes the picked uri through as the Image source', () => {
    const renderer = renderPreview(URI)

    const image = renderer.root.findByType(Image)
    expect(image.props.source).toEqual({ uri: URI })
    expect(image.props.resizeMode).toBe('cover')
  })

  it('mounts cleanly without throwing', () => {
    // Smoke test: the component renders without error. (The original
    // "View config getter callback for component `img`" crash only surfaces
    // in the real native runtime; the type/source assertions above are the
    // actual guards against the <img> regression.)
    expect(() => renderPreview(URI)).not.toThrow()
  })
})
