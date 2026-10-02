import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CTL, RING_SIZE, createShared, latestFrame, popKey, publishFrame, publishStatus, pushKey, readStatus } from '../lib/shared.mjs'

test('keys come out of the ring in the order they went in', () => {
  const { ctl } = createShared(4, 4)
  const view = new Int32Array(ctl)
  pushKey(view, 0xad, true)
  pushKey(view, 0xad, false)
  assert.deepEqual(popKey(view), { code: 0xad, isDown: true })
  assert.deepEqual(popKey(view), { code: 0xad, isDown: false })
  assert.equal(popKey(view), null)
})

test('a full ring drops new keys instead of overwriting old ones', () => {
  const { ctl } = createShared(4, 4)
  const view = new Int32Array(ctl)
  for (let i = 0; i < RING_SIZE; i++) assert.equal(pushKey(view, i, true), true)
  assert.equal(pushKey(view, 999, true), false)
  assert.deepEqual(popKey(view), { code: 0, isDown: true })
})

test('frames are double-buffered and numbered', () => {
  const shared = createShared(2, 2)
  const view = new Int32Array(shared.ctl)
  assert.equal(latestFrame(view, shared.frames, 'rgba'), null)
  publishFrame(view, shared.frames, new Uint8Array(16).fill(1), 2, 2)
  publishFrame(view, shared.frames, new Uint8Array(16).fill(2), 2, 2)
  const frame = latestFrame(view, shared.frames, 'rgba')
  assert.equal(frame.seq, 2)
  assert.equal(frame.width, 2)
  assert.equal(frame.data[0], 2)
  assert.equal(view[CTL.FRAME_SEQ], 2)
})

test('status numbers round-trip', () => {
  const { ctl } = createShared(1, 1)
  const view = new Int32Array(ctl)
  publishStatus(view, [3, 1, 4, 1, 5])
  assert.deepEqual(readStatus(view), [3, 1, 4, 1, 5])
})
