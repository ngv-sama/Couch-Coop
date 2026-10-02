import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { findGame, library } from '../lib/library.mjs'

function tempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'couch-coop-test-'))
  const dirs = { wads: path.join(root, 'wads'), roms: path.join(root, 'roms') }
  fs.mkdirSync(dirs.wads)
  fs.mkdirSync(dirs.roms)
  return dirs
}

test('lists Freedoom first, then added WADs, the bundled homebrew and added ROMs', () => {
  const dirs = tempDirs()
  fs.writeFileSync(path.join(dirs.wads, 'doom2.wad'), '')
  fs.writeFileSync(path.join(dirs.roms, 'Pokemon Red.gb'), '')
  fs.writeFileSync(path.join(dirs.roms, 'notes.txt'), '')
  const games = library(dirs)
  assert.deepEqual(games.map(g => g.title), [
    'Doom (Freedoom: Phase 1)',
    'Doom II',
    'Libbet and the Magic Floor (homebrew)',
    'Pokemon Red',
  ])
  assert.deepEqual(games.map(g => g.origin), ['free', 'yours', 'free', 'yours'])
})

test('findGame matches an id, a loose name, or the first of a kind', () => {
  const dirs = tempDirs()
  fs.writeFileSync(path.join(dirs.roms, 'Pokemon Crystal.gbc'), '')
  const games = library(dirs)
  assert.equal(findGame(games, 'crystal').title, 'Pokemon Crystal')
  assert.equal(findGame(games, '', 'gameboy').title, 'Libbet and the Magic Floor (homebrew)')
  assert.equal(findGame(games, 'doom:freedoom1.wad').kind, 'doom')
  assert.equal(findGame(games, 'zelda'), null)
})

test('a missing ROMs folder just lists nothing extra', () => {
  const games = library({ wads: '/nonexistent/wads', roms: '/nonexistent/roms' })
  assert.equal(games.length, 2)
})
