// One game being played: its worker thread, its input, and its pictures.

import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { InputController } from './input.mjs'
import { encodePng, encodeRaster, toRgb } from './pixels.mjs'
import { ensureDir, writeFileAtomic } from './paths.mjs'
import { COMMAND, CTL, STATUS, createShared, latestFrame, pushKey, readStatus } from './shared.mjs'
import { describeStatus, isTyping } from './status.mjs'

const CORES = new URL('../cores/', import.meta.url)

// While Claude plays alone, the game waits between Claude's moves; if the
// person has pressed a key this recently, it keeps running for them.
const PERSON_ACTIVE_MS = 15_000

export class GameSession {
  /**
   * @param game a GAMES entry
   * @param files `{ wasm, content, saveDir, runDir }`: the core, the WAD or ROM,
   *   where the game keeps its saves, and a private folder for frame files
   * @param label what the pane calls this game (`Doom (Freedoom)`, a ROM's name)
   */
  constructor(game, files, label) {
    this.game = game
    this.files = files
    this.label = label
    this.title = label
    this.shared = createShared(game.maxWidth, game.maxHeight)
    this.ctl = new Int32Array(this.shared.ctl)
    this.input = new InputController(game, (code, isDown) => pushKey(this.ctl, code, isDown))
    this.lastPersonKeyAt = 0
    this.isClaudeTurnBased = false
    this.ended = null // { reason } once the worker stops
    this.rasterCache = { key: '', cells: '' }
    this.screenshotSeq = 0
  }

  start() {
    ensureDir(this.files.saveDir)
    this.worker = new Worker(new URL(this.game.worker, CORES), {
      workerData: {
        ctlBuffer: this.shared.ctl,
        frameBuffers: this.shared.frames,
        wasmPath: this.files.wasm,
        wadPath: this.files.content,
        romPath: this.files.content,
        saveDir: this.files.saveDir,
      },
    })
    this.worker.on('message', message => {
      if (message.type === 'title' && message.title) this.title = message.title
      if (message.type === 'exit') this.ended = { reason: 'The game quit.' }
      if (message.type === 'error') this.ended = { reason: `The game stopped: ${message.message.split('\n')[0]}` }
    })
    this.worker.on('error', error => {
      this.ended = { reason: `The game crashed: ${error.message}` }
    })
    this.worker.on('exit', () => {
      if (!this.ended) this.ended = { reason: 'The game closed.' }
    })
  }

  get status() {
    return Atomics.load(this.ctl, CTL.STATUS)
  }

  get isRunning() {
    return !this.ended && this.status !== STATUS.FAILED && this.status !== STATUS.EXITED
  }

  frame() {
    return latestFrame(this.ctl, this.shared.frames, this.game.id === 'doom' ? 'bgrx' : 'rgba')
  }

  setPaused(isPaused) {
    Atomics.store(this.ctl, CTL.PAUSED, isPaused ? 1 : 0)
    Atomics.notify(this.ctl, CTL.SLEEP)
  }

  get isPaused() {
    return Atomics.load(this.ctl, CTL.PAUSED) === 1
  }

  personKeys(keys) {
    const pressed = []
    const typing = isTyping(this.game.id, readStatus(this.ctl))
    for (const key of keys) {
      if (typing && typeof key === 'string' && key.length === 1 && key >= ' ' && key <= '~') {
        // Doom is asking for a save name: letters type instead of playing.
        this.input.typeCharacter(key.toLowerCase().charCodeAt(0))
        pressed.push('text')
        continue
      }
      const button = this.input.personKey(key)
      if (button) pressed.push(button)
    }
    if (pressed.length > 0) {
      this.lastPersonKeyAt = Date.now()
      // The person is playing: the game runs in real time again.
      if (this.isPaused && this.isClaudeTurnBased) this.setPaused(false)
    }
    return pressed
  }

  get isPersonActive() {
    return Date.now() - this.lastPersonKeyAt < PERSON_ACTIVE_MS
  }

  /** Runs Claude's steps; between Claude's moves the game waits unless the person is playing. */
  async claudeSteps(steps) {
    this.isClaudeTurnBased = true
    this.setPaused(false)
    try {
      await this.input.claudeSteps(steps)
      // Let the game take in the releases and draw the result.
      await new Promise(resolve => setTimeout(resolve, 80))
    } finally {
      if (!this.isPersonActive) this.setPaused(true)
    }
  }

  /** Raster cells for the newest frame at a size, or null when nothing changed since `since`. */
  raster(columns, rows, since) {
    const frame = this.frame()
    if (!frame || frame.seq === since) return null
    const key = `${frame.seq}:${columns}x${rows}`
    if (this.rasterCache.key !== key) {
      this.rasterCache = { key, cells: encodeRaster(frame, columns, rows) }
    }
    return { seq: frame.seq, cells: this.rasterCache.cells }
  }

  /**
   * Writes the newest frame as raw RGB for a terminal that draws pixels
   * (kitty, Ghostty) and returns the Image source for it.
   */
  pixels(since) {
    const frame = this.frame()
    if (!frame || frame.seq === since) return null
    const rgb = toRgb(frame, 1, this.game.aspectHeight)
    const file = path.join(this.files.runDir, `${this.game.id}-frame.rgb`)
    writeFileAtomic(file, rgb.data)
    return { seq: frame.seq, source: { file, format: 'rgb', width: rgb.width, height: rgb.height, generation: frame.seq } }
  }

  /** What the game is doing, in words (empty for games that publish nothing). */
  statusText() {
    return describeStatus(this.game.id, readStatus(this.ctl))
  }

  /** A PNG of the screen, big enough to read, as base64, with the status in words. */
  screenshot() {
    const frame = this.frame()
    if (!frame) return null
    const scale = frame.width < 200 ? 3 : 2
    const png = encodePng(toRgb(frame, scale, this.game.aspectHeight))
    return { seq: frame.seq, width: frame.width * scale, png: png.toString('base64'), status: this.statusText() }
  }

  /** Asks the core to run a command (save state, load state, write battery save). */
  async command(command, timeoutMs = 3000) {
    Atomics.store(this.ctl, CTL.COMMAND_RESULT, 0)
    Atomics.store(this.ctl, CTL.COMMAND, command)
    Atomics.notify(this.ctl, CTL.SLEEP)
    const wasPaused = this.isPaused
    if (wasPaused) this.setPaused(false)
    const deadline = Date.now() + timeoutMs
    try {
      while (Atomics.load(this.ctl, CTL.COMMAND) !== COMMAND.NONE) {
        if (Date.now() > deadline || !this.isRunning) return false
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      return Atomics.load(this.ctl, CTL.COMMAND_RESULT) === 1
    } finally {
      if (wasPaused) this.setPaused(true)
    }
  }

  async stop() {
    this.input.releaseAll()
    if (this.game.id === 'gameboy' && this.isRunning) await this.command(COMMAND.FLUSH_SAVE)
    await this.worker?.terminate()
    const frameFile = path.join(this.files.runDir, `${this.game.id}-frame.rgb`)
    fs.rmSync(frameFile, { force: true })
  }
}
