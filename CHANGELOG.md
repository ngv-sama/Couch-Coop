# Changelog

All notable changes to Couch Co-op are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-02

### Added

- `/arcade`, `/doom` and `/gameboy`: a pane in Claude Code that plays games, with a launcher listing every game you can play.
- Doom: the doomgeneric engine built to WebAssembly, with Freedoom: Phase 1 downloaded and checksum-checked on first play. Your own WADs in `~/.couch-coop/wads` show up too.
- Game Boy and Game Boy Color: the binjgb emulator built to WebAssembly, the homebrew game *Libbet and the Magic Floor* bundled, and your own ROMs from `~/.couch-coop/roms`. Battery saves are kept on disk; save states with one button.
- A key strip under the game that takes the keyboard on a click and gives it back on Esc, with hold timing tuned for terminals that report no key releases.
- Co-op with Claude: `look` and `press` tools, a `couch-coop:play` skill, narration under the game, a button to let Claude play, and a bench toggle. The game pauses between Claude's moves while you are not playing.
- Doom's state of play (level, health, ammo, menus, death) described in words for Claude, and typed save names.
- Pictures as colored half-block cells in any truecolor terminal, or real pixels in kitty and Ghostty.
- Settings in `/config`: Node.js path, ROMs folder, picture mode and frame rate.

[Unreleased]: https://github.com/ngv-sama/couch-coop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ngv-sama/couch-coop/releases/tag/v0.1.0
