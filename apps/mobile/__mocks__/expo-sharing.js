'use strict'
// Jest stub for expo-sharing.
const isAvailableAsync = jest.fn(() => Promise.resolve(true))
const shareAsync = jest.fn(() => Promise.resolve())

module.exports = { isAvailableAsync, shareAsync }
