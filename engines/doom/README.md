# Doom engine

The Doom engine Couch Co-op runs, compiled to WebAssembly as `runner/cores/doom.wasm`.

- `doomgeneric/`: [doomgeneric](https://github.com/ozkl/doomgeneric) at commit `dcb7a8dbc7a16ce3dda29382ac9aae9d77d21284`, unmodified, with the other platform back ends (SDL, X11, Windows and so on) left out. GPL-2.0-or-later, see `doomgeneric/LICENSE`.
- `doomgeneric_arcade.c`: Couch Co-op's platform layer. doomgeneric asks each port for six functions (draw a frame, sleep, read the clock, read a key, set the title, start up); here each is a WebAssembly import that `runner/cores/doom-worker.mjs` provides. It also publishes a few status numbers each frame so Claude can read the state of play. Same license as the engine.
- `build.sh`: builds `doom.wasm` with Zig (`brew install zig`, or `pip install ziglang==0.16.0`). The build is reproducible; `runner/cores/CHECKSUMS.sha256` records the result.
