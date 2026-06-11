'use strict'
// Jest stub for react-native-view-shot.
// captureRef resolves with a fake file:// tmpfile path.
const captureRef = jest.fn(() => Promise.resolve('file:///tmp/share-card-test.png'))

module.exports = { captureRef, default: { captureRef } }
