// Who is pressing which button.
//
// A terminal reports key presses and auto-repeats, never releases. So a key
// the person presses holds its button for a moment, and each auto-repeat
// keeps it held a little longer; when the repeats stop, the button lets go.
// Claude's presses come with explicit durations instead.

import { normalizeKey } from './games.mjs'

export const HOLD_TIMING = Object.freeze({
  // Long enough to bridge the pause before a held key starts repeating
  // (macOS waits about 375 ms by default), short enough that a tap is a tap.
  firstPressMs: 300,
  // Comfortably longer than the gap between auto-repeats (about 90 ms).
  repeatMs: 150,
  // How long a tap-style button (use, menu, weapon) stays down.
  tapMs: 120,
})

const SOURCES = ['person', 'claude', 'toggle']

export class InputController {
  /**
   * @param game a GAMES entry
   * @param send (code, isDown) => void, called on every button change
   * @param timing override HOLD_TIMING (tests use shorter times)
   */
  constructor(game, send, timing = HOLD_TIMING) {
    this.game = game
    this.send = send
    this.timing = timing
    this.holders = new Map() // button -> Set of sources holding it
    this.releaseTimers = new Map() // button -> timeout for the person's hold
    this.toggled = new Set()
    for (const button of game.toggledOnStart) this.toggle(button)
  }

  isDown(button) {
    return (this.holders.get(button)?.size ?? 0) > 0
  }

  /** Marks `source` as holding (or no longer holding) `button`. */
  hold(button, source, isHeld) {
    if (!(button in this.game.buttons) || !SOURCES.includes(source)) return
    const wasDown = this.isDown(button)
    let set = this.holders.get(button)
    if (!set) {
      set = new Set()
      this.holders.set(button, set)
    }
    if (isHeld) set.add(source)
    else set.delete(source)
    const isDown = this.isDown(button)
    if (isDown !== wasDown) this.send(this.game.buttons[button], isDown)
  }

  toggle(button) {
    const isOn = !this.toggled.has(button)
    if (isOn) this.toggled.add(button)
    else this.toggled.delete(button)
    this.hold(button, 'toggle', isOn)
    return isOn
  }

  /**
   * One key press from the person's terminal (a first press or a repeat).
   * Returns the button it pressed, or null for a key the game ignores.
   */
  personKey(rawKey) {
    const key = normalizeKey(rawKey)
    if (key === null) return null
    const toggleButton = this.game.toggles[key]
    if (toggleButton) {
      this.toggle(toggleButton)
      return toggleButton
    }
    const button = this.game.keys[key]
    if (!button) return null
    const isTap = this.game.taps.includes(button)
    const alreadyHeld = this.holders.get(button)?.has('person') ?? false
    const ms = isTap ? this.timing.tapMs : alreadyHeld ? this.timing.repeatMs : this.timing.firstPressMs
    if (isTap && alreadyHeld) return button // a repeat of a tap button does not re-press it
    clearTimeout(this.releaseTimers.get(button))
    this.hold(button, 'person', true)
    this.releaseTimers.set(button, setTimeout(() => {
      this.releaseTimers.delete(button)
      this.hold(button, 'person', false)
    }, ms))
    return button
  }

  /** Types one character as the game's own key code (for text such as a save name). */
  typeCharacter(code) {
    this.send(code, true)
    setTimeout(() => this.send(code, false), this.timing.tapMs)
  }

  /**
   * Claude's input: steps run one after another. Each step holds its
   * buttons for `ms` milliseconds, then lets them go (an empty step waits).
   */
  async claudeSteps(steps, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    for (const step of steps) {
      if (typeof step.text === 'string') {
        // Text (a Doom save name): each character as its own key, then on.
        for (const ch of step.text) {
          this.typeCharacter(ch.toLowerCase().charCodeAt(0))
          await sleep(this.timing.tapMs + 30)
        }
        continue
      }
      const buttons = (step.buttons ?? []).filter(b => b in this.game.buttons)
      for (const button of buttons) this.hold(button, 'claude', true)
      await sleep(step.ms)
      for (const button of buttons) this.hold(button, 'claude', false)
      // A beat between steps so two taps of one button register as two.
      await sleep(40)
    }
  }

  /** Lets go of everything the person and Claude hold (toggles stay). */
  releaseAll() {
    for (const timer of this.releaseTimers.values()) clearTimeout(timer)
    this.releaseTimers.clear()
    for (const button of this.holders.keys()) {
      this.hold(button, 'person', false)
      this.hold(button, 'claude', false)
    }
  }
}
