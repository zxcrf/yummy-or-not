/* ============================================================
   Regression tests — FoodCard list thumbnail (disk-cache key).

   Behavior under test:
   - FoodCard renders its photo through expo-image (not RN Image) so a stable
     disk cacheKey can outlive the per-request signed-URL rotation.
   - The thumbnail source is imageThumb (falling back to image), and the
     cacheKey is `${imageKey}:thumb` when imageKey is present.
   - When imageKey is empty/absent, the source carries NO cacheKey (URL keys it).
   ============================================================ */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Image as ExpoImage } from 'expo-image'
import { FoodCard } from '../FoodCard'

// The verdict stamp + tag pull in tamagui internals; the tamagui CJS stub
// (jest.config moduleNameMapper) covers them. Icon/animation are pure.

function render(props: React.ComponentProps<typeof FoodCard>) {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(<FoodCard {...props} />)
  })
  return renderer
}

function findExpoImages(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAllByType(ExpoImage)
}

describe('FoodCard thumbnail image', () => {
  it('renders imageThumb through expo-image with a :thumb cacheKey', () => {
    const renderer = render({
      imageThumb: 'https://cdn.example.com/t/uuid/thumb.webp?sig=a',
      image: 'https://example.com/orig.jpg',
      imageKey: 'tastes/u1/uuid',
      name: 'Espresso',
      verdict: 'yum',
    })

    const images = findExpoImages(renderer)
    expect(images.length).toBe(1)
    expect(images[0].props.source).toEqual({
      uri: 'https://cdn.example.com/t/uuid/thumb.webp?sig=a',
      cacheKey: 'tastes/u1/uuid:thumb',
    })
    expect(images[0].props.cachePolicy).toBe('disk')
  })

  it('falls back to image and omits cacheKey when imageKey is empty', () => {
    const renderer = render({
      imageThumb: undefined,
      image: 'https://example.com/legacy.jpg',
      imageKey: '',
      name: 'Espresso',
      verdict: 'yum',
    })

    const images = findExpoImages(renderer)
    expect(images.length).toBe(1)
    expect(images[0].props.source).toEqual({ uri: 'https://example.com/legacy.jpg' })
    expect(images[0].props.source.cacheKey).toBeUndefined()
  })

  it('renders no image when neither imageThumb nor image is set', () => {
    const renderer = render({ name: 'Espresso', verdict: 'yum' })
    expect(findExpoImages(renderer).length).toBe(0)
  })
})
