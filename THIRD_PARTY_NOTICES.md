# Third-party notices

Couch Co-op's own code is under the MIT License (see [LICENSE](LICENSE)). This repository also contains, or downloads at run time, the work of others. Each part keeps its own license, listed here with where it lives and what was changed.

## Doom engine: doomgeneric

- **What:** The Doom game engine, as adapted for easy porting by doomgeneric, itself based on Chocolate Doom and id Software's original source release.
- **Where:** `engines/doom/doomgeneric/` (source), `runner/cores/doom.wasm` (built from that source).
- **Source:** https://github.com/ozkl/doomgeneric, commit `dcb7a8dbc7a16ce3dda29382ac9aae9d77d21284`.
- **Copyright:** id Software, Inc. (1993-1996), Simon Howard and the Chocolate Doom authors (2005-2014), ozkl and doomgeneric contributors.
- **License:** GNU General Public License, version 2 or (at your option) any later version. Full text: [`engines/doom/doomgeneric/LICENSE`](engines/doom/doomgeneric/LICENSE).
- **Changes:** The other platform back ends (SDL, X11, Windows, Allegro, Emscripten and others) were left out. Couch Co-op adds its own platform layer, [`engines/doom/doomgeneric_arcade.c`](engines/doom/doomgeneric_arcade.c), under the same license. The engine's files are otherwise unmodified.
- **Building it yourself:** [`engines/doom/build.sh`](engines/doom/build.sh) builds `doom.wasm` from this source with Zig. Because the source ships with the binary, the GPL's source requirement is met by this repository.

The parts of Couch Co-op that run Doom (the runner) are MIT-licensed, which is compatible with the GPL; when they run together, the combination is distributed under the GPL's terms.

## Freedoom

- **What:** Free game data (levels, graphics, sounds) for the Doom engine: Freedoom: Phase 1, version 0.13.0.
- **Where:** Not in this repository. Downloaded on first play from the Freedoom project's GitHub release, checked against a pinned SHA-256 sum, and saved to `~/.couch-coop/wads/freedoom1.wad` with its license as `FREEDOOM-COPYING.txt`.
- **Source:** https://freedoom.github.io, https://github.com/freedoom/freedoom/releases/tag/v0.13.0
- **Copyright:** Contributors to the Freedoom project, 2001-2024.
- **License:** BSD-3-Clause (the license text is in the downloaded archive's `COPYING.txt`, which Couch Co-op saves beside the WAD).

## Game Boy emulator: binjgb

- **What:** A Game Boy and Game Boy Color emulator core.
- **Where:** `engines/gameboy/binjgb/` (the core's source files), `runner/cores/gameboy.wasm` (built from them).
- **Source:** https://github.com/binji/binjgb, commit `16621111ed0ee73bcc45c912a823bcebedcffc0f`.
- **Copyright:** Ben Smith, 2016-2017.
- **License:** MIT. Full text: [`engines/gameboy/binjgb/LICENSE`](engines/gameboy/binjgb/LICENSE).
- **Changes:** Only the emulator core files are included (`emulator.c`, `common.c`, `memory.c` and their headers, `builtin-palettes.def`), unmodified. Couch Co-op adds [`engines/gameboy/gameboy_arcade.c`](engines/gameboy/gameboy_arcade.c) (MIT) to expose the core to the runner.

## Libbet and the Magic Floor

- **What:** A homebrew Game Boy game, bundled so the Game Boy side works out of the box.
- **Where:** `runner/roms/libbet.gb`.
- **Source:** https://github.com/pinobatch/libbet, commit `1232e71dc1ac852786ad9825316e19d2b341bc4a`, built with RGBDS 0.9.4 by [`scripts/build-libbet.sh`](scripts/build-libbet.sh). The ROM is unmodified.
- **Copyright:** Damian Yerrick, 2014-2020.
- **License:** Zlib. Full text: [`runner/roms/LIBBET-LICENSE.txt`](runner/roms/LIBBET-LICENSE.txt).

## Trademarks

DOOM is a trademark of ZeniMax Media Inc. Game Boy and Pokemon are trademarks of Nintendo. Claude is a trademark of Anthropic. Couch Co-op is not affiliated with or endorsed by any of them. No commercial game data is included or downloaded; games people add themselves are theirs to own.
