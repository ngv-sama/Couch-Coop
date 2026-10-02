#!/usr/bin/env bash
# Rebuilds runner/roms/libbet.gb, the bundled homebrew Game Boy game, from
# its source at a pinned commit, so anyone can check the bundled ROM.
#
# Needs git, make, Python 3 with Pillow (pip install pillow) and RGBDS 0.9.x
# (brew install rgbds, or https://rgbds.gbdev.io/install).
set -euo pipefail

commit=1232e71dc1ac852786ad9825316e19d2b341bc4a
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git clone --quiet https://github.com/pinobatch/libbet.git "$work/libbet"
git -C "$work/libbet" checkout --quiet "$commit"
make -C "$work/libbet" libbet.gb
cp "$work/libbet/libbet.gb" "$root/runner/roms/libbet.gb"
cp "$work/libbet/LICENSE" "$root/runner/roms/LIBBET-LICENSE.txt"
echo "Wrote runner/roms/libbet.gb"
