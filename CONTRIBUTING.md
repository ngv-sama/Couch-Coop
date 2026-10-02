# Contributing to Couch Co-op

Thanks for helping. This guide covers how the project is laid out, how to run it from your copy, the tests, and how to rebuild the game engines.

## Get set up

You need Claude Code 2.1.287 or newer, Node.js 20 or newer, and git.

```bash
git clone https://github.com/ngv-sama/couch-coop.git
cd couch-coop
npm install            # only TypeScript, for type-checking
npm run dev            # claude --plugin-dir . : this session loads your copy
```

While that session runs, Claude Code watches the folder: save a file in `hooks/` and the mod reloads when the folder goes quiet. The runner (`runner/`) is a separate process, so after changing it, run `/arcade`, press **Games**, and start the game again, or restart the session.

Loading the folder once also writes the mod API's type declarations to `.claude-plugin/types/` (ignored by git). After that, `npm run typecheck` works and your editor autocompletes the `$` API.

## How it fits together

```text
.claude-plugin/
  plugin.json           the plugin manifest: name, settings (userConfig), contract
  marketplace.json      lets people install straight from this GitHub repo
hooks/
  hooks.json            names the hooks module
  register.tsx          the mod: commands, the pane, the frame pump, Claude's tools
  client/keystrip.tsx   the key strip under the game (runs on the drawing side)
  lib/fit.ts            pure helpers (sizing, progress bar)
types/index.d.ts        the mod's state contract
skills/play/SKILL.md    how Claude plays (the couch-coop:play skill)
runner/
  main.mjs              the local game server the mod starts (HTTP over a Unix socket)
  lib/                  sessions, input timing, pixels to cells, PNG, ZIP, Freedoom
  cores/                the game workers and the built WebAssembly engines
  roms/                 the bundled homebrew ROM and its license
  test/                 the runner's tests
engines/
  doom/                 vendored doomgeneric + Couch Co-op's platform layer + build script
  gameboy/              vendored binjgb core + Couch Co-op's wrapper + build script
tests/                  the mod's tests (claude plugin test)
scripts/                build helpers
docs/                   architecture notes, publishing steps, screenshots
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the moving parts in depth.

### Two rules the mod API enforces

- **`$` only goes into functions declared at the top level of `hooks/register.tsx`.** Claude Code follows `$` through the module's source to know what the mod calls, and it does not follow it across an import. That is why every function that talks to the engine lives in that one file, and `hooks/lib/` holds only pure code.
- **No `import()`, `eval` or `WebAssembly` in the hooks module.** Compiled code runs in a process of its own, which is what the runner is for.

`npm run validate` runs `claude plugin validate`, which catches both.

## Tests

```bash
npm test               # runner: unit tests and an end-to-end run of the Game Boy core
npm run test:mod       # mod: the pane, commands, key strip and tools, against a fake runner
npm run validate       # manifests and the hooks module, as Claude Code reads them
npm run typecheck      # after loading the folder once (see above)
```

The runner's Doom test needs Freedoom. Point it at a copy, or let it download one (24 MB):

```bash
COUCH_COOP_TEST_WAD=~/.couch-coop/wads/freedoom1.wad npm test
COUCH_COOP_TEST_DOWNLOAD=1 npm test
```

Try changes by hand too: `npm run dev`, then `/doom` and `/gameboy`, click the strip, play, and ask Claude to take a turn.

## The game engines

`runner/cores/doom.wasm` and `runner/cores/gameboy.wasm` are built from the source in `engines/` with [Zig](https://ziglang.org), which ships a WebAssembly C toolchain. The committed binaries were built with Zig 0.16.0, and the build is reproducible: CI rebuilds them and checks the result against `runner/cores/CHECKSUMS.sha256`.

```bash
brew install zig                      # or: pip install ziglang==0.16.0, then export ZIG="python3 -m ziglang"
npm run build:engines                 # rebuild both
cd runner/cores && shasum -a 256 doom.wasm gameboy.wasm > CHECKSUMS.sha256   # after an intended change
```

The vendored engine source in `engines/*/doomgeneric` and `engines/*/binjgb` stays unmodified; Couch Co-op's changes live in `engines/doom/doomgeneric_arcade.c` and `engines/gameboy/gameboy_arcade.c`. To update a vendored engine, copy the new upstream files over, record the commit in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), rebuild, and run the tests.

`scripts/build-libbet.sh` rebuilds the bundled homebrew ROM from its pinned source.

### Adding a game or an emulator

A core is a worker in `runner/cores/` that loads a `.wasm`, runs the game loop, reads keys with `popKey` and publishes frames with `publishFrame` (see `runner/lib/shared.mjs`). Add its buttons and key map to `runner/lib/games.mjs`, teach `runner/lib/library.mjs` to find its files, and describe its buttons in the press tool and the play skill. Only add cores and bundled games whose licenses allow redistribution, and never commercial game files.

## Style

- JavaScript and TypeScript: ES modules, two-space indent, no semicolons, single quotes (match what is there).
- Names say what things are: `isPaused`, `startGame`, `lastKeyId`.
- Comments explain why, in plain sentences.
- User-facing text is short, plain and friendly. No em dashes anywhere in copy.

## Commits and pull requests

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `feat: add save slots to the Game Boy pane`, `fix(runner): release keys when the game ends`.
- Open an issue first for anything large, so we can agree on the shape.
- Before you open a pull request: `npm test`, `npm run test:mod` and `npm run validate` pass, docs are updated, and `CHANGELOG.md` has a line under *Unreleased*.

By contributing you agree that your work is licensed under the same license as the files you change (MIT for Couch Co-op's own code, GPL-2.0-or-later inside `engines/doom/`).

Please also read the [Code of Conduct](CODE_OF_CONDUCT.md).
