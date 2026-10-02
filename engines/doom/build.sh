#!/usr/bin/env bash
# Builds runner/cores/doom.wasm from the vendored doomgeneric source.
#
# Needs Zig (https://ziglang.org), which ships a WebAssembly C toolchain and
# libc. Any of these works:
#   brew install zig            # macOS
#   pip install ziglang         # anywhere with Python; then ZIG="python3 -m ziglang"
# The committed doom.wasm was built with Zig 0.16.0.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
src="$here/doomgeneric"
out="$root/runner/cores/doom.wasm"

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

# The same object list as doomgeneric's own Makefile, minus sound and any
# windowing backend: doomgeneric_arcade.c is the platform layer here.
objects=(
  dummy am_map doomdef doomstat dstrings d_event d_items d_iwad d_loop d_main d_mode d_net
  f_finale f_wipe g_game hu_lib hu_stuff info i_cdmus i_endoom i_joystick i_scale i_sound
  i_system i_timer memio m_argv m_bbox m_cheat m_config m_controls m_fixed m_menu m_misc
  m_random p_ceilng p_doors p_enemy p_floor p_inter p_lights p_map p_maputl p_mobj p_plats
  p_pspr p_saveg p_setup p_sight p_spec p_switch p_telept p_tick p_user r_bsp r_data r_draw
  r_main r_plane r_segs r_sky r_things sha1 sounds statdump st_lib st_stuff s_sound tables
  v_video wi_stuff w_checksum w_file w_main w_wad z_zone w_file_stdc i_input i_video doomgeneric
)
files=()
for object in "${objects[@]}"; do files+=("$src/$object.c"); done

echo "Building doom.wasm with: ${zig[*]} ($("${zig[@]}" version))"
"${zig[@]}" cc \
  -target wasm32-wasi \
  -O2 -s \
  -I"$src" \
  -DDOOMGENERIC_RESX=320 -DDOOMGENERIC_RESY=200 \
  -D_DEFAULT_SOURCE \
  -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS \
  -lwasi-emulated-signal -lwasi-emulated-process-clocks \
  -Wno-everything \
  "${files[@]}" "$here/doomgeneric_arcade.c" \
  -o "$out"

if command -v shasum >/dev/null 2>&1; then
  sum="$(shasum -a 256 "$out" | cut -d' ' -f1)"
else
  sum="$(sha256sum "$out" | cut -d' ' -f1)"
fi
echo "Wrote $out ($(wc -c <"$out" | tr -d ' ') bytes, sha256 $sum)"
