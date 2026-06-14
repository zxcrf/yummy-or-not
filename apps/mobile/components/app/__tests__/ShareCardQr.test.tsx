/* ============================================================
   ShareCard QR tests — S3a 可导入 (淘口令) patch.

   Pins behavior NOT yet implemented → FAIL now, PASS after the patch:
   1. 可导入 mode: when a landing URL (https deep-link target for the token) is
      supplied, the card renders a QR code (react-native-qrcode-svg) encoding
      that URL so WeChat "识别图中二维码" jumps straight to the import landing.
   2. pure-PNG mode (no landing URL): the card renders NO QR — the link-free
      privacy guard. A pure image must never embed a scannable link.
   ============================================================ */

import TestRenderer, { act } from 'react-test-renderer'
import { ShareCard } from '../ShareCard'
import type { Taste } from '@yon/shared'

// react-native-qrcode-svg is mapped (via jest.config moduleNameMapper) to a
// stub that renders a sentinel 'QRCodeMock' node carrying the `value` prop, so
// we can assert the QR was rendered with the right landing URL without
// depending on its SVG internals (or react-native-svg).

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

function render(ui: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(ui)
  })
  return renderer
}

function qrNodes(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((node) => String(node.type) === 'QRCodeMock')
}

describe('ShareCard QR (S3a 可导入 mode)', () => {
  it('renders a QR encoding the landing URL when in 可导入 mode (landingUrl supplied)', () => {
    const LANDING = 'https://yon.baobao.click/i/AB12CD'
    const renderer = render(
      <ShareCard
        taste={BASE_TASTE}
        verdictLabel="YUM"
        brandText="Logged with Yummy or Not"
        priceText="$5.80"
        importCode="AB12CD"
        importCodeHint="Import in Yummy or Not with code"
        landingUrl={LANDING}
      />,
    )

    // The QR component was rendered…
    const qrs = qrNodes(renderer)
    expect(qrs.length).toBeGreaterThanOrEqual(1)
    // …encoding exactly the landing URL (so 识别图中二维码 reaches the token).
    const values = qrs.map((n) => String(n.props.value))
    expect(values).toContain(LANDING)
  })

  it('renders the QR as STANDARD dark-on-light (not inverted) so cameras / WeChat can scan it', () => {
    // Regression for issue #102: the QR was rendered inverted (color #fff on
    // backgroundColor #191017). Most phone cameras and WeChat "识别图中二维码"
    // fail on inverted QR, silently degrading 可导入 to a 淘口令-only share.
    // A scannable QR MUST be dark modules on a light/white background.
    const LANDING = 'https://yon.baobao.click/i/AB12CD'
    const renderer = render(
      <ShareCard
        taste={BASE_TASTE}
        verdictLabel="YUM"
        brandText="Logged with Yummy or Not"
        priceText="$5.80"
        importCode="AB12CD"
        importCodeHint="Import in Yummy or Not with code"
        landingUrl={LANDING}
      />,
    )

    const qr = qrNodes(renderer)[0]
    expect(qr).toBeTruthy()
    expect(qr.props.color).toBe('#191017') // dark modules
    expect(qr.props.backgroundColor).toBe('#fff') // light background
  })

  it('renders NO QR in pure-PNG mode (no landingUrl) — link-free privacy guard', () => {
    const renderer = render(
      <ShareCard
        taste={BASE_TASTE}
        verdictLabel="YUM"
        brandText="Logged with Yummy or Not"
        priceText="$5.80"
      />,
    )

    expect(qrNodes(renderer)).toHaveLength(0)
  })
})
