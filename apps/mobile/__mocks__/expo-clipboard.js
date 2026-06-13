'use strict'
// Jest stub for expo-clipboard (S3a 可导入 patch).
// setStringAsync: 可导入 share writes the 口令 to the clipboard.
// getStringAsync: foreground auto-detect reads the clipboard once.
// Tests grab these fns via require('expo-clipboard') and drive them.
const setStringAsync = jest.fn(() => Promise.resolve(true))
const getStringAsync = jest.fn(() => Promise.resolve(''))

module.exports = { setStringAsync, getStringAsync }
