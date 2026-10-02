// Runs a Game Boy game (the binjgb core compiled to WebAssembly) in a worker.
//
// The core is a "reactor": this thread drives it, one frame at a time at the
// Game Boy's own rate (about 59.7 frames a second), feeding it the buttons
// from the shared key ring and publishing each finished frame. It also keeps
// the cartridge's battery save (where games like Pokemon save) on disk.

import fs from 'node:fs'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { WASI } from 'node:wasi'

import { writeFileAtomic } from '../lib/paths.mjs'
import { COMMAND, CTL, STATUS, popKey, publishFrame, sleep } from '../lib/shared.mjs'

const { ctlBuffer, frameBuffers, wasmPath, romPath, saveDir } = workerData
const ctl = new Int32Array(ctlBuffer)
const FRAME_MS = 1000 / (4194304 / 70224) // ~16.74 ms
const WIDTH = 160
const HEIGHT = 144
const SAVE_EVERY_MS = 2000

const romName = path.basename(romPath).replace(/\.[^.]+$/, '')
const batteryFile = path.join(saveDir, `${romName}.sav`)
const stateFile = path.join(saveDir, `${romName}.state`)

let gb
let memory

const bytes = (pointer, length) => new Uint8Array(memory.buffer, pointer, length)

function writeBatterySave() {
  const size = gb.gb_save_size()
  if (size === 0 || !gb.gb_save_read()) return false
  writeFileAtomic(batteryFile, Buffer.from(bytes(gb.gb_save_ptr(), size)))
  return true
}

function loadBatterySave() {
  const size = gb.gb_save_size()
  if (size === 0 || !fs.existsSync(batteryFile)) return
  const data = fs.readFileSync(batteryFile)
  if (data.length !== size) return // a save from another game or a different size; leave it
  bytes(gb.gb_save_ptr(), size).set(data)
  gb.gb_save_load()
}

function saveState() {
  if (!gb.gb_state_write()) return false
  writeFileAtomic(stateFile, Buffer.from(bytes(gb.gb_state_ptr(), gb.gb_state_size())))
  return true
}

function loadState() {
  if (!fs.existsSync(stateFile)) return false
  const data = fs.readFileSync(stateFile)
  if (data.length !== gb.gb_state_size()) return false
  bytes(gb.gb_state_ptr(), data.length).set(data)
  return Boolean(gb.gb_state_read())
}

function runCommand(command) {
  try {
    if (command === COMMAND.SAVE_STATE) return saveState()
    if (command === COMMAND.LOAD_STATE) return loadState()
    if (command === COMMAND.FLUSH_SAVE) {
      writeBatterySave()
      return true
    }
  } catch (error) {
    parentPort.postMessage({ type: 'log', message: String(error) })
  }
  return false
}

try {
  fs.mkdirSync(saveDir, { recursive: true })
  const wasi = new WASI({ version: 'preview1', args: ['gameboy'], env: {}, returnOnExit: true })
  const module = await WebAssembly.compile(fs.readFileSync(wasmPath))
  const instance = await WebAssembly.instantiate(module, wasi.getImportObject())
  wasi.initialize(instance)
  gb = instance.exports
  memory = gb.memory

  const rom = fs.readFileSync(romPath)
  const romPointer = gb.gb_alloc(rom.length)
  bytes(romPointer, rom.length).set(rom)
  if (!gb.gb_create(romPointer, rom.length)) throw new Error(`${path.basename(romPath)} is not a Game Boy ROM this emulator can run.`)
  loadBatterySave()
  parentPort.postMessage({ type: 'title', title: romName })
  Atomics.store(ctl, CTL.STATUS, STATUS.RUNNING)

  let buttons = 0
  let nextFrameAt = performance.now()
  let lastSaveCheck = performance.now()
  let isSaveDirty = false

  for (;;) {
    for (let key = popKey(ctl); key !== null; key = popKey(ctl)) {
      buttons = key.isDown ? buttons | (1 << key.code) : buttons & ~(1 << key.code)
    }
    gb.gb_set_buttons(buttons)

    const command = Atomics.load(ctl, CTL.COMMAND)
    if (command !== COMMAND.NONE) {
      Atomics.store(ctl, CTL.COMMAND_RESULT, runCommand(command) ? 1 : -1)
      Atomics.store(ctl, CTL.COMMAND, COMMAND.NONE)
    }

    if (Atomics.load(ctl, CTL.PAUSED) === 1) {
      sleep(ctl, 20)
      nextFrameAt = performance.now()
      continue
    }

    gb.gb_run_frame()
    publishFrame(ctl, frameBuffers, bytes(gb.gb_frame(), WIDTH * HEIGHT * 4), WIDTH, HEIGHT)

    // Keep the battery save on disk shortly after the game writes it.
    if (gb.gb_save_changed()) isSaveDirty = true
    const now = performance.now()
    if (isSaveDirty && now - lastSaveCheck > SAVE_EVERY_MS) {
      writeBatterySave()
      isSaveDirty = false
      lastSaveCheck = now
    }

    nextFrameAt += FRAME_MS
    const wait = nextFrameAt - performance.now()
    if (wait > 0) sleep(ctl, wait)
    else if (wait < -250) nextFrameAt = performance.now() // fell far behind: don't try to catch up
  }
} catch (error) {
  Atomics.store(ctl, CTL.STATUS, STATUS.FAILED)
  parentPort.postMessage({ type: 'error', message: String(error?.message ?? error) })
}
