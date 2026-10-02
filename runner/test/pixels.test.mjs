import assert from 'node:assert/strict'
import { test } from 'node:test'
import zlib from 'node:zlib'

import { encodePng, encodeRaster, fitRaster, resample, toRgb } from '../lib/pixels.mjs'

/** A frame filled with one color, in the byte order a core uses. */
function solidFrame(width, height, [r, g, b], format = 'rgba') {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    if (format === 'bgrx') data.set([b, g, r, 0], i * 4)
    else data.set([r, g, b, 255], i * 4)
  }
  return { width, height, format, data }
}

test('fitRaster keeps the picture shape inside the room', () => {
  const doom = fitRaster(120, 40, 4 / 3)
  assert.ok(doom.columns <= 120 && doom.rows <= 40)
  assert.ok(Math.abs(doom.columns / (doom.rows * 2) - 4 / 3) < 0.05)
  const tall = fitRaster(300, 20, 4 / 3)
  assert.equal(tall.rows, 20)
  assert.equal(tall.columns, Math.floor(2 * 20 * 4 / 3))
})

test('fitRaster never goes below one cell or past the Raster limits', () => {
  assert.deepEqual(fitRaster(0, 0, 1), { columns: 1, rows: 1 })
  const huge = fitRaster(5000, 5000, 1)
  assert.ok(huge.columns <= 512 && huge.rows <= 256)
})

test('resample reads both byte orders the same way', () => {
  const rgba = resample(solidFrame(8, 8, [10, 20, 30], 'rgba'), 2, 2)
  const bgrx = resample(solidFrame(8, 8, [10, 20, 30], 'bgrx'), 2, 2)
  assert.deepEqual([...rgba], [...bgrx])
  assert.equal(rgba[0], (10 << 16) | (20 << 8) | 30)
})

test('encodeRaster packs one half-block cell per column and row', () => {
  const cells = Buffer.from(encodeRaster(solidFrame(16, 16, [255, 0, 0]), 4, 3), 'base64')
  assert.equal(cells.length, 4 * 3 * 12)
  const words = new Uint32Array(cells.buffer, cells.byteOffset, cells.length / 4)
  assert.equal(words[0], 0x2580)
  assert.equal(words[1], 0xff0000)
  assert.equal(words[2], 0xff0000)
})

test('toRgb scales and stretches to the display height', () => {
  const rgb = toRgb(solidFrame(4, 2, [1, 2, 3]), 2, 3)
  assert.equal(rgb.width, 8)
  assert.equal(rgb.height, 6)
  assert.deepEqual([...rgb.data.subarray(0, 3)], [1, 2, 3])
})

test('encodePng writes a PNG that inflates back to the pixels', () => {
  const rgb = toRgb(solidFrame(3, 2, [9, 8, 7]))
  const png = encodePng(rgb)
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(png.readUInt32BE(16), 3)
  assert.equal(png.readUInt32BE(20), 2)
  const idatAt = png.indexOf('IDAT')
  const length = png.readUInt32BE(idatAt - 4)
  const raw = zlib.inflateSync(png.subarray(idatAt + 4, idatAt + 4 + length))
  assert.equal(raw.length, (3 * 3 + 1) * 2)
  assert.deepEqual([...raw.subarray(1, 4)], [9, 8, 7])
})
