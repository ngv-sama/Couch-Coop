import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GAMES } from '../lib/games.mjs'
import { InputController } from '../lib/input.mjs'

const TIMING = { firstPressMs: 40, repeatMs: 20, tapMs: 15 }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function recorder(game) {
  const events = []
  const input = new InputController(game, (code, isDown) => events.push([code, isDown]), TIMING)
  return { input, events }
}

test('Doom starts with run held on', () => {
  const { input, events } = recorder(GAMES.doom)
  assert.deepEqual(events, [[GAMES.doom.buttons.run, true]])
  assert.equal(input.isDown('run'), true)
})

test('a key press holds its button, then lets go when repeats stop', async () => {
  const { input, events } = recorder(GAMES.doom)
  events.length = 0
  assert.equal(input.personKey('w'), 'forward')
  assert.deepEqual(events, [[GAMES.doom.buttons.forward, true]])
  await wait(30)
  input.personKey('W') // an auto-repeat (shift does not matter) keeps it held
  await wait(10)
  assert.equal(input.isDown('forward'), true)
  await wait(40)
  assert.equal(input.isDown('forward'), false)
  assert.deepEqual(events.at(-1), [GAMES.doom.buttons.forward, false])
})

test('tap buttons press briefly and ignore auto-repeat', async () => {
  const { input, events } = recorder(GAMES.doom)
  events.length = 0
  input.personKey('e')
  input.personKey('e')
  assert.equal(events.length, 1)
  await wait(30)
  assert.deepEqual(events, [[GAMES.doom.buttons.use, true], [GAMES.doom.buttons.use, false]])
})

test('R toggles always-run', () => {
  const { input } = recorder(GAMES.doom)
  assert.equal(input.personKey('r'), 'run')
  assert.equal(input.isDown('run'), false)
  input.personKey('r')
  assert.equal(input.isDown('run'), true)
})

test('keys a game does not use are ignored', () => {
  const { input, events } = recorder(GAMES.gameboy)
  assert.equal(input.personKey('q'), null)
  assert.equal(input.personKey(''), null)
  assert.deepEqual(events, [])
})

test("Claude's steps hold buttons together for their time", async () => {
  const { input, events } = recorder(GAMES.gameboy)
  const b = GAMES.gameboy.buttons
  const slept = []
  await input.claudeSteps([{ buttons: ['up', 'a'], ms: 100 }, { buttons: [], ms: 50 }], async ms => slept.push(ms))
  assert.deepEqual(events, [[b.up, true], [b.a, true], [b.up, false], [b.a, false]])
  assert.deepEqual(slept, [100, 40, 50, 40])
})

test('a button the person and Claude both hold stays down until both let go', async () => {
  const { input, events } = recorder(GAMES.gameboy)
  const right = GAMES.gameboy.buttons.right
  let finishStep
  const firstSleep = new Promise(resolve => { finishStep = resolve })
  let sleeps = 0
  const step = input.claudeSteps([{ buttons: ['right'], ms: 100 }], () => (sleeps++ === 0 ? firstSleep : Promise.resolve()))
  input.personKey('right')
  assert.equal(input.isDown('right'), true)
  await wait(TIMING.firstPressMs + 10) // the person's hold ran out...
  assert.equal(input.isDown('right'), true) // ...but Claude still holds it
  finishStep()
  await step
  assert.equal(input.isDown('right'), false)
  assert.deepEqual(events, [[right, true], [right, false]])
})
