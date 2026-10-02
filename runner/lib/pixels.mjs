// Turning a game frame into what the terminal draws: a Raster of half-block
// cells, a raw RGB file for terminals with pixel graphics, or a PNG.

import zlib from 'node:zlib'

const UPPER_HALF_BLOCK = 0x2580 // '▀': foreground paints the top pixel, background the bottom

/** Reads pixel `i` of a frame as [r, g, b], whatever byte order the core used. */
function channelOffsets(format) {
  return format === 'bgrx' ? [2, 1, 0] : [0, 1, 2]
}

/**
 * The largest Raster that fits `maxColumns` x `maxRows` and keeps the
 * picture's shape. A half-block cell holds two square pixels stacked, so the
 * Raster is `columns` pixels wide and `2 * rows` pixels tall.
 */
export function fitRaster(maxColumns, maxRows, aspect) {
  const columns = Math.max(1, Math.min(512, Math.floor(maxColumns), Math.floor(2 * maxRows * aspect)))
  const rows = Math.max(1, Math.min(256, Math.round(columns / aspect / 2)))
  return { columns, rows }
}

/**
 * Precomputed source ranges for each destination pixel along one axis, so a
 * frame is box-filtered without recomputing the mapping every time.
 */
function spans(sourceLength, targetLength) {
  const starts = new Int32Array(targetLength)
  const ends = new Int32Array(targetLength)
  for (let i = 0; i < targetLength; i++) {
    const start = Math.floor((i * sourceLength) / targetLength)
    const end = Math.max(start + 1, Math.floor(((i + 1) * sourceLength) / targetLength))
    starts[i] = start
    ends[i] = Math.min(sourceLength, end)
  }
  return { starts, ends }
}

const spanCache = new Map()
function cachedSpans(sourceLength, targetLength) {
  const key = `${sourceLength}:${targetLength}`
  let value = spanCache.get(key)
  if (!value) {
    value = spans(sourceLength, targetLength)
    if (spanCache.size > 64) spanCache.clear()
    spanCache.set(key, value)
  }
  return value
}

/**
 * Box-filters a frame down (or up) to `width` x `height` pixels and returns
 * packed 0x00RRGGBB colors, row-major.
 */
export function resample(frame, width, height) {
  const [ro, go, bo] = channelOffsets(frame.format)
  const xs = cachedSpans(frame.width, width)
  const ys = cachedSpans(frame.height, height)
  const out = new Uint32Array(width * height)
  const src = frame.data
  const stride = frame.width * 4
  for (let y = 0; y < height; y++) {
    const y0 = ys.starts[y]
    const y1 = ys.ends[y]
    for (let x = 0; x < width; x++) {
      const x0 = xs.starts[x]
      const x1 = xs.ends[x]
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        let p = sy * stride + x0 * 4
        for (let sx = x0; sx < x1; sx++, p += 4) {
          r += src[p + ro]
          g += src[p + go]
          b += src[p + bo]
          n++
        }
      }
      out[y * width + x] = (((r / n) & 255) << 16) | (((g / n) & 255) << 8) | ((b / n) & 255)
    }
  }
  return out
}

/**
 * Raster cells (RasterProps.cells) for a frame drawn `columns` x `rows`:
 * base64 of little-endian u32 triplets [codePoint, foreground, background].
 * The terminal paints 1024 color pairs exactly and the rest as their nearest,
 * which looks better than reducing the palette here.
 */
export function encodeRaster(frame, columns, rows) {
  const pixels = resample(frame, columns, rows * 2)
  const cells = new Uint32Array(columns * rows * 3)
  for (let row = 0; row < rows; row++) {
    const top = row * 2 * columns
    const bottom = top + columns
    for (let col = 0; col < columns; col++) {
      const i = (row * columns + col) * 3
      cells[i] = UPPER_HALF_BLOCK
      cells[i + 1] = pixels[top + col]
      cells[i + 2] = pixels[bottom + col]
    }
  }
  return Buffer.from(cells.buffer).toString('base64')
}

/** The frame as tightly packed RGB bytes, scaled by a whole-number factor. */
export function toRgb(frame, scale = 1, aspectHeight = frame.height) {
  const [ro, go, bo] = channelOffsets(frame.format)
  const width = frame.width * scale
  const height = Math.round(aspectHeight * scale)
  const out = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(frame.height - 1, Math.floor((y * frame.height) / height))
    for (let x = 0; x < width; x++) {
      const sx = Math.floor(x / scale)
      const p = (sy * frame.width + sx) * 4
      const o = (y * width + x) * 3
      out[o] = frame.data[p + ro]
      out[o + 1] = frame.data[p + go]
      out[o + 2] = frame.data[p + bo]
    }
  }
  return { width, height, data: out }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** Encodes RGB bytes as a PNG file. */
export function encodePng({ width, height, data }) {
  const rowLength = width * 3 + 1
  const raw = Buffer.alloc(rowLength * height)
  for (let y = 0; y < height; y++) {
    raw[y * rowLength] = 0 // filter: none
    data.copy(raw, y * rowLength + 1, y * width * 3, (y + 1) * width * 3)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // color type: RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
