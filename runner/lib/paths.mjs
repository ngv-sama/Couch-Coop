// Where Couch Co-op keeps things on disk. Everything lives under one folder
// the person can open, back up or delete: ~/.couch-coop by default.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function expandHome(p) {
  if (!p) return p
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

export function dataHome() {
  return path.resolve(expandHome(process.env.COUCH_COOP_HOME || '~/.couch-coop'))
}

export function paths(options = {}) {
  const home = dataHome()
  return {
    home,
    wads: path.join(home, 'wads'),
    roms: path.resolve(expandHome(options.romsFolder || path.join(home, 'roms'))),
    saves: path.join(home, 'saves'),
    doomSaves: path.join(home, 'saves', 'doom'),
    gameboySaves: path.join(home, 'saves', 'gameboy'),
  }
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Writes a file so a reader never sees it half written. */
export function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

/** A file name safe to use as a folder name for saves. */
export function slug(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'game'
}
