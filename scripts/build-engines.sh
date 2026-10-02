#!/usr/bin/env bash
# Rebuilds both game engines (runner/cores/*.wasm) from source with Zig.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$here/../engines/doom/build.sh"
"$here/../engines/gameboy/build.sh"
