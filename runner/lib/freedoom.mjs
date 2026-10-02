// Freedoom: the free, BSD-licensed game data Doom runs with out of the box.
// Downloaded once from the Freedoom project's GitHub release, checked against
// pinned SHA-256 sums, and kept in ~/.couch-coop/wads.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { ensureDir, writeFileAtomic } from './paths.mjs'
import { extractZipEntry } from './zip.mjs'

export const FREEDOOM = Object.freeze({
  version: '0.13.0',
  url: 'https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip',
  zipSha256: '3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59',
  zipBytes: 24143781,
  wadName: 'freedoom1.wad',
  wadSha256: '7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d',
})

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex')

function hasGoodWad(file) {
  try {
    return fs.statSync(file).isFile() && sha256(fs.readFileSync(file)) === FREEDOOM.wadSha256
  } catch {
    return false
  }
}

/**
 * Makes sure freedoom1.wad is in `wadsDir` and returns its path.
 * `onProgress(fraction)` is called while downloading.
 */
export async function ensureFreedoom(wadsDir, onProgress = () => {}) {
  ensureDir(wadsDir)
  const wadFile = path.join(wadsDir, FREEDOOM.wadName)
  if (hasGoodWad(wadFile)) return wadFile

  const response = await fetch(FREEDOOM.url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Could not download Freedoom (HTTP ${response.status}). Check your internet connection and try again.`)
  }
  const total = Number(response.headers.get('content-length')) || FREEDOOM.zipBytes
  const chunks = []
  let received = 0
  for await (const chunk of response.body) {
    chunks.push(chunk)
    received += chunk.length
    onProgress(Math.min(1, received / total))
  }
  const zip = Buffer.concat(chunks)
  if (sha256(zip) !== FREEDOOM.zipSha256) {
    throw new Error('The Freedoom download did not match its expected checksum, so it was not used. Try again later.')
  }
  const wad = extractZipEntry(zip, FREEDOOM.wadName)
  if (sha256(wad) !== FREEDOOM.wadSha256) {
    throw new Error('freedoom1.wad did not match its expected checksum, so it was not used.')
  }
  writeFileAtomic(wadFile, wad)
  writeFileAtomic(path.join(wadsDir, 'FREEDOOM-COPYING.txt'), extractZipEntry(zip, 'COPYING.txt'))
  return wadFile
}
