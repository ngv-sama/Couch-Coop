#!/usr/bin/env node
// The Couch Co-op runner: a small local server the Claude Code mod starts.
//
// It hosts one game at a time in a worker thread and answers the mod over a
// Unix socket in a private folder (only this user can open it), with a random
// token on every request. It exits when the mod stops calling it.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensureFreedoom } from './lib/freedoom.mjs'
import { gameById } from './lib/games.mjs'
import { findGame, library } from './lib/library.mjs'
import { ensureDir, paths, slug } from './lib/paths.mjs'
import { GameSession } from './lib/session.mjs'
import { COMMAND } from './lib/shared.mjs'

export const RUNNER_VERSION = '0.1.0'
const IDLE_EXIT_MS = 60_000
const MAX_BODY_BYTES = 1 << 20
const CORES_DIR = fileURLToPath(new URL('./cores/', import.meta.url))

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.join('=') || 'true']),
)
const dirs = paths({ romsFolder: args.roms })

// --- private run folder and socket ------------------------------------------------

function makeRunDir() {
  const base = os.tmpdir().length < 60 ? os.tmpdir() : '/tmp'
  const dir = fs.mkdtempSync(path.join(base, 'couch-coop-'))
  fs.chmodSync(dir, 0o700)
  return dir
}

const runDir = makeRunDir()
const socketPath = path.join(runDir, 'runner.sock')
const token = crypto.randomBytes(24).toString('hex')

// --- what is being played -----------------------------------------------------------

/** phase: idle | loading | playing | ended | failed */
const state = { phase: 'idle', entry: null, progress: null, message: '', session: null }
let lastRequestAt = Date.now()

function publicState() {
  const session = state.session
  const game = state.entry ? gameById(state.entry.kind) : null
  return {
    phase: state.phase,
    message: state.message,
    progress: state.progress,
    game: state.entry && game ? {
      id: state.entry.id,
      kind: state.entry.kind,
      title: state.entry.title,
      origin: state.entry.origin,
      aspect: game.aspect,
      hint: game.hint,
      buttons: Object.keys(game.buttons),
    } : null,
    windowTitle: session?.title ?? null,
    isPaused: session?.isPaused ?? false,
    isRunHeld: session ? session.input.toggled.has('run') : false,
    isPersonActive: session?.isPersonActive ?? false,
    frame: session?.frame()?.seq ?? 0,
  }
}

async function stopGame() {
  const session = state.session
  state.session = null
  if (session) await session.stop()
}

let startAttempt = 0

async function startGame(entry) {
  const attempt = ++startAttempt
  state.entry = entry
  state.phase = 'loading'
  state.progress = null
  state.message = `Starting ${entry.title}...`
  const game = gameById(entry.kind)
  try {
    await stopGame()
    let content = entry.file
    let saveDir
    if (entry.kind === 'doom') {
      if (entry.origin === 'free') {
        if (!fs.existsSync(entry.file)) state.message = 'Downloading Freedoom (24 MB, one time only)...'
        content = await ensureFreedoom(dirs.wads, fraction => { state.progress = fraction })
        state.progress = null
      }
      saveDir = path.join(dirs.doomSaves, slug(path.basename(content)))
    } else {
      saveDir = path.join(dirs.gameboySaves, slug(path.basename(content)))
    }
    if (!fs.existsSync(content)) throw new Error(`${path.basename(content)} is missing.`)
    const session = new GameSession(game, {
      wasm: path.join(CORES_DIR, entry.kind === 'doom' ? 'doom.wasm' : 'gameboy.wasm'),
      content,
      saveDir,
      runDir,
    }, entry.title)
    // Another start came in while this one waited: let that one win.
    if (attempt !== startAttempt) return
    session.start()
    state.session = session
    state.phase = 'playing'
    state.message = ''
  } catch (error) {
    if (attempt !== startAttempt) return
    state.phase = 'failed'
    state.message = error.message
  }
}

// Notice when a game ends by itself (Doom's Quit, a crash).
setInterval(() => {
  const session = state.session
  if (session?.ended && state.phase === 'playing') {
    state.phase = 'ended'
    state.message = session.ended.reason
    state.session = null
    session.stop().catch(() => {})
  }
  if (Date.now() - lastRequestAt > IDLE_EXIT_MS) shutdown(0)
}, 500).unref()

// --- HTTP over the Unix socket ------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request too large'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('Body is not JSON'))
      }
    })
    req.on('error', reject)
  })
}

const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

const requirePlaying = res => {
  if (state.session && state.phase === 'playing') return state.session
  json(res, 409, { error: 'No game is running.', state: publicState() })
  return null
}

const clampInt = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

const routes = {
  'GET /health': (req, res) => json(res, 200, { ok: true, version: RUNNER_VERSION, node: process.version }),

  'GET /library': (req, res) => {
    // Paths under the home folder read better as ~/...
    const home = os.homedir()
    const tidy = p => (p.startsWith(`${home}/`) ? `~/${p.slice(home.length + 1)}` : p)
    json(res, 200, { games: library(dirs), dirs: { home: tidy(dirs.home), roms: tidy(dirs.roms), wads: tidy(dirs.wads) } })
  },

  'GET /state': (req, res) => json(res, 200, publicState()),

  'POST /start': async (req, res, body) => {
    const entry = findGame(library(dirs), body.id ?? body.query ?? '', body.kind)
    if (!entry) return json(res, 404, { error: `No game matches "${body.id ?? body.query ?? ''}".` })
    void startGame(entry)
    json(res, 202, publicState())
  },

  'POST /stop': async (req, res) => {
    await stopGame()
    state.phase = 'idle'
    state.entry = null
    state.message = ''
    json(res, 200, publicState())
  },

  'GET /raster': (req, res, body, url) => {
    const session = requirePlaying(res)
    if (!session) return
    const columns = clampInt(url.searchParams.get('columns'), 1, 512, 80)
    const rows = clampInt(url.searchParams.get('rows'), 1, 256, 24)
    const since = clampInt(url.searchParams.get('since'), -1, 2 ** 31 - 1, -1)
    const raster = session.raster(columns, rows, since)
    if (!raster) return res.writeHead(204).end()
    res.writeHead(200, { 'content-type': 'text/plain', 'x-frame': String(raster.seq) })
    res.end(raster.cells)
  },

  'GET /pixels': (req, res, body, url) => {
    const session = requirePlaying(res)
    if (!session) return
    const since = clampInt(url.searchParams.get('since'), -1, 2 ** 31 - 1, -1)
    const pixels = session.pixels(since)
    if (!pixels) return res.writeHead(204).end()
    json(res, 200, pixels)
  },

  'GET /screenshot': (req, res) => {
    const session = requirePlaying(res)
    if (!session) return
    const shot = session.screenshot()
    if (!shot) return json(res, 425, { error: 'The game has not drawn a frame yet.' })
    json(res, 200, { ...shot, state: publicState() })
  },

  'POST /keys': (req, res, body) => {
    const session = requirePlaying(res)
    if (!session) return
    const keys = Array.isArray(body.keys) ? body.keys.filter(k => typeof k === 'string').slice(0, 64) : []
    json(res, 200, { pressed: session.personKeys(keys), isRunHeld: session.input.toggled.has('run') })
  },

  'POST /press': async (req, res, body) => {
    const session = requirePlaying(res)
    if (!session) return
    const steps = (Array.isArray(body.steps) ? body.steps : []).slice(0, 20).map(step => (
      typeof step.text === 'string'
        ? { text: step.text.replace(/[^ -~]/g, '').slice(0, 24) }
        : {
            buttons: Array.isArray(step.buttons) ? step.buttons.filter(b => typeof b === 'string').slice(0, 6) : [],
            ms: clampInt(step.ms, 30, 3000, 200),
          }
    ))
    const unknown = steps.flatMap(s => s.buttons ?? []).filter(b => !(b in session.game.buttons))
    if (unknown.length > 0) {
      return json(res, 400, { error: `Unknown button(s): ${[...new Set(unknown)].join(', ')}. Buttons: ${Object.keys(session.game.buttons).join(', ')}` })
    }
    await session.claudeSteps(steps)
    json(res, 200, { ...(session.screenshot() ?? {}), state: publicState() })
  },

  'POST /pause': (req, res, body) => {
    const session = requirePlaying(res)
    if (!session) return
    session.setPaused(Boolean(body.paused))
    json(res, 200, publicState())
  },

  'POST /save-state': async (req, res) => {
    const session = requirePlaying(res)
    if (!session) return
    if (session.game.id !== 'gameboy') return json(res, 400, { error: 'Save states are for Game Boy games. In Doom, save from the menu.' })
    json(res, 200, { ok: await session.command(COMMAND.SAVE_STATE) })
  },

  'POST /load-state': async (req, res) => {
    const session = requirePlaying(res)
    if (!session) return
    if (session.game.id !== 'gameboy') return json(res, 400, { error: 'Save states are for Game Boy games. In Doom, load from the menu.' })
    json(res, 200, { ok: await session.command(COMMAND.LOAD_STATE) })
  },

  'POST /quit': (req, res) => {
    json(res, 200, { ok: true })
    setTimeout(() => shutdown(0), 10)
  },
}

const server = http.createServer(async (req, res) => {
  lastRequestAt = Date.now()
  if (req.headers['x-couch-coop-token'] !== token) return json(res, 401, { error: 'Bad token' })
  const url = new URL(req.url, 'http://runner')
  const route = routes[`${req.method} ${url.pathname}`]
  if (!route) return json(res, 404, { error: `No route ${req.method} ${url.pathname}` })
  try {
    const body = req.method === 'POST' ? await readBody(req) : {}
    await route(req, res, body, url)
  } catch (error) {
    if (!res.headersSent) json(res, 500, { error: error.message })
  }
})

let isShuttingDown = false
async function shutdown(code) {
  if (isShuttingDown) return
  isShuttingDown = true
  try {
    await stopGame()
  } catch {}
  server.close()
  fs.rmSync(runDir, { recursive: true, force: true })
  process.exit(code)
}

process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))
process.on('SIGHUP', () => shutdown(0))

ensureDir(dirs.home)
ensureDir(dirs.roms)
ensureDir(dirs.wads)
server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 0o600)
  process.stdout.write(`COUCH_COOP_READY ${JSON.stringify({ socket: socketPath, token, runDir, version: RUNNER_VERSION })}\n`)
})
