'use strict'
/* Jest stub for expo-video (S3b Phase 2).
   expo-video is a native module with no JS fallback, so jest-expo can't load
   the real package (it reads `prototype` off a missing native binding). This
   stub gives the player + view + imperative player surface our code touches:
   - useVideoPlayer(source, setup) → a fake player whose addListener records the
     statusChange callback so a test can drive an 'error' status.
   - VideoView → an inert host element (tests assert on its `player` prop).
   - createVideoPlayer(uri) → a fake player exposing generateThumbnailsAsync +
     release (used by extractVideoPoster; that module is mocked separately in its
     own suite, but this keeps any incidental import safe).
   Tests that need precise control re-mock 'expo-video' inline. */
const React = require('react')

function makePlayer() {
  const listeners = {}
  return {
    play: jest.fn(),
    pause: jest.fn(),
    release: jest.fn(),
    status: 'idle',
    addListener: jest.fn((event, cb) => {
      listeners[event] = cb
      return { remove: jest.fn() }
    }),
    // Test hook: synchronously fire a recorded listener.
    __emit(event, payload) {
      listeners[event]?.(payload)
    },
    generateThumbnailsAsync: jest.fn(() => Promise.resolve([])),
  }
}

const useVideoPlayer = jest.fn((_source, setup) => {
  const player = makePlayer()
  if (typeof setup === 'function') setup(player)
  return player
})

const createVideoPlayer = jest.fn(() => makePlayer())

const VideoView = (props) => React.createElement('VideoView', props, props.children)

module.exports = { useVideoPlayer, createVideoPlayer, VideoView }
