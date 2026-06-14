/* ============================================================
   Regression — the "tag" icon glyph (标签管理 row).

   The 我的 tag-management row passes <Icon name="tag" />, but the icon
   registry had NO "tag" glyph, so Icon.tsx (unknown name → render
   nothing) drew a blank. Pins:
   - "tag" is a registered icon name with a non-empty path string.
   - <Icon name="tag" /> renders a real <Path> with a non-empty `d`
     (i.e. NOT the null/blank branch).
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { Path } from 'react-native-svg'

import { Icon } from '../Icon'
import { ICON_NAMES, ICON_PATHS } from '../icon-paths'

const mountedRenderers: TestRenderer.ReactTestRenderer[] = []

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(element)
  })
  mountedRenderers.push(renderer)
  return renderer
}

afterEach(() => {
  act(() => {
    mountedRenderers.forEach((r) => r.unmount())
  })
  mountedRenderers.length = 0
})

describe('Icon — "tag" glyph', () => {
  it('"tag" is a registered icon name with a non-empty path', () => {
    expect(ICON_NAMES).toContain('tag')
    expect(typeof ICON_PATHS.tag).toBe('string')
    expect(ICON_PATHS.tag.length).toBeGreaterThan(0)
  })

  it('renders a non-blank <Path> for name="tag" (not the unknown-name null branch)', () => {
    const renderer = render(<Icon name="tag" size={20} color="#5a4f63" />)
    const paths = renderer.root.findAllByType(Path)
    expect(paths).toHaveLength(1)
    expect(typeof paths[0].props.d).toBe('string')
    expect(paths[0].props.d.length).toBeGreaterThan(0)
  })

  it('renders nothing for a truly unknown name (guards the test above is meaningful)', () => {
    const renderer = render(<Icon name="definitely-not-an-icon" size={20} />)
    expect(renderer.root.findAllByType(Path)).toHaveLength(0)
  })
})
