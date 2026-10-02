// End-to-end tests for the runner: start it as the mod does, talk to it over
// its socket, and play a little.
//
// The Game Boy test uses the bundled homebrew ROM, so it always runs. The Doom
// test needs freedoom1.wad: set COUCH_COOP_TEST_WAD to its path, or set
// COUCH_COOP_TEST_DOWNLOAD=1 to let the runner download Freedoom (24 MB).

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const MAIN = fileURLToPath(new URL('../main.mjs', import.meta.url))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function startRunner(home) {
  const child = spawn(process.execPath, ['--no-warnings', MAIN], {
    env: { ...process.env, COUCH_COOP_HOME: home },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const ready = await new Promise((resolve, reject) => {
    let buffered = ''
    child.stdout.on('data', chunk => {
      buffered += chunk
      const match = buffered.match(/COUCH_COOP_READY (\{.*\})/)
      if (match) resolve(JSON.parse(match[1]))
    })
    child.on('exit', code => reject(new Error(`runner exited with ${code}`)))
  })
  const call = (method, route, body, token = ready.token) => new Promise((resolve, reject) => {
    const request = http.request({ socketPath: ready.socket, path: route, method, headers: { 'x-couch-coop-token': token } }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString()
        let json = null
        try {
          json = JSON.parse(text)
        } catch {}
        resolve({ status: response.statusCode, headers: response.headers, text, json })
      })
    })
    request.on('error', reject)
    if (body) request.write(JSON.stringify(body))
    request.end()
  })
  return { child, ready, call }
}

async function waitForPhase(call, phase, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const { json } = await call('GET', '/state')
    if (json.phase === phase && (phase !== 'playing' || json.frame > 0)) return json
    if (json.phase === 'failed') throw new Error(json.message)
    if (Date.now() > deadline) throw new Error(`still ${json.phase}: ${json.message}`)
    await wait(100)
  }
}

describe('the runner', () => {
  let home
  let runner

  before(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'couch-coop-home-'))
    const wad = process.env.COUCH_COOP_TEST_WAD
    if (wad) {
      fs.mkdirSync(path.join(home, 'wads'), { recursive: true })
      fs.copyFileSync(wad, path.join(home, 'wads', 'freedoom1.wad'))
    }
    runner = await startRunner(home)
  })

  after(async () => {
    await runner.call('POST', '/quit').catch(() => {})
    await wait(200)
    fs.rmSync(home, { recursive: true, force: true })
  })

  test('listens on a private socket and checks its token', async () => {
    const mode = fs.statSync(path.dirname(runner.ready.socket)).mode & 0o777
    assert.equal(mode, 0o700)
    const refused = await runner.call('GET', '/health', undefined, 'wrong-token')
    assert.equal(refused.status, 401)
    const health = await runner.call('GET', '/health')
    assert.equal(health.json.ok, true)
  })

  test('lists the games and makes the folders', async () => {
    const { json } = await runner.call('GET', '/library')
    assert.ok(json.games.some(g => g.id === 'doom:freedoom1.wad'))
    assert.ok(json.games.some(g => g.title === 'Libbet and the Magic Floor (homebrew)'))
    assert.ok(fs.existsSync(path.join(home, 'roms')))
  })

  test('refuses game calls while nothing is running', async () => {
    const { status } = await runner.call('GET', '/screenshot')
    assert.equal(status, 409)
  })

  test('plays the bundled Game Boy game: frames, keys, presses, save states', async () => {
    const started = await runner.call('POST', '/start', { kind: 'gameboy', query: '' })
    assert.equal(started.status, 202)
    const state = await waitForPhase(runner.call, 'playing')
    assert.equal(state.game.kind, 'gameboy')

    const raster = await runner.call('GET', '/raster?columns=40&rows=18&since=-1')
    assert.equal(raster.status, 200)
    assert.equal(Buffer.from(raster.text, 'base64').length, 40 * 18 * 12)
    const same = await runner.call('GET', `/raster?columns=40&rows=18&since=${raster.headers['x-frame']}`)
    assert.ok(same.status === 204 || same.status === 200)

    const keys = await runner.call('POST', '/keys', { keys: ['return', 'x', 'q'] })
    assert.deepEqual(keys.json.pressed, ['start', 'a'])

    const pressed = await runner.call('POST', '/press', { steps: [{ buttons: ['a'], ms: 100 }] })
    assert.equal(pressed.status, 200)
    assert.ok(Buffer.from(pressed.json.png, 'base64').subarray(1, 4).toString() === 'PNG')

    const unknown = await runner.call('POST', '/press', { steps: [{ buttons: ['fire'], ms: 100 }] })
    assert.equal(unknown.status, 400)
    assert.match(unknown.json.error, /Unknown button/)

    assert.equal((await runner.call('POST', '/save-state')).json.ok, true)
    assert.equal((await runner.call('POST', '/load-state')).json.ok, true)
    assert.ok(fs.existsSync(path.join(home, 'saves', 'gameboy', 'libbet', 'libbet.state')))

    const stopped = await runner.call('POST', '/stop')
    assert.equal(stopped.json.phase, 'idle')
  })

  const hasWad = Boolean(process.env.COUCH_COOP_TEST_WAD || process.env.COUCH_COOP_TEST_DOWNLOAD)
  test('plays Doom: starts a game from the menu and reads its status', { skip: !hasWad && 'set COUCH_COOP_TEST_WAD or COUCH_COOP_TEST_DOWNLOAD=1' }, async () => {
    await runner.call('POST', '/start', { kind: 'doom', query: '' })
    await waitForPhase(runner.call, 'playing', 180_000)
    await wait(500)
    let shot = (await runner.call('GET', '/screenshot')).json
    assert.match(shot.status, /No game is running|menu is open/)
    for (const button of ['menu', 'enter', 'enter', 'enter']) {
      await runner.call('POST', '/press', { steps: [{ buttons: [button], ms: 120 }, { buttons: [], ms: 400 }] })
    }
    await wait(1500)
    shot = (await runner.call('POST', '/press', { steps: [{ buttons: ['forward'], ms: 300 }] })).json
    assert.match(shot.status, /^In E1M1: health 100%/)

    // Save: menu, down to Save Game, pick slot 1, type a name, enter.
    const tap = button => ({ buttons: [button], ms: 120 })
    const pause = { buttons: [], ms: 300 }
    await runner.call('POST', '/press', { steps: [tap('menu'), pause, tap('back'), pause, tap('back'), pause, tap('back'), pause, tap('enter'), pause, tap('enter'), pause] })
    shot = (await runner.call('GET', '/screenshot')).json
    assert.match(shot.status, /waiting for a save name/)
    await runner.call('POST', '/press', { steps: [{ text: 'couch' }, tap('enter'), pause] })
    await wait(500)
    const saves = fs.readdirSync(path.join(home, 'saves', 'doom', 'freedoom1', '.savegame'))
    assert.ok(saves.some(name => name.endsWith('.dsg')), `no save in ${saves}`)
    await runner.call('POST', '/stop')
  })
})
