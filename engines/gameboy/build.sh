#!/usr/bin/env bash
# Builds runner/cores/gameboy.wasm from the vendored binjgb core.
#
# Needs Zig (https://ziglang.org): brew install zig, or pip install ziglang
# (then ZIG="python3 -m ziglang"). The committed gameboy.wasm was built with
# Zig 0.16.0.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
src="$here/binjgb"
out="$root/runner/cores/gameboy.wasm"

if [[ -n "${ZIG:-}" ]]; then
  read -r -a zig <<<"$ZIG"
elif command -v zig >/dev/null 2>&1; then
  zig=(zig)
elif python3 -c 'import ziglang' >/dev/null 2>&1; then
  zig=(python3 -m ziglang)
else
  echo "Zig not found. Install it (brew install zig, or pip install ziglang) and run again." >&2
  exit 1
fi

echo "Building gameboy.wasm with: ${zig[*]} ($("${zig[@]}" version))"
# A reactor module: no main(); the runner's worker calls the gb_* exports.
"${zig[@]}" cc \
  -target wasm32-wasi \
  -mexec-model=reactor \
  -O2 -s \
  -I"$src" \
  -DNDEBUG \
  -Wno-everything \
  "$src/emulator.c" "$src/common.c" "$src/memory.c" "$here/gameboy_arcade.c" \
  -o "$out"

if command -v shasum >/dev/null 2>&1; then
  sum="$(shasum -a 256 "$out" | cut -d' ' -f1)"
else
  sum="$(sha256sum "$out" | cut -d' ' -f1)"
fi
echo "Wrote $out ($(wc -c <"$out" | tr -d ' ') bytes, sha256 $sum)"
