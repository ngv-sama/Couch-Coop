// Tests for the Couch Co-op mod, run with `claude plugin test .`.
//
// The real runner is a separate Node process (tested under runner/test). Here
// a fake one stands beneath the mod: it answers the mod's process, HTTP and UI
// calls from memory, so these tests check the mod's own behaviour: what the
// pane draws, what commands do, how keys and Claude's presses travel.

import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const PANE_PROPS = {
  title: 'Couch Co-op',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}
const VIEWPORT = { columns: 160, rows: 50, isFullscreen: true }
const MOUNT = { plugin: 'couch-coop', surface: 'terminal', component: 'Pane', requestId: 'couch-coop', props: PANE_PROPS, viewport: VIEWPORT } as const

const DOOM = {
  id: 'doom:freedoom1.wad',
  kind: 'doom',
  title: 'Doom (Freedoom: Phase 1)',
  aspect: 4 / 3,
  hint: 'WASD move · Space fire',
  buttons: ['forward', 'fire', 'use'],
}
const GAMES = [
  { id: 'doom:freedoom1.wad', kind: 'doom', title: 'Doom (Freedoom: Phase 1)', origin: 'free' },
  { id: 'gameboy:bundled:libbet.gb', kind: 'gameboy', title: 'Libbet and the Magic Floor (homebrew)', origin: 'free' },
  { id: 'gameboy:red.gb', kind: 'gameboy', title: 'red', origin: 'yours' },
]
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC'
const DARK_CELL = 'gCUAAAAAAAAAAAAA'

/** A slash command as the person would type it at a fullscreen terminal. */
const typed = (command: string, args = '') => ({
  command,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
})

/** What the fake runner saw, for the tests to check. */
type Log = { keys: string[]; steps: unknown[]; tools: string[]; requests: string[]; release: () => void }

/** Stands a fake runner (and the engine calls around it) beneath the mod. */
function fakeRunner(on: On): Log {
  let release = () => {}
  const stopped = new Promise<void>(resolve => {
    release = resolve
  })
  const log: Log = { keys: [], steps: [], tools: [], requests: [], release }
  let phase = 'idle'

  mock.env(on, { HOME: '/home/player', TERM: 'xterm-256color', TERM_PROGRAM: 'Apple_Terminal' })
  mock.clock(on)

  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.blit', async () => ({ value: {} }))
  on('fs.list', async () => ({ deny: 'no such folder' }))
  on('tool.register', async (_$, e) => {
    log.tools.push(e.name)
    return { value: { tool: `mcp__couch-coop__${e.name}` } }
  })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: 'v22.11.0\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'COUCH_COOP_READY {"socket":"/tmp/cc/runner.sock","token":"t","runDir":"/tmp/cc","version":"0.1.0"}\n' }
    await stopped
    return { value: { code: 0, signal: null } }
  })
  on('http.fetch', async (_$, e) => {
    const url = new URL(e.url)
    const method = e.init?.method ?? 'GET'
    const body = e.init?.body ? JSON.parse(e.init.body) : {}
    log.requests.push(`${method} ${url.pathname}`)
    const json = (value: unknown, status = 200) => ({ value: { status, ok: status < 300, headers: { 'content-type': 'application/json' }, text: JSON.stringify(value) } })
    const state = () => ({
      phase,
      message: '',
      progress: null,
      game: phase === 'playing' ? DOOM : null,
      isPaused: false,
      isRunHeld: true,
      frame: 7,
      windowTitle: null,
      isPersonActive: false,
    })
    switch (`${method} ${url.pathname}`) {
      case 'GET /library':
        return json({ games: GAMES, dirs: { home: '~/.couch-coop', roms: '~/.couch-coop/roms', wads: '~/.couch-coop/wads' } })
      case 'GET /state':
        return json(state())
      case 'POST /start':
        phase = 'playing'
        return json(state(), 202)
      case 'POST /stop':
        phase = 'idle'
        return json(state())
      case 'POST /pause':
        return json(state())
      case 'POST /keys':
        log.keys.push(...body.keys)
        return json({ pressed: body.keys, isRunHeld: true })
      case 'GET /screenshot':
        return json({ png: PNG, status: 'In E1M1: health 100%.' })
      case 'POST /press':
        log.steps.push(...body.steps)
        return json({ png: PNG, status: 'In E1M1: health 100%.' })
      case 'GET /raster': {
        const columns = Number(url.searchParams.get('columns'))
        const rows = Number(url.searchParams.get('rows'))
        return { value: { status: 200, ok: true, headers: { 'x-frame': '7' }, text: DARK_CELL.repeat(columns * rows) } }
      }
      default:
        return json({ error: 'no route' }, 404)
    }
  })
  return log
}

describe('the pane', () => {
  test('says it is starting before the runner is ready', async $ => {
    const ui = await $.ui.mount(MOUNT)
    expect(await ui.find({ type: 'Text', text: 'COUCH CO-OP' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Starting the game runner/ })).toBeDefined()
    await ui.unmount()
  })

  test('points away from surfaces that cannot draw the game', async $ => {
    const ui = await $.ui.mount({ ...MOUNT, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /draws in the terminal/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('/arcade', () => {
  test('opens the launcher with every game, yours marked', async ($, on) => {
    const runner = fakeRunner(on)
    const { text } = await $.command.run(typed('arcade'))
    expect(text).toContain('pick a game')
    const ui = await $.ui.mount(MOUNT)
    const labels = (await ui.findAll({ type: 'Button' })).map(button => String(button.props.label))
    expect(labels).toContain('Doom (Freedoom: Phase 1)')
    expect(labels).toContain('Libbet and the Magic Floor (homebrew)')
    expect(labels).toContain('red  (your file)')
    expect(await ui.find({ type: 'Text', text: /~\/\.couch-coop\/roms/ })).toBeDefined()
    await ui.unmount()
    runner.release()
  })
})

describe('/doom', () => {
  test('starts Doom, draws it at 4:3 and gives Claude its controller', async ($, on) => {
    const runner = fakeRunner(on)
    const { text } = await $.command.run(typed('doom'))
    expect(text).toContain('Starting Doom')
    expect(runner.requests).toContain('POST /start')
    expect(runner.tools).toEqual(['look', 'press'])
    const ui = await $.ui.mount(MOUNT)
    const screen = await ui.find({ type: 'Raster', key: 'screen' })
    expect(screen).toBeDefined()
    const columns = Number(screen?.props.columns)
    const rows = Number(screen?.props.rows)
    expect(Math.abs(columns / (rows * 2) - 4 / 3)).toBeLessThan(0.05)
    expect(await ui.find({ type: 'Button', key: 'claude-turn' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /run: on/ })).toBeDefined()
    await ui.unmount()
    runner.release()
  })

  test('keys typed on the strip reach the game', async ($, on) => {
    const runner = fakeRunner(on)
    await $.command.run(typed('doom'))
    const ui = await $.ui.mount(MOUNT)
    await ui.resize({ columns: 100, rows: 1 })
    expect(await ui.find({ text: /Click here to play/, in: 'keys' })).toBeDefined()
    await ui.key({ key: 'w', in: 'keys' })
    await ui.key({ key: ' ', in: 'keys' })
    await ui.advance(100)
    expect(runner.keys).toEqual(['w', ' '])
    expect(await ui.find({ text: /Playing/, in: 'keys' })).toBeDefined()
    await ui.unmount()
    runner.release()
  })
})

describe("Claude's controller", () => {
  test('press holds the buttons asked for and returns the screen', async ($, on) => {
    const runner = fakeRunner(on)
    await $.command.run(typed('doom'))
    const ran = await $.tool.call({ tool: 'mcp__couch-coop__press', steps: [{ buttons: ['forward', 'fire'], ms: 400 }], say: 'Charging in' })
    expect(ran.deny).toBeUndefined()
    expect(runner.steps).toEqual([{ buttons: ['forward', 'fire'], ms: 400 }])
    const blocks = ran.result as { type: string }[]
    expect(blocks.map(block => block.type)).toEqual(['text', 'image'])
    runner.release()
  })

  test('look refuses when no game is open', async ($, on) => {
    const runner = fakeRunner(on)
    await $.command.run(typed('arcade'))
    await $.command.run(typed('doom'))
    const ui = await $.ui.mount(MOUNT)
    await ui.press({ key: 'launcher' })
    const looked = await $.tool.call({ tool: 'mcp__couch-coop__look' })
    expect(looked.deny ?? looked.text).toMatch(/No game is open/)
    await ui.unmount()
    runner.release()
  })

  test('a benched Claude cannot press', async ($, on) => {
    const runner = fakeRunner(on)
    await $.command.run(typed('doom'))
    const ui = await $.ui.mount(MOUNT)
    await ui.press({ key: 'claude-seat' })
    const ran = await $.tool.call({ tool: 'mcp__couch-coop__press', steps: [{ buttons: ['fire'], ms: 100 }] })
    expect(ran.deny ?? ran.text).toMatch(/benched/)
    expect(runner.steps).toEqual([])
    await ui.unmount()
    runner.release()
  })
})
