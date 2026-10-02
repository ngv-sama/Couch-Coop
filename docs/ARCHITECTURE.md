# Architecture

Couch Co-op has three parts: a **mod** inside Claude Code, a **runner** process that hosts the games, and two **engines** compiled to WebAssembly. This page walks through each, then the paths a frame, a key press and one of Claude's moves take.

## The mod (`hooks/`)

A mod is a Claude Code plugin whose hooks module (`hooks/register.tsx`) registers functions Claude Code calls when things happen. Couch Co-op hooks:

| Event | What it does |
| --- | --- |
| `session.start` | Registers `/arcade`, `/doom`, `/gameboy`; decides between half-block and pixel pictures from the terminal's name |
| `command.run` | Opens the pane, starts the runner, starts a game |
| `ui.render` on the `Pane` | Draws the launcher, a loading bar, or the game with its key strip and buttons |
| `ui.message` | Receives key presses from the key strip and forwards them to the runner |
| `ui.close` | Pauses the game and stops repainting while nobody watches |
| `tool.call` | Serves Claude's `look` and `press` tools |
| `session.end` | Tells the runner to quit |

The mod keeps what the pane draws from in `$.state` (declared in `types/index.d.ts`): the runner's status, the game library, the state of play and Claude's seat. Reading a value while drawing subscribes the pane, so a change redraws it. Things that change many times a second (the picture) never go through state: they are painted straight into the mounted element with `$.ui.blit`.

The key strip (`hooks/client/keystrip.tsx`) is a *surface module*: it runs on the drawing side, where it can take the keyboard after a click. It cannot call the runner, so it posts keys to the hooks module, keeping each in an outbox until the hooks module acknowledges it, so none is lost when two posts land in one frame.

## The runner (`runner/`)

Mods cannot run WebAssembly or compiled code themselves, so the mod starts `node runner/main.mjs` with `$.process.spawn`. The runner:

1. Creates a private folder (`mkdtemp`, mode `0700`) and listens on a Unix socket in it, then prints `COUCH_COOP_READY {socket, token, ...}` for the mod.
2. Answers HTTP requests over that socket, checking the token on each.
3. Hosts one game at a time in a worker thread, so the game loop never blocks the server.
4. Exits on `POST /quit`, when the mod unloads (which ends the spawn loop and kills it), or after 60 seconds without a request. The mod sends a heartbeat every 20 seconds while the session lives.

### Endpoints

| Route | Answer |
| --- | --- |
| `GET /health` | `{ ok, version }` |
| `GET /library` | The games found, and the folders (with `~` for home) |
| `GET /state` | Phase (`idle`, `loading`, `playing`, `ended`, `failed`), the game, download progress, pause and run state |
| `POST /start` `{ id \| query, kind? }` | Starts a game (downloading Freedoom first if needed); answers at once with `202` |
| `POST /stop` | Stops the game |
| `GET /raster?columns&rows&since` | The newest frame as Raster cells (base64), header `x-frame`; `204` if nothing new since `since` |
| `GET /pixels?since` | Writes the newest frame as raw RGB to a file and answers the Image source for it |
| `GET /screenshot` | A PNG of the screen (base64) and the state of play in words |
| `POST /keys` `{ keys }` | The person's key presses, by terminal key name |
| `POST /press` `{ steps }` | Claude's moves; answers with a screenshot once they are done |
| `POST /pause` `{ paused }` | Holds or resumes the game |
| `POST /save-state`, `POST /load-state` | Game Boy save states |
| `POST /quit` | Exits |

### Shared memory between the runner and a game

A game loop is synchronous: it runs a frame, sleeps, polls for keys. It cannot stop to read messages, so the runner's main thread and the worker share two kinds of `SharedArrayBuffer` (`runner/lib/shared.mjs`):

- **A control block** of `Int32` slots: the frame counter, frame size, status, a command slot (save state, load state, write the battery save) with its result, the pause flag, the game's status numbers, and a 256-entry ring of key events.
- **Two frame buffers.** The worker writes each finished frame into the one the main thread is not reading, then bumps the frame counter. The main thread always reads a whole frame.

The worker sleeps with `Atomics.wait`, so it uses no CPU while waiting; the main thread can wake it early with `Atomics.notify`.

## The engines (`engines/`, built into `runner/cores/`)

| | Doom | Game Boy |
| --- | --- | --- |
| Source | doomgeneric (vendored) + `doomgeneric_arcade.c` | binjgb core (vendored) + `gameboy_arcade.c` |
| Build | `wasm32-wasi` program with a `main` loop | `wasm32-wasi` reactor: no loop, the worker drives it |
| Picture | 320x200, shown at 4:3 | 160x144 |
| Timing | Doom's own: it asks the host for the time and to sleep | The worker runs one frame every 16.74 ms |
| Files | Node's WASI: the WAD folder mounted at `/iwad`, the save folder at `/` | None: the worker copies the ROM in and the saves out |
| Extras | Publishes status numbers each frame: game state, menu, level, health, armor, weapon, ammo, kills, save-name entry | Battery save written to disk two seconds after the game changes it; save states |

Doom's platform layer is six functions doomgeneric asks of every port (draw a frame, sleep, read the clock, read a key, set the title, start up). Here each is a WebAssembly import the worker provides. While the game is paused, the Doom worker holds inside `draw_frame` and hides the paused time from Doom's clock, so Doom never tries to catch up afterwards.

## A frame's path

1. The worker publishes a frame into shared memory.
2. About 24 times a second (`fps` in settings), the mod's frame pump asks `GET /raster` with the size the pane last mounted.
3. The runner box-filters the frame down to `columns` x `2 * rows` pixels and packs each pair of vertically stacked pixels into one `▀` cell (foreground on top, background below): little-endian `[codePoint, foreground, background]` words, base64. It caches the result per frame and size.
4. The mod calls `$.ui.blit` with those cells, and Claude Code repaints the Raster in place without redrawing the pane.

In pixel mode (kitty, Ghostty), step 3 writes raw RGB to a file in the runner's private folder instead, and step 4 blits an `Image` whose source is that file; the terminal reads the pixels itself. If the terminal turns out not to draw images, the blit is refused and the mod falls back to half-blocks.

## A key press's path

1. The person clicks the key strip; Claude Code gives it the keyboard.
2. Each key press reaches the strip's `onKey`; it goes into the outbox, and about thirty times a second the outbox is posted to the hooks module.
3. The `ui.message` hook forwards new keys to `POST /keys` and acknowledges them.
4. The runner's input controller maps the key to a button (`runner/lib/games.mjs`) and queues a key-down event in the ring. Terminals send no key-up events, so the controller holds the button for 300 ms after the first press and 150 ms after each auto-repeat, then queues the key-up. Tap buttons (use, menu, weapons) press for 120 ms.
5. The game reads the key from the ring on its next tick.

When Doom waits for a typed save name, printable keys type characters instead of pressing buttons.

## One of Claude's moves

1. Claude calls `press` with steps like `[{ "buttons": ["forward", "fire"], "ms": 400 }]` and a line of narration.
2. The mod shows the narration under the game, then sends `POST /press`.
3. The runner un-pauses the game, holds each step's buttons for its time, lets the game draw the result, and, if the person has not pressed a key in the last 15 seconds, pauses it again so Claude can think.
4. The answer is a screenshot. The mod returns it to Claude as an image block, with the state of play in words (for Doom: level, health, ammo, menus, death).

The person and Claude can hold the same button at once; a button stays down until everyone holding it lets go. Benching Claude makes `press` refuse while `look` keeps working.
