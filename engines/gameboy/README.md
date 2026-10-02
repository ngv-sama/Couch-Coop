# Game Boy emulator

The Game Boy and Game Boy Color emulator Couch Co-op runs, compiled to WebAssembly as `runner/cores/gameboy.wasm`.

- `binjgb/`: the emulator core from [binjgb](https://github.com/binji/binjgb) at commit `16621111ed0ee73bcc45c912a823bcebedcffc0f` (`emulator.c`, `common.c`, `memory.c`, their headers and `builtin-palettes.def`), unmodified. MIT, see `binjgb/LICENSE`.
- `gameboy_arcade.c`: Couch Co-op's wrapper. It builds as a WebAssembly reactor (no main loop) and exports what `runner/cores/gameboy-worker.mjs` needs: load a ROM, set the buttons, run one frame, read the picture, and read or write battery saves and save states. MIT.
- `build.sh`: builds `gameboy.wasm` with Zig (`brew install zig`, or `pip install ziglang==0.16.0`). The build is reproducible; `runner/cores/CHECKSUMS.sha256` records the result.
