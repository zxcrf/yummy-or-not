'use strict'
// Jest stub for react-native-qrcode-svg (S3a 可导入 card QR).
// Renders a sentinel 'QRCodeMock' node carrying the `value` (the https landing
// URL) so ShareCard tests can assert the QR was rendered with the right URL
// without depending on the real SVG internals (or react-native-svg).
const React = require('react')

function QRCode(props) {
  return React.createElement('QRCodeMock', props)
}

module.exports = QRCode
module.exports.default = QRCode
module.exports.__esModule = true
