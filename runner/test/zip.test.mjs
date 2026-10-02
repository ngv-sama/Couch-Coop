import assert from 'node:assert/strict'
import { test } from 'node:test'
import zlib from 'node:zlib'

import { extractZipEntry, listZip } from '../lib/zip.mjs'

/** Builds a small ZIP in memory: one stored entry and one deflated entry. */
function makeZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content, method] of files) {
    const data = method === 8 ? zlib.deflateRawSync(content) : content
    const nameBytes = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDirectory, end])
}

const zip = makeZip([
  ['game/COPYING.txt', Buffer.from('free as in freedom'), 0],
  ['game/game.wad', Buffer.from('IWAD'.repeat(500)), 8],
])

test('listZip reads every entry', () => {
  assert.deepEqual(listZip(zip).map(e => e.name), ['game/COPYING.txt', 'game/game.wad'])
})

test('extractZipEntry returns stored and deflated files by name', () => {
  assert.equal(extractZipEntry(zip, 'COPYING.txt').toString(), 'free as in freedom')
  assert.equal(extractZipEntry(zip, 'game.wad').toString(), 'IWAD'.repeat(500))
})

test('extractZipEntry names what is missing', () => {
  assert.throws(() => extractZipEntry(zip, 'doom2.wad'), /doom2\.wad is not in the archive/)
  assert.throws(() => listZip(Buffer.from('not a zip at all, sorry')), /Not a ZIP archive/)
})
