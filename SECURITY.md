# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue: use GitHub's **Report a vulnerability** button on this repository's Security tab. Include what you found, how to reproduce it, and the versions of Couch Co-op, Claude Code and Node.js. You should hear back within a week. Fixes are released as soon as they are ready and credited to you unless you prefer otherwise.

## What Couch Co-op can touch

Mods run inside Claude Code with the same access to your machine as Claude Code itself; they are not sandboxed. Only install plugins you trust. Here is what this one does:

- **Starts one local process**, the runner (`node runner/main.mjs`), when you open the arcade. It exits when you close Claude Code, or after a minute with no requests.
- **Listens only on a Unix socket** in a private folder created for it (`mkdtemp`, permissions `0700`; the socket itself `0600`). Every request must carry a random token the runner prints for the mod at start. It opens no network port.
- **Reads and writes files** under `~/.couch-coop` (games, saves), the ROMs folder you configure, and its private run folder in the system's temporary directory. Game engines run as WebAssembly with access to only their game file and save folder.
- **Makes one network request**: downloading Freedoom from its GitHub release on first play, checked against a pinned SHA-256 sum before use.
- **Gives Claude two tools**, `look` and `press`, which only show the game screen and press game buttons. You can bench Claude from the pane at any time, and Claude Code asks your permission before Claude first uses them.

## Supported versions

Security fixes go into the latest release. Please update before reporting.
