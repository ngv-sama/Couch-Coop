// Just enough of the ZIP format to pull one file out of an archive held in
// memory: read the central directory, find the entry, inflate it.

import zlib from 'node:zlib'

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_FILE_HEADER = 0x02014b50
const LOCAL_FILE_HEADER = 0x04034b50

function findEndOfCentralDirectory(buffer) {
  const earliest = Math.max(0, buffer.length - 0xffff - 22)
  for (let i = buffer.length - 22; i >= earliest; i--) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) return i
  }
  throw new Error('Not a ZIP archive: no end-of-central-directory record')
}

/** Lists the entries of a ZIP archive. */
export function listZip(buffer) {
  const end = findEndOfCentralDirectory(buffer)
  const count = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)
  const entries = []
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) throw new Error('Corrupt ZIP central directory')
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const size = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    entries.push({ name, method, compressedSize, size, localOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** Returns the bytes of the entry whose name ends with `suffix`. */
export function extractZipEntry(buffer, suffix) {
  const entry = listZip(buffer).find(e => e.name === suffix || e.name.endsWith(`/${suffix}`))
  if (!entry) throw new Error(`${suffix} is not in the archive`)
  const at = entry.localOffset
  if (buffer.readUInt32LE(at) !== LOCAL_FILE_HEADER) throw new Error('Corrupt ZIP local header')
  const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28)
  const data = buffer.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(data)
  if (entry.method === 8) return zlib.inflateRawSync(data)
  throw new Error(`Unsupported ZIP compression method ${entry.method}`)
}
