// Shared-memory layout between the runner's main thread and a game worker.
//
// The worker runs the emulator in a tight synchronous loop, so it cannot
// receive postMessage events while it plays. Everything the two threads
// exchange during play goes through these SharedArrayBuffers instead.

/** Int32 slots in the control buffer. */
export const CTL = Object.freeze({
  FRAME_SEQ: 0, // bumped by the worker after each finished frame
  KEY_WRITE: 1, // next ring slot the main thread writes
  SLEEP: 2, // always 0; the worker sleeps with Atomics.wait on it
  KEY_READ: 3, // next ring slot the worker reads
  WIDTH: 4, // frame width in pixels
  HEIGHT: 5, // frame height in pixels
  STATUS: 6, // see STATUS below
  COMMAND: 7, // see COMMAND below; the worker clears it when done
  COMMAND_RESULT: 8, // 1 ok, -1 failed, set before COMMAND is cleared
  PAUSED: 9, // 1 while the main thread wants the game paused
  STATUS_COUNT: 10, // how many status fields the core published
  STATUS_FIELDS: 16, // first of up to 16 status fields (see status.mjs)
  RING: 32, // first slot of the key ring
})

export const MAX_STATUS_FIELDS = 16

export const RING_SIZE = 256
export const CTL_LENGTH = CTL.RING + RING_SIZE

export const STATUS = Object.freeze({ STARTING: 0, RUNNING: 1, EXITED: 2, FAILED: 3 })

export const COMMAND = Object.freeze({ NONE: 0, SAVE_STATE: 1, LOAD_STATE: 2, FLUSH_SAVE: 3 })

/** Byte order of the pixels a worker publishes. */
export const PIXEL_FORMAT = Object.freeze({ BGRX: 'bgrx', RGBA: 'rgba' })

/**
 * Allocates the buffers for one game: a control block and two frame buffers
 * (double-buffered so the main thread never reads a half-written frame).
 */
export function createShared(maxWidth, maxHeight) {
  return {
    ctl: new SharedArrayBuffer(CTL_LENGTH * 4),
    frames: [
      new SharedArrayBuffer(maxWidth * maxHeight * 4),
      new SharedArrayBuffer(maxWidth * maxHeight * 4),
    ],
  }
}

/** Main thread: queues one key event (`code` is the core's own key code). */
export function pushKey(ctl, code, isDown) {
  const write = Atomics.load(ctl, CTL.KEY_WRITE)
  const read = Atomics.load(ctl, CTL.KEY_READ)
  if (write - read >= RING_SIZE) return false // the game stopped reading; drop it
  ctl[CTL.RING + (write % RING_SIZE)] = ((isDown ? 1 : 0) << 16) | (code & 0xffff)
  Atomics.store(ctl, CTL.KEY_WRITE, write + 1)
  return true
}

/** Worker: takes the next key event, or returns null when none is queued. */
export function popKey(ctl) {
  const read = Atomics.load(ctl, CTL.KEY_READ)
  if (read === Atomics.load(ctl, CTL.KEY_WRITE)) return null
  const value = ctl[CTL.RING + (read % RING_SIZE)]
  Atomics.store(ctl, CTL.KEY_READ, read + 1)
  return { code: value & 0xffff, isDown: (value >> 16) === 1 }
}

/** Worker: publishes a finished frame into the buffer the main thread is not reading. */
export function publishFrame(ctl, frames, pixels, width, height) {
  const next = Atomics.load(ctl, CTL.FRAME_SEQ) + 1
  new Uint8Array(frames[next % 2]).set(pixels.subarray(0, width * height * 4))
  ctl[CTL.WIDTH] = width
  ctl[CTL.HEIGHT] = height
  Atomics.store(ctl, CTL.FRAME_SEQ, next)
}

/** Main thread: the newest finished frame, or null before the first one. */
export function latestFrame(ctl, frames, format) {
  const seq = Atomics.load(ctl, CTL.FRAME_SEQ)
  if (seq === 0) return null
  const width = ctl[CTL.WIDTH]
  const height = ctl[CTL.HEIGHT]
  return { seq, width, height, format, data: new Uint8Array(frames[seq % 2], 0, width * height * 4) }
}

/** Worker: publishes the core's status numbers (Doom's health, level, menu...). */
export function publishStatus(ctl, fields) {
  const count = Math.min(fields.length, MAX_STATUS_FIELDS)
  for (let i = 0; i < count; i++) ctl[CTL.STATUS_FIELDS + i] = fields[i]
  Atomics.store(ctl, CTL.STATUS_COUNT, count)
}

/** Main thread: the status numbers the core last published. */
export function readStatus(ctl) {
  const count = Atomics.load(ctl, CTL.STATUS_COUNT)
  return Array.from({ length: count }, (_, i) => ctl[CTL.STATUS_FIELDS + i])
}

/** Worker: sleeps without spinning; wakes early if the main thread notifies. */
export function sleep(ctl, ms) {
  if (ms > 0) Atomics.wait(ctl, CTL.SLEEP, 0, ms)
}
