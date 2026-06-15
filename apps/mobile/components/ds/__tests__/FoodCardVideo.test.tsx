/* ============================================================
   S3b Phase 2 — FoodCard video play-overlay (D2).

   Behavior under test:
   - When mediaType==='video', the card renders a play-button overlay on the
     poster (testID 'food-card-play-overlay') so the user knows tapping opens the
     player. The poster image itself still renders unchanged.
   - Image rows (mediaType undefined / 'image') render NO overlay — pinning the
     no-regression contract: a normal photo card is visually untouched.

   FoodCard is a pure component (no async effects), so a synchronous
   act(() => create(...)) mount adds no act warnings (act-gate stays at baseline).
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Image as ExpoImage } from 'expo-image'
import { FoodCard } from '../FoodCard'

function render(props: React.ComponentProps<typeof FoodCard>) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<FoodCard {...props} />)
  })
  return renderer
}

function findOverlay(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((n) => n.props.testID === 'food-card-play-overlay')
}

describe('FoodCard — video play overlay (D2)', () => {
  it('renders a play-button overlay for a video record (poster still renders)', () => {
    const renderer = render({
      imageThumb: 'https://cdn.example.com/t/uuid/poster.webp?sig=a',
      imageKey: 'tastes/u1/uuid',
      name: 'Ramen pull',
      verdict: 'yum',
      mediaType: 'video',
    })

    // The overlay is present (a real RN View matches as both composite + host
    // under findAll, so assert presence rather than an exact node count).
    expect(findOverlay(renderer).length).toBeGreaterThan(0)
    // The poster image still renders (video record reuses the image pipeline).
    expect(renderer.root.findAllByType(ExpoImage).length).toBe(1)
  })

  it('renders NO overlay for an image record (no regression)', () => {
    const renderer = render({
      imageThumb: 'https://cdn.example.com/t/uuid/thumb.webp?sig=a',
      imageKey: 'tastes/u1/uuid',
      name: 'Espresso',
      verdict: 'yum',
      // mediaType omitted ≡ image
    })

    expect(findOverlay(renderer).length).toBe(0)
    // The image still renders exactly as before.
    expect(renderer.root.findAllByType(ExpoImage).length).toBe(1)
  })

  it('renders NO overlay when mediaType is explicitly image', () => {
    const renderer = render({
      imageThumb: 'https://cdn.example.com/t/uuid/thumb.webp?sig=a',
      name: 'Latte',
      verdict: 'meh',
      mediaType: 'image',
    })
    expect(findOverlay(renderer).length).toBe(0)
  })
})
