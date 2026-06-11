/* ============================================================
   ShareCard unit tests — A1 regression pins.

   Pin: RN Image (via expo-image) used, never raw <img>.
   Pin: numberOfLines=2 on name (overflow guard).
   Pin: no-photo fallback renders no Image, shows verdict-color header.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { ShareCard } from '../ShareCard'
import type { Taste } from '@yon/shared'

const BASE_TASTE: Taste = {
  id: 'taste-1',
  name: 'Brown Sugar Boba',
  place: 'Tiger Sugar · Hongdae',
  price: '5.80',
  status: 'tasted',
  verdict: 'yum',
  warnBeforeBuy: false,
  boughtCount: 1,
  tags: [],
  notes: '',
  date: '2026-06-11',
  imageThumb: 'https://cdn.example.com/thumb.jpg?X-Amz-Signature=abc123',
  image: '',
  imageDisplay: '',
  imageKey: 'img-key-1',
  purchases: [],
  createdAt: '2026-06-11T00:00:00.000Z',
}

const NO_PHOTO_TASTE: Taste = {
  ...BASE_TASTE,
  imageThumb: '',
  image: '',
  imageKey: '',
}

function render(ui: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(ui)
  })
  return renderer
}

describe('ShareCard', () => {
  it('renders via expo-image (ViewManagerAdapter_ExpoImage), never a raw <img>', () => {
    const renderer = render(
      <ShareCard
        taste={BASE_TASTE}
        verdictLabel="YUM"
        brandText="Logged with Yummy or Not · yon.baobao.click"
        priceText="$5.80"
      />,
    )

    // expo-image renders as ViewManagerAdapter_ExpoImage in the test renderer.
    // Find at least one such node — this pins that we are using expo-image, not
    // a raw <img> element which crashes native builds.
    const expoImageNodes = renderer.root.findAll(
      (node) => typeof node.type === 'string' && node.type.includes('ExpoImage'),
    )
    expect(expoImageNodes.length).toBeGreaterThanOrEqual(1)

    const tree = JSON.stringify(renderer.toJSON())
    expect(tree).not.toMatch(/"type":\s*"img"/)
  })

  it('pins numberOfLines=2 on the name text node', () => {
    const renderer = render(
      <ShareCard
        taste={BASE_TASTE}
        verdictLabel="YUM"
        brandText="Logged with Yummy or Not"
        priceText="$5.80"
      />,
    )

    // Find the Text node whose children match the name
    const nameNode = renderer.root
      .findAll((node) => String(node.type) === 'Text' && node.props.numberOfLines === 2)
    expect(nameNode.length).toBeGreaterThanOrEqual(1)
    // Verify it actually contains the name
    const nameText = nameNode.find((n) =>
      String(n.props.children).includes('Brown Sugar Boba'),
    )
    expect(nameText).toBeTruthy()
  })

  it('no-photo taste: renders no Image element, shows a verdict-color header View', () => {
    const renderer = render(
      <ShareCard
        taste={NO_PHOTO_TASTE}
        verdictLabel="YUM"
        brandText="Logged with Yummy or Not"
        priceText=""
      />,
    )

    // No expo-image node rendered when there is no photo
    const images = renderer.root.findAll(
      (node) => typeof node.type === 'string' && node.type.includes('ExpoImage'),
    )
    expect(images).toHaveLength(0)

    // The verdict-color header View should carry the yum green background
    const tree = JSON.stringify(renderer.toJSON())
    expect(tree).toMatch(/#14c46b/) // verdictYum resolved hex
  })

  it('presigned query string never appears in any Text node children', () => {
    // The source URI (with a presigned query string) lives in the image source
    // prop — that is the correct place for it. What must not happen is the URL
    // leaking into visible text nodes (name, place, brand tag, etc.).
    // The actual share payload is only the tmpfile captured by captureRef,
    // not the source URI — that pin lives in DetailViewShare.test.tsx.
    const renderer = render(
      <ShareCard
        taste={BASE_TASTE}
        verdictLabel="YUM"
        brandText="Logged with Yummy or Not"
        priceText="$5.80"
      />,
    )

    // Collect all Text-node string children and assert none contain the query param.
    const textNodes = renderer.root.findAll((node) => String(node.type) === 'Text')
    for (const node of textNodes) {
      const content = String(node.props.children ?? '')
      expect(content).not.toMatch(/X-Amz-Signature/)
    }
  })
})
