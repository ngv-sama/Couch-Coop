// What can be played: Doom with Freedoom (always), Doom with any WAD the
// person adds, the bundled homebrew Game Boy game, and any Game Boy ROM the
// person adds to their ROMs folder.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { FREEDOOM } from './freedoom.mjs'

const BUNDLED_ROMS = fileURLToPath(new URL('../roms/', import.meta.url))
const ROM_EXTENSIONS = new Set(['.gb', '.gbc'])
// Friendly names for the homebrew games that ship with Couch Co-op.
const BUNDLED_TITLES = {
  'libbet.gb': 'Libbet and the Magic Floor (homebrew)',
}
const WAD_TITLES = {
  'doom1.wad': 'Doom (shareware)',
  'doom.wad': 'Doom',
  'doom2.wad': 'Doom II',
  'freedoom2.wad': 'Freedoom: Phase 2',
}

const listFiles = (dir, keep) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && keep(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

const titleFromFile = name => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim()

/** Every game the launcher lists, in order. */
export function library(dirs) {
  const entries = [{
    id: `doom:${FREEDOOM.wadName}`,
    kind: 'doom',
    title: 'Doom (Freedoom: Phase 1)',
    file: path.join(dirs.wads, FREEDOOM.wadName),
    origin: 'free',
  }]
  for (const name of listFiles(dirs.wads, n => n.toLowerCase().endsWith('.wad') && n !== FREEDOOM.wadName)) {
    entries.push({ id: `doom:${name}`, kind: 'doom', title: WAD_TITLES[name.toLowerCase()] ?? `Doom: ${titleFromFile(name)}`, file: path.join(dirs.wads, name), origin: 'yours' })
  }
  const bundledDir = BUNDLED_ROMS
  for (const name of listFiles(bundledDir, n => ROM_EXTENSIONS.has(path.extname(n).toLowerCase()))) {
    entries.push({ id: `gameboy:bundled:${name}`, kind: 'gameboy', title: BUNDLED_TITLES[name] ?? titleFromFile(name), file: path.join(bundledDir, name), origin: 'free' })
  }
  for (const name of listFiles(dirs.roms, n => ROM_EXTENSIONS.has(path.extname(n).toLowerCase()))) {
    entries.push({ id: `gameboy:${name}`, kind: 'gameboy', title: titleFromFile(name), file: path.join(dirs.roms, name), origin: 'yours' })
  }
  return entries
}

/** Finds a game by id, or by a loose name match (`/gameboy pokemon`). */
export function findGame(entries, query, kind) {
  const pool = kind ? entries.filter(e => e.kind === kind) : entries
  const exact = pool.find(e => e.id === query)
  if (exact) return exact
  const needle = String(query ?? '').toLowerCase().trim()
  if (!needle) return pool[0] ?? null
  return pool.find(e => e.title.toLowerCase().includes(needle) || path.basename(e.file).toLowerCase().includes(needle)) ?? null
}
