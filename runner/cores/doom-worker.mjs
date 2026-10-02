// Runs Doom (doomgeneric compiled to WebAssembly) in a worker thread.
//
// Doom's main loop is synchronous: it sleeps between tics and polls for keys.
// Here those calls land on the shared buffers in ../lib/shared.mjs, so the
// main thread can read frames and queue keys while this thread plays.

import fs from 'node:fs'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { WASI } from 'node:wasi'

import { CTL, STATUS, popKey, publishFrame, publishStatus, sleep } from '../lib/shared.mjs'

const { ctlBuffer, frameBuffers, wasmPath, wadPath, saveDir } = workerData
const ctl = new Int32Array(ctlBuffer)
const startedAt = performance.now()
let pausedMs = 0 // time spent paused, hidden from Doom's clock so it never fast-forwards
const decoder = new TextDecoder()
let memory

const wasi = new WASI({
  version: 'preview1',
  args: ['doom', '-iwad', `/iwad/${path.basename(wadPath)}`],
  env: { HOME: '/' },
  // `/` is Doom's config and save folder; the WAD folder is mounted read-only in spirit.
  preopens: { '/': saveDir, '/iwad': path.dirname(wadPath) },
  returnOnExit: true,
})

const cString = pointer => {
  const bytes = new Uint8Array(memory.buffer, pointer)
  return decoder.decode(bytes.subarray(0, bytes.indexOf(0)))
}

const host = {
  draw_frame(pointer, width, height) {
    publishFrame(ctl, frameBuffers, new Uint8Array(memory.buffer, pointer, width * height * 4), width, height)
    // While paused, hold the game here; Doom resumes where it was.
    if (Atomics.load(ctl, CTL.PAUSED) === 1) {
      const pausedAt = performance.now()
      while (Atomics.load(ctl, CTL.PAUSED) === 1) sleep(ctl, 20)
      pausedMs += performance.now() - pausedAt
    }
  },
  sleep_ms(ms) {
    sleep(ctl, ms)
  },
  ticks_ms() {
    return (performance.now() - startedAt - pausedMs) >>> 0
  },
  get_key() {
    const key = popKey(ctl)
    return key === null ? -1 : ((key.isDown ? 1 : 0) << 8) | (key.code & 0xff)
  },
  status(pointer, count) {
    publishStatus(ctl, new Int32Array(memory.buffer, pointer, count))
  },
  set_title(pointer) {
    parentPort.postMessage({ type: 'title', title: cString(pointer) })
  },
}

try {
  const module = await WebAssembly.compile(fs.readFileSync(wasmPath))
  const instance = await WebAssembly.instantiate(module, { ...wasi.getImportObject(), arcade: host })
  memory = instance.exports.memory
  Atomics.store(ctl, CTL.STATUS, STATUS.RUNNING)
  const code = wasi.start(instance)
  Atomics.store(ctl, CTL.STATUS, STATUS.EXITED)
  parentPort.postMessage({ type: 'exit', code })
} catch (error) {
  Atomics.store(ctl, CTL.STATUS, STATUS.FAILED)
  parentPort.postMessage({ type: 'error', message: String(error?.stack ?? error) })
}
