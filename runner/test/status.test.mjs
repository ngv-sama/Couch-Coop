import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeDoom, describeStatus, isTyping } from '../lib/status.mjs'

// gamestate, menu, paused, automap, demo, episode, map, playerstate, health, armor, weapon, ammo, kills, totalKills, typingSaveName
const PLAYING = [0, 0, 0, 0, 0, 1, 3, 0, 87, 25, 2, 8, 4, 30, 0]

test('describes play: level, health, armor, weapon, ammo and kills', () => {
  assert.equal(describeDoom(PLAYING), 'In E1M3: health 87%, armor 25%, shotgun, 8 ammo, kills 4/30.')
})

test('says how to start from the title screen or a demo', () => {
  const demo = [...PLAYING]
  demo[4] = 1
  assert.match(describeDoom(demo), /No game is running/)
  assert.match(describeDoom(demo), /menu, then enter/)
})

test('the menu, death and the tally screen each say what to press', () => {
  const menu = [...PLAYING]
  menu[1] = 1
  assert.match(describeDoom(menu), /menu is open/)
  const dead = [...PLAYING]
  dead[7] = 1
  assert.match(describeDoom(dead), /You died in E1M3\. Press use/)
  const tally = [...PLAYING]
  tally[0] = 1
  assert.match(describeDoom(tally), /Level complete/)
})

test('games without status say nothing', () => {
  assert.equal(describeStatus('gameboy', []), '')
  assert.equal(describeDoom([]), 'Doom is starting.')
})

test('knows when Doom waits for a typed save name', () => {
  const typing = [...PLAYING]
  typing[1] = 1
  typing[14] = 1
  assert.equal(isTyping('doom', typing), true)
  assert.match(describeDoom(typing), /type it with a text step/)
  assert.equal(isTyping('doom', PLAYING), false)
  assert.equal(isTyping('gameboy', typing), false)
})
