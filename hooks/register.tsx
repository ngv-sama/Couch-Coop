// Couch Co-op: an arcade inside Claude Code.
//
// /arcade opens a pane with a game launcher. Pick Doom (Freedoom) or a Game
// Boy game and it plays right there: the picture is a Raster of half-block
// cells (or real pixels on kitty and Ghostty), your keys reach the game
// through the key strip under it, and Claude can play too through two tools,
// look and press. The games run in a separate local Node process (the runner,
// runner/main.mjs), so a busy game never slows Claude Code down.
//
// Mods follow `$` only into functions declared in this same file, so every
// function that talks to the engine lives here; hooks/lib holds pure helpers
// and hooks/client the key strip that runs on the drawing side.

import type { EngineInterface, Register, Timer } from 'claude-code'

import { atom, read, update } from 'claude-code'
import type { CouchCoopGame, CouchCoopPlay, CouchCoopRunner } from '../types'
import { fitImage, fitRaster, progressBar } from './lib/fit'

type $ = EngineInterface
type Kind = 'doom' | 'gameboy'

const PANE = 'couch-coop'
const SCREEN_KEY = 'screen'
const LOOK_TOOL = 'mcp__couch-coop__look'
const PRESS_TOOL = 'mcp__couch-coop__press'
const MIN_NODE_MAJOR = 20
// Rows under the picture: the key strip, the controls and Claude's line.
const CHROME_ROWS = 4
const BLACK_PIXEL = 'AAAA/w==' // one opaque black RGBA pixel, base64
// One Raster cell, base64: '▀' (U+2580) with black on black. Twelve bytes
// encode to exactly sixteen characters, so a dark screen is this repeated.
const DARK_CELL = 'gCUAAAAAAAAAAAAA'

// --- state the pane draws from -------------------------------------------------------------

const runnerAtom = atom({ plugin: 'couch-coop', key: 'runner' } as const, { status: 'off' })
const libraryAtom = atom({ plugin: 'couch-coop', key: 'library' } as const, [])
const foldersAtom = atom({ plugin: 'couch-coop', key: 'folders' } as const, null)
const playAtom = atom({ plugin: 'couch-coop', key: 'play' } as const, {
  phase: 'idle',
  message: '',
  progress: null,
  game: null,
  isPaused: false,
  isRunHeld: false,
})
const claudeAtom = atom({ plugin: 'couch-coop', key: 'claude' } as const, { isOn: true, say: '' })

// --- what the runner answers ---------------------------------------------------------------

type Connection = { socket: string; token: string; runDir: string; version: string }
type RunnerState = CouchCoopPlay & { frame: number; windowTitle: string | null; isPersonActive: boolean }
type Shot = { png?: string; status?: string }
type DisplayMode = 'blocks' | 'pixels'
type Mounted = { mode: DisplayMode; columns: number; rows: number }

const DOOM_BUTTONS = 'forward, back, turn_left, turn_right, strafe_left, strafe_right, fire, use, run, map, menu, enter, back_menu, yes, no, pause, weapon_1 to weapon_7'
const GAMEBOY_BUTTONS = 'up, down, left, right, a, b, start, select'

// Read from the plugin's options (userConfig) each time the module loads.
let settings = { nodePath: '', romsFolder: '', display: 'auto', fps: 24 }

// Module state that does not need a redraw when it changes.
let connection: Connection | null = null
let starting: Promise<Connection> | null = null
let displayMode: DisplayMode = 'blocks'
let poll: Timer | null = null
let pump: Timer | null = null
let heartbeat: Timer | null = null
let isPainting = false
let mounted: Mounted | null = null
let lastSeq = -1
let lastCells: { columns: number; rows: number; cells: string } | null = null
let lastPlayJson = ''
let lastKeyId = 0
let areToolsRegistered = false

// --- the runner: start it, call it -------------------------------------------------------

/** Finds a Node.js new enough to run the games, or explains why none was found. */
async function findNode($: $): Promise<{ path: string } | { error: string }> {
  const home = (await $.env.get('HOME')) ?? ''
  const candidates: string[] = []
  if (settings.nodePath) candidates.push(settings.nodePath.replace(/^~(?=\/)/, home))
  candidates.push('node', '/opt/homebrew/bin/node', '/usr/local/bin/node', `${home}/.volta/bin/node`)
  try {
    // nvm keeps each version in its own folder; try the newest first.
    const versions = await $.fs.list(`${home}/.nvm/versions/node`)
    versions
      .filter(entry => entry.kind === 'dir')
      .map(entry => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .forEach(name => candidates.push(`${home}/.nvm/versions/node/${name}/bin/node`))
  } catch {
    // no nvm
  }
  let tooOld = ''
  for (const candidate of candidates) {
    try {
      const { exitCode, stdout } = await $.process.run([candidate, '--version'], { timeoutMs: 5000 })
      const major = Number.parseInt(stdout.trim().replace(/^v/, ''), 10)
      if (exitCode === 0 && major >= MIN_NODE_MAJOR) return { path: candidate }
      if (exitCode === 0 && !tooOld) tooOld = stdout.trim()
    } catch {
      // not there; try the next
    }
  }
  return {
    error: tooOld
      ? `Couch Co-op needs Node.js ${MIN_NODE_MAJOR} or newer and found ${tooOld}. Update Node (brew install node), then run /arcade again.`
      : `Couch Co-op runs its games with Node.js ${MIN_NODE_MAJOR} or newer, and none was found. Install it (brew install node, or nodejs.org) or set its path in /config under Couch Co-op, then run /arcade again.`,
  }
}

/** Starts the runner if it is not running, and resolves once it listens. */
function ensureRunner($: $): Promise<Connection> {
  if (connection) return Promise.resolve(connection)
  if (starting) return starting
  const attempt = (async () => {
    await update($, runnerAtom, () => ({ status: 'starting' as const }))
    const node = await findNode($)
    if ('error' in node) {
      await update($, runnerAtom, () => ({ status: 'no-node' as const, detail: node.error }))
      throw new Error(node.error)
    }
    const argv = [node.path, '--no-warnings', `${$.plugin.root}/runner/main.mjs`]
    if (settings.romsFolder) argv.push(`--roms=${settings.romsFolder}`)
    return await new Promise<Connection>((resolve, reject) => {
      let buffered = ''
      let isReady = false
      // This loop is the runner's life: it runs on after the promise
      // resolves, and ends (killing the runner) when it exits or this
      // module unloads. Its state updates may land after the session has
      // gone, so none of them may throw.
      const report = (value: CouchCoopRunner) => update($, runnerAtom, () => value).catch(() => {})
      void (async () => {
        try {
          for await (const chunk of $.process.spawn({ argv })) {
            if (chunk.stream === 'stderr') {
              $.ui.log(`runner: ${chunk.text.trim()}`, { to: 'debug' })
              continue
            }
            if (isReady) continue
            buffered += chunk.text
            const match = buffered.match(/COUCH_COOP_READY (\{.*\})/)
            if (match?.[1]) {
              isReady = true
              connection = JSON.parse(match[1]) as Connection
              await report({ status: 'ready' })
              resolve(connection)
            }
          }
          connection = null
          stopPump()
          await report({ status: 'off' })
          // Whatever was playing went with the runner; show the launcher next time.
          await update($, playAtom, () => ({ phase: 'idle' as const, message: '', progress: null, game: null, isPaused: false, isRunHeld: false })).catch(() => {})
          lastPlayJson = ''
          if (!isReady) reject(new Error('The game runner exited before it was ready.'))
        } catch (error) {
          connection = null
          const detail = error instanceof Error ? error.message : String(error)
          await report({ status: 'failed', detail: `The game runner stopped: ${detail}` })
          reject(error)
        } finally {
          starting = null
        }
      })()
    })
  })()
  starting = attempt
  attempt.catch(() => {
    starting = null
  })
  return attempt
}

/** One request to the runner over its private socket. */
async function call($: $, method: 'GET' | 'POST', path: string, body?: unknown) {
  const current = connection
  if (!current) throw new Error('The game runner is not running. Run /arcade to start it.')
  return $.http.fetch(`http://runner${path}`, {
    method,
    socketPath: current.socket,
    headers: { 'x-couch-coop-token': current.token, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/** A request whose answer is JSON; throws the runner's own message on failure. */
async function callJson<T>($: $, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await call($, method, path, body)
  let value: unknown
  try {
    value = JSON.parse(response.text)
  } catch {
    throw new Error(`The game runner answered ${response.status} with something that is not JSON.`)
  }
  if (!response.ok) throw new Error((value as { error?: string } | null)?.error ?? `HTTP ${response.status}`)
  return value as T
}

// --- keeping the pane current ------------------------------------------------------------

async function syncPlay($: $) {
  if (!connection) return
  const state = await callJson<RunnerState>($, 'GET', '/state')
  const play: CouchCoopPlay = {
    phase: state.phase,
    message: state.message,
    progress: state.progress,
    game: state.game,
    isPaused: state.isPaused,
    isRunHeld: state.isRunHeld,
  }
  const json = JSON.stringify(play)
  if (json !== lastPlayJson) {
    lastPlayJson = json
    await update($, playAtom, () => play)
  }
  if (play.phase === 'playing') startPump($)
  else stopPump()
}

async function refreshLibrary($: $) {
  const { games, dirs } = await callJson<{ games: CouchCoopGame[]; dirs: { roms: string; wads: string; home: string } }>($, 'GET', '/library')
  await update($, libraryAtom, () => games.map(g => ({ id: g.id, kind: g.kind, title: g.title, origin: g.origin })))
  await update($, foldersAtom, () => ({ roms: dirs.roms, wads: dirs.wads, home: dirs.home }))
}

function startPolling($: $) {
  if (poll) return
  poll = $.clock.every(500, () => {
    syncPlay($).catch(() => {})
  })
}

function stopPolling() {
  poll?.cancel()
  poll = null
}

// The runner quits after a minute without requests, so it never outlives a
// Claude Code that crashed. While this session lives, a slow heartbeat keeps
// it (and a paused game) alive with the pane closed.
function startHeartbeat($: $) {
  if (heartbeat) return
  heartbeat = $.clock.every(20_000, () => {
    call($, 'GET', '/health').catch(() => {})
  })
}

// --- the picture ---------------------------------------------------------------------------

/** Cells for a Raster of this size: the newest frame if it fits, else a dark screen. */
function initialCells(columns: number, rows: number): string {
  if (lastCells && lastCells.columns === columns && lastCells.rows === rows) return lastCells.cells
  return DARK_CELL.repeat(columns * rows)
}

/** The render hook says what it mounted; a new size or mode asks for a fresh frame. */
function setMounted(next: Mounted | null) {
  const isSame = next && mounted && next.columns === mounted.columns && next.rows === mounted.rows && next.mode === mounted.mode
  mounted = next
  if (!isSame) lastSeq = -1
}

async function paintOnce($: $) {
  const target = mounted
  if (!target) return
  if (target.mode === 'blocks') {
    const response = await call($, 'GET', `/raster?columns=${target.columns}&rows=${target.rows}&since=${lastSeq}`)
    if (response.status !== 200) return
    lastSeq = Number(response.headers['x-frame'] ?? lastSeq)
    lastCells = { columns: target.columns, rows: target.rows, cells: response.text }
    await $.ui.blit({ requestId: PANE, key: SCREEN_KEY, cells: response.text })
    return
  }
  const response = await call($, 'GET', `/pixels?since=${lastSeq}`)
  if (response.status !== 200) return
  const { seq, source } = JSON.parse(response.text) as {
    seq: number
    source: { file: string; format: 'rgb'; width: number; height: number; generation: number }
  }
  lastSeq = seq
  const result = await $.ui.blit({ requestId: PANE, key: SCREEN_KEY, source })
  if (result.deny && /alt/i.test(result.deny)) {
    // This terminal draws the Image's alt text, not pixels: use blocks.
    displayMode = 'blocks'
    $.ui.invalidate('ui.render')
  }
}

function startPump($: $) {
  if (pump) return
  pump = $.clock.every(Math.round(1000 / settings.fps), () => {
    if (isPainting || !mounted) return
    isPainting = true
    paintOnce($)
      .catch(() => {})
      .finally(() => {
        isPainting = false
      })
  })
}

function stopPump() {
  pump?.cancel()
  pump = null
  isPainting = false
}

// --- opening, starting and leaving games -------------------------------------------------

/** Opens the pane, starts the runner, and starts a game when one is named. */
async function openArcade($: $, terminalColumns: number, start?: { query: string; kind?: Kind }): Promise<string> {
  // The picture's detail is the pane's size in characters, so ask for most of a wide terminal.
  const columns = Math.max(80, Math.round(terminalColumns * 0.62))
  await $.ui.open({ id: PANE, title: 'Couch Co-op', rows: 40, columns })
  try {
    await ensureRunner($)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  await refreshLibrary($)
  startPolling($)
  startHeartbeat($)
  if (start) return startGame($, start.query, start.kind)
  const play = await read($, playAtom)
  if (play.phase === 'playing') {
    // Back to a game that paused when the pane closed.
    await callJson($, 'POST', '/pause', { paused: false }).catch(() => {})
    return `Back to ${play.game?.title ?? 'your game'}.`
  }
  return 'Couch Co-op is open: pick a game in the pane.'
}

async function startGame($: $, query: string, kind?: Kind): Promise<string> {
  try {
    const state = await callJson<RunnerState>($, 'POST', '/start', { query, kind })
    await registerTools($)
    await syncPlay($)
    return `Starting ${state.game?.title ?? 'the game'}. Click the strip under the picture to play; Esc gives the keyboard back.`
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

async function backToLauncher($: $) {
  stopPump()
  await callJson($, 'POST', '/stop').catch(() => {})
  await refreshLibrary($).catch(() => {})
  await syncPlay($).catch(() => {})
}

async function letClaudePlay($: $) {
  const play = await read($, playAtom)
  await update($, claudeAtom, value => ({ ...value, isOn: true }))
  // The request goes in the prompt box as the person's own draft: they send
  // it with Enter, so Claude hears it from them, not from a plugin.
  const text = `Take a turn at ${play.game?.title ?? 'the game'} in the Couch Co-op pane: look at the screen, then play for a bit and narrate as you go (couch-coop:play skill).`
  const filled = await $.prompt.fill({ text, mode: 'replace' })
  $.ui.toast(filled.isFilled ? 'Press Enter to hand Claude the controller (Esc first if the game has your keys).' : 'Ask Claude to play in the prompt box.')
}

// --- Claude's controller -----------------------------------------------------------------

// Registered the first time a game starts, so sessions that never open the
// arcade carry no extra tools.
async function registerTools($: $) {
  if (areToolsRegistered) return
  areToolsRegistered = true
  await $.tool.register({
    name: 'look',
    description:
      'See the game open in the Couch Co-op arcade pane (Doom or a Game Boy game): returns the current screen as an image ' +
      'and what is being played. Look before deciding what to press.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  })
  await $.tool.register({
    name: 'press',
    description:
      'Play the game open in the Couch Co-op pane: hold buttons for set milliseconds, step by step, then get the new screen as an image. ' +
      `Doom buttons: ${DOOM_BUTTONS}. Game Boy buttons: ${GAMEBOY_BUTTONS}. ` +
      'A step holds its buttons together (e.g. ["forward","fire"]) for ms (30 to 3000), then lets go; a step with no buttons waits; ' +
      'a step with text types it (only for a Doom save name). ' +
      'When the person is not playing, the game pauses between your calls, so you can think. ' +
      'Put one short, fun line in "say" about what you are doing: it shows under the game.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              buttons: { type: 'array', items: { type: 'string' }, maxItems: 6 },
              ms: { type: 'integer', minimum: 30, maximum: 3000 },
              text: { type: 'string', maxLength: 24, description: 'Instead of buttons: characters to type, only when Doom asks for a save name.' },
            },
            additionalProperties: false,
          },
        },
        say: { type: 'string', maxLength: 120, description: 'One short line of narration for the person watching.' },
      },
      required: ['steps'],
      additionalProperties: false,
    },
  })
}

/** The tool result: a line of text and the screen as an image block. */
function screenResult(shot: Shot, line: string) {
  const blocks: unknown[] = [{ type: 'text', text: shot.status ? `${line} ${shot.status}` : line }]
  if (shot.png) blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: shot.png } })
  return blocks
}

async function playingLine($: $): Promise<string | null> {
  const play = await read($, playAtom)
  if (play.phase !== 'playing' || !play.game) return null
  return `Playing ${play.game.title}.`
}

export const register: Register = (on, options) => {
  settings = {
    nodePath: String(options.node_path ?? '').trim(),
    romsFolder: String(options.roms_folder ?? '').trim(),
    display: String(options.display ?? 'auto'),
    fps: Math.max(5, Math.min(30, Number(options.fps ?? 24) || 24)),
  }

  const NO_GAME = 'No game is open. Ask the person to start one with /arcade, /doom or /gameboy.'

  on('tool.call', { tool: LOOK_TOOL }, async $ => {
    const line = await playingLine($)
    if (!line) return { deny: NO_GAME }
    try {
      const shot = await callJson<Shot>($, 'GET', '/screenshot')
      return { result: screenResult(shot, line) }
    } catch (error) {
      return { deny: error instanceof Error ? error.message : String(error) }
    }
  })

  on('tool.call', { tool: PRESS_TOOL }, async ($, e) => {
    const claude = await read($, claudeAtom)
    if (!claude.isOn) {
      return { deny: 'The person benched Claude in the Couch Co-op pane, so the controller is theirs for now. You can still look.' }
    }
    const line = await playingLine($)
    if (!line) return { deny: NO_GAME }
    const input = e as unknown as { steps?: { buttons?: string[]; ms?: number; text?: string }[]; say?: unknown }
    const say = typeof input.say === 'string' ? input.say.slice(0, 120) : ''
    if (say) await update($, claudeAtom, value => ({ ...value, say }))
    try {
      const shot = await callJson<Shot>($, 'POST', '/press', { steps: input.steps ?? [] })
      return { result: screenResult(shot, `${line} Done; this is the screen now.`) }
    } catch (error) {
      return { deny: error instanceof Error ? error.message : String(error) }
    }
  })

  // --- session ---------------------------------------------------------------------------------

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'arcade', description: 'Open the Couch Co-op arcade: Doom and Game Boy, co-op with Claude', argumentHint: '[game]' })
    await $.command.register({ name: 'doom', description: 'Play Doom in a pane (Freedoom, or a WAD you added)', argumentHint: '[wad]' })
    await $.command.register({ name: 'gameboy', description: 'Play a Game Boy game in a pane (bundled homebrew, or a ROM you added)', argumentHint: '[rom]' })

    const term = (await $.env.get('TERM')) ?? ''
    const program = ((await $.env.get('TERM_PROGRAM')) ?? '').toLowerCase()
    const kittyWindow = await $.env.get('KITTY_WINDOW_ID')
    const canDrawPixels = program === 'ghostty' || term.includes('kitty') || Boolean(kittyWindow)
    displayMode = settings.display === 'pixels' || (settings.display === 'auto' && canDrawPixels) ? 'pixels' : 'blocks'
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stopPump()
    stopPolling()
    heartbeat?.cancel()
    heartbeat = null
    if (connection) await call($, 'POST', '/quit').catch(() => {})
    connection = null
    return next(e)
  })

  // --- commands -----------------------------------------------------------------------------------

  on('command.run', { command: 'arcade' }, async ($, e) => {
    const query = (e.args ?? '').trim()
    return { text: await openArcade($, e.presentation?.columns ?? 160, query ? { query } : undefined) }
  })

  on('command.run', { command: 'doom' }, async ($, e) => ({
    text: await openArcade($, e.presentation?.columns ?? 160, { query: (e.args ?? '').trim(), kind: 'doom' }),
  }))

  on('command.run', { command: 'gameboy' }, async ($, e) => ({
    text: await openArcade($, e.presentation?.columns ?? 160, { query: (e.args ?? '').trim(), kind: 'gameboy' }),
  }))

  // --- the pane --------------------------------------------------------------------------------------

  on('ui.close', { id: PANE }, async ($, e, next) => {
    stopPump()
    stopPolling()
    setMounted(null)
    // Nobody is watching: hold the game where it is until the pane opens again.
    if ((await read($, playAtom)).phase === 'playing') await callJson($, 'POST', '/pause', { paused: true }).catch(() => {})
    return next(e)
  })

  // Keys from the key strip (hooks/client/keystrip.tsx) go on to the game.
  on('ui.message', { requestId: PANE }, async ($, e) => {
    const data = e.data as { keys?: { id: number; key: string }[] } | null
    const fresh = (data?.keys ?? []).filter(k => typeof k?.id === 'number' && typeof k.key === 'string' && k.id > lastKeyId)
    if (fresh.length > 0) {
      lastKeyId = Math.max(...fresh.map(k => k.id))
      try {
        const answer = await callJson<{ isRunHeld: boolean }>($, 'POST', '/keys', { keys: fresh.map(k => k.key) })
        const play = await read($, playAtom)
        if (play.isRunHeld !== answer.isRunHeld) await update($, playAtom, value => ({ ...value, isRunHeld: answer.isRunHeld }))
      } catch {
        // The game ended between frames; the next poll shows the launcher.
      }
    }
    const play = await read($, playAtom)
    return { props: { hint: play.game?.hint ?? '', ack: lastKeyId } }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text bold>Couch Co-op</Text>
          <Text>The game screen draws in the terminal. Open this session in the Claude Code CLI to play.</Text>
        </Box>
      )
    }
    const { Box, Text, Button, Raster, Image, Client } = $.ui.resolve(e)
    const runner = await read($, runnerAtom)
    const play = await read($, playAtom)
    const claude = await read($, claudeAtom)
    const library = await read($, libraryAtom)
    const folders = await read($, foldersAtom)
    const width = e.props.bodyColumns
    const height = e.props.scroll.bodyRows
    const isFullscreen = e.viewport?.isFullscreen !== false

    const header = (
      <Box flexDirection="row" justifyContent="space-between" width="100%" paddingRight={2}>
        <Text bold color="magenta">COUCH CO-OP</Text>
        <Text dimColor>by original_ngv</Text>
      </Box>
    )

    if (runner.status === 'no-node' || runner.status === 'failed') {
      setMounted(null)
      return (
        <Box flexDirection="column" width="100%">
          {header}
          <Text color="red" wrap="wrap">{runner.detail}</Text>
        </Box>
      )
    }

    if (runner.status !== 'ready') {
      setMounted(null)
      return (
        <Box flexDirection="column" width="100%">
          {header}
          <Text dimColor>Starting the game runner...</Text>
        </Box>
      )
    }

    if (play.phase === 'loading') {
      setMounted(null)
      return (
        <Box flexDirection="column" width="100%">
          {header}
          <Text>{play.message}</Text>
          {play.progress !== null && <Text color="cyan">{progressBar(play.progress, Math.max(10, Math.min(40, width - 8)))}</Text>}
        </Box>
      )
    }

    if (play.phase === 'playing' && play.game) {
      const game = play.game
      const roomRows = Math.max(4, height - CHROME_ROWS)
      const mode = displayMode
      const size = mode === 'pixels' ? fitImage(width, roomRows, game.aspect) : fitRaster(width, roomRows, game.aspect)
      setMounted({ mode, columns: size.columns, rows: size.rows })
      const isGameboy = game.kind === 'gameboy'
      return (
        <Box flexDirection="column" width="100%">
          <Box flexDirection="row" justifyContent="center" width="100%">
            {mode === 'pixels'
              ? <Image key={SCREEN_KEY} columns={size.columns} rows={size.rows} alt={`${game.title} screen`}
                  source={{ rgba: BLACK_PIXEL, width: 1, height: 1 }} />
              : <Raster key={SCREEN_KEY} columns={size.columns} rows={size.rows} cells={initialCells(size.columns, size.rows)} />}
          </Box>
          <Client key="keys" module="./client/keystrip.tsx" props={{ hint: game.hint, ack: lastKeyId }} width="100%" height={1} />
          <Box flexDirection="row" gap={2} width="100%">
            <Button key="claude-seat" hotkey="c" plain label={claude.isOn ? 'Claude can play' : 'Claude benched'}
              onPress={() => update($, claudeAtom, value => ({ ...value, isOn: !value.isOn }))} />
            <Button key="claude-turn" hotkey="t" plain label="Let Claude play" onPress={() => letClaudePlay($)} />
            {isGameboy && <Button key="save-state" hotkey="s" plain label="Save state"
              onPress={async () => {
                const { ok } = await callJson<{ ok: boolean }>($, 'POST', '/save-state').catch(() => ({ ok: false }))
                $.ui.toast(ok ? 'State saved.' : 'Could not save the state.')
              }} />}
            {isGameboy && <Button key="load-state" hotkey="l" plain label="Load state"
              onPress={async () => {
                const { ok } = await callJson<{ ok: boolean }>($, 'POST', '/load-state').catch(() => ({ ok: false }))
                $.ui.toast(ok ? 'State loaded.' : 'No saved state yet.')
              }} />}
            <Button key="launcher" hotkey="q" plain label="Games" onPress={() => backToLauncher($)} />
            {game.kind === 'doom' && <Text dimColor>{play.isRunHeld ? 'run: on (R)' : 'run: off (R)'}</Text>}
          </Box>
          {claude.say
            ? <Text color="cyan" wrap="truncate-end">Claude: {claude.say}</Text>
            : !isFullscreen && <Text color="yellow" wrap="truncate-end">Run /tui fullscreen so a click on the strip can take the keyboard.</Text>}
        </Box>
      )
    }

    // The launcher.
    setMounted(null)
    return (
      <Box flexDirection="column" width="100%">
        {header}
        {play.phase === 'ended' || play.phase === 'failed'
          ? <Text color={play.phase === 'failed' ? 'red' : 'yellow'} wrap="wrap">{play.message}</Text>
          : <Text dimColor wrap="wrap">Pick a game. You play with the keyboard; Claude can take a turn or play alongside you (press t in a game).</Text>}
        <Box flexDirection="column" marginTop={1}>
          {library.map((game, index) => (
            <Button key={`game-${index}`} hotkey={index < 9 ? String(index + 1) : undefined} plain
              label={`${game.title}${game.origin === 'yours' ? '  (your file)' : ''}`}
              onPress={() => startGame($, game.id)} />
          ))}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {folders && <Text dimColor wrap="wrap">Game Boy ROMs (.gb, .gbc): {folders.roms}</Text>}
          {folders && <Text dimColor wrap="wrap">Doom WADs: {folders.wads}</Text>}
          <Text dimColor wrap="wrap">Only add games you own. Saves live in {folders?.home ?? '~/.couch-coop'}/saves.</Text>
          {!isFullscreen && <Text color="yellow" wrap="wrap">Tip: run /tui fullscreen so you can click the game to play it.</Text>}
        </Box>
        <Box flexDirection="row" gap={2} marginTop={1}>
          <Button key="rescan" hotkey="r" plain label="Rescan folders" onPress={() => refreshLibrary($)} />
        </Box>
      </Box>
    )
  })
}
