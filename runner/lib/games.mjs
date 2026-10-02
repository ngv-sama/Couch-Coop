// The games the runner can host, and how keys reach them.
//
// Each game names its buttons. Three things press them: the person's
// keyboard (through the pane's key strip), Claude (through the press tool),
// and toggles (Doom's always-run). A button is down while any of them holds it.

export const GAMES = Object.freeze({
  doom: Object.freeze({
    id: 'doom',
    title: 'Doom',
    worker: 'doom-worker.mjs',
    // Doom draws 320x200 pixels meant to be shown at 4:3.
    aspect: 4 / 3,
    aspectHeight: 240,
    maxWidth: 320,
    maxHeight: 200,
    // Doom's own key codes (doomkeys.h).
    buttons: Object.freeze({
      forward: 0xad,
      back: 0xaf,
      turn_left: 0xac,
      turn_right: 0xae,
      strafe_left: 0xa0,
      strafe_right: 0xa1,
      fire: 0xa3,
      use: 0xa2,
      run: 0x80 + 0x36,
      map: 9,
      menu: 27,
      enter: 13,
      back_menu: 0x7f,
      yes: 'y'.charCodeAt(0),
      no: 'n'.charCodeAt(0),
      pause: 0xff,
      weapon_1: '1'.charCodeAt(0),
      weapon_2: '2'.charCodeAt(0),
      weapon_3: '3'.charCodeAt(0),
      weapon_4: '4'.charCodeAt(0),
      weapon_5: '5'.charCodeAt(0),
      weapon_6: '6'.charCodeAt(0),
      weapon_7: '7'.charCodeAt(0),
    }),
    // Buttons a quick tap should press briefly rather than hold.
    taps: Object.freeze(['use', 'map', 'menu', 'enter', 'back_menu', 'yes', 'no', 'pause',
      'weapon_1', 'weapon_2', 'weapon_3', 'weapon_4', 'weapon_5', 'weapon_6', 'weapon_7']),
    keys: Object.freeze({
      w: 'forward', up: 'forward',
      s: 'back', down: 'back',
      a: 'strafe_left', d: 'strafe_right',
      left: 'turn_left', right: 'turn_right',
      ' ': 'fire', space: 'fire', f: 'fire',
      e: 'use',
      return: 'enter', enter: 'enter',
      tab: 'map',
      m: 'menu', '`': 'menu',
      backspace: 'back_menu', delete: 'back_menu',
      y: 'yes', n: 'no',
      p: 'pause',
      1: 'weapon_1', 2: 'weapon_2', 3: 'weapon_3', 4: 'weapon_4', 5: 'weapon_5', 6: 'weapon_6', 7: 'weapon_7',
    }),
    toggles: Object.freeze({ r: 'run' }),
    // Terminals send no key-up events, so Doom starts with run held on.
    toggledOnStart: Object.freeze(['run']),
    hint: 'WASD move · ←→ turn · Space fire · E use · R run · M menu · Tab map · 1-7 weapons',
  }),

  gameboy: Object.freeze({
    id: 'gameboy',
    title: 'Game Boy',
    worker: 'gameboy-worker.mjs',
    aspect: 160 / 144,
    aspectHeight: 144,
    maxWidth: 160,
    maxHeight: 144,
    // Bit positions in the joypad mask the Game Boy core reads.
    buttons: Object.freeze({ right: 0, left: 1, up: 2, down: 3, a: 4, b: 5, select: 6, start: 7 }),
    taps: Object.freeze([]),
    keys: Object.freeze({
      up: 'up', w: 'up',
      down: 'down', s: 'down',
      left: 'left', a: 'left',
      right: 'right', d: 'right',
      x: 'a', k: 'a',
      z: 'b', j: 'b',
      return: 'start', enter: 'start',
      ' ': 'select', space: 'select', backspace: 'select',
    }),
    toggles: Object.freeze({}),
    toggledOnStart: Object.freeze([]),
    hint: 'Arrows/WASD move · X or K = A · Z or J = B · Enter Start · Space Select',
  }),
})

export const gameById = id => GAMES[id] ?? null

/** Normalizes a key name from the terminal: `A` and `a` are the same key. */
export function normalizeKey(key) {
  if (typeof key !== 'string' || key.length === 0) return null
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase()
}

/** Every button name a game takes, for the press tool's input schema. */
export function buttonNames(game) {
  return Object.keys(game.buttons)
}
