// The key strip: a one-row region under the game that takes the keyboard.
//
// Click it and your keys go to the game; Esc hands the keyboard back to
// Claude Code. It runs on the drawing side, so it cannot call the runner
// itself: it posts the keys to the hooks module, which forwards them. Keys
// stay in its outbox until the hooks module acknowledges them, so none is
// lost when two posts land in one frame.

import type { ClientModule } from 'claude-code'

type Props = { hint: string; ack: number }

type Outbox = { nextId: number; keys: { id: number; key: string }[]; ack: number }

type State = { outbox: Outbox; lastKey: string; hasFocus: boolean; lastKeyAt: number }

const IDLE_HINT_MS = 8000

const KeyStrip: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements

  if (surface.state === undefined) {
    const outbox: Outbox = { nextId: 1, keys: [], ack: props.ack }
    surface.setState({ outbox, lastKey: '', hasFocus: false, lastKeyAt: 0 })

    surface.onKey(event => {
      const state = surface.state
      if (!state || event.ctrl || event.meta) return
      state.outbox.keys.push({ id: state.outbox.nextId++, key: event.key })
      surface.setState({ ...state, lastKey: event.key, hasFocus: true, lastKeyAt: Date.now() })
    })

    surface.onPointer(event => {
      const state = surface.state
      if (state && event.type === 'down') surface.setState({ ...state, hasFocus: true, lastKeyAt: Date.now() })
    })

    // About thirty times a second, send whatever the hooks module has not acknowledged.
    surface.every(33, () => {
      const state = surface.state
      if (!state) return
      const box = state.outbox
      box.keys = box.keys.filter(k => k.id > box.ack)
      if (box.keys.length > 0) surface.post({ keys: box.keys.map(k => ({ id: k.id, key: k.key })) })
      if (state.hasFocus && Date.now() - state.lastKeyAt > IDLE_HINT_MS) {
        // No keys for a while: they probably pressed Esc. Show how to come back.
        surface.setState({ ...state, hasFocus: false })
      }
    })
  }

  const state = surface.state
  if (state) state.outbox.ack = Math.max(state.outbox.ack, props.ack)
  const isActive = state?.hasFocus ?? false
  const shownKey = state?.lastKey === ' ' ? 'space' : state?.lastKey

  return (
    <Box flexDirection="row" width="100%">
      <Text wrap="truncate-end">
        {isActive
          ? <Text color="green" bold>● Playing</Text>
          : <Text color="yellow" bold>▶ Click here to play</Text>}
        <Text dimColor>
          {'  '}
          {isActive && shownKey ? `[${shownKey}] ` : ''}
          {props.hint} · Esc gives the keyboard back
        </Text>
      </Text>
    </Box>
  )
}

export default KeyStrip
