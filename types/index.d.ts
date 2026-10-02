// Couch Co-op's type contract: the values it keeps in `$.state` for the
// session. `claude plugin validate` holds every state key the hooks module
// names to this file.

/** Where the runner (the local game server) stands. */
export type CouchCoopRunner =
  | { status: 'off' }
  | { status: 'starting' }
  | { status: 'ready' }
  | { status: 'no-node'; detail: string }
  | { status: 'failed'; detail: string }

/** One game the launcher lists. */
export type CouchCoopGame = {
  id: string
  kind: 'doom' | 'gameboy'
  title: string
  /** `free`: Freedoom or bundled homebrew. `yours`: a file the person added. */
  origin: 'free' | 'yours'
}

/** The runner's view of play, mirrored for drawing. */
export type CouchCoopPlay = {
  phase: 'idle' | 'loading' | 'playing' | 'ended' | 'failed'
  message: string
  /** 0 to 1 while downloading, else null. */
  progress: number | null
  game: {
    id: string
    kind: 'doom' | 'gameboy'
    title: string
    aspect: number
    hint: string
    buttons: string[]
  } | null
  isPaused: boolean
  isRunHeld: boolean
}

/** Claude's seat on the couch. */
export type CouchCoopClaude = {
  /** When false, the press tool refuses and Claude only watches. */
  isOn: boolean
  /** Claude's latest one-line narration, shown under the game. */
  say: string
}

declare module 'claude-code' {
  interface PluginState {
    'couch-coop': {
      runner: CouchCoopRunner
      library: CouchCoopGame[]
      folders: { roms: string; wads: string; home: string } | null
      play: CouchCoopPlay
      claude: CouchCoopClaude
    }
  }
}
