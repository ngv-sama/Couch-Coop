# Publishing Couch Co-op

Steps to put this repository on GitHub, cut a release, and get it into people's hands.

## 1. Fill in the placeholders

These spots say `ngv-sama` or `YOUR-CONTACT-EMAIL`. Replace them all at once from the repository root (macOS `sed`):

```bash
grep -rl 'ngv-sama\|YOUR-CONTACT-EMAIL' --exclude-dir=node_modules --exclude-dir=engines . \
  | xargs sed -i '' -e 's/ngv-sama/your-handle/g' -e 's/YOUR-CONTACT-EMAIL/you@example.com/g'
grep -rn 'YOUR-' --exclude-dir=node_modules --exclude-dir=engines .   # should print nothing
```

On Linux, use `sed -i` without the `''`.

## 2. Create the repository

```bash
git init -b main
git add .
git commit -m "feat: Couch Co-op 0.1.0"
gh repo create your-handle/couch-coop --public --source . --push
```

Or create an empty public repository named `couch-coop` on github.com and push to it.

## 3. Turn on the GitHub features the repo expects

- **Actions**: on by default. The CI workflow runs the tests on every push and pull request, on macOS and Linux.
- **Private vulnerability reporting**: Settings, Code security, *Private vulnerability reporting*. SECURITY.md points reporters there.
- **Topics** (About, the gear icon): `claude-code`, `claude-code-plugin`, `claude-code-mod`, `doom`, `game-boy`, `emulator`.
- **Social preview** (Settings, General): `docs/images/claude-plays.png` works well.
- **Screenshots**: the images in `docs/images/` were captured from a test terminal while building. Swap in captures from your own terminal before launch; keep the same file names and the README picks them up.

## 4. Check the install path works

In a fresh Claude Code session (not the one you develop in):

```text
/plugin marketplace add your-handle/couch-coop
/plugin install couch-coop@couch-coop
```

Then `/reload-plugins`, `/doom`, click the strip, play a little, and ask Claude to take a turn.

## 5. Tag a release

```bash
git tag -a v0.1.0 -m "Couch Co-op 0.1.0"
git push origin v0.1.0
awk '/^## \[0.1.0\]/{f=1;next} /^## \[|^\[/{f=0} f' CHANGELOG.md > /tmp/notes.md
gh release create v0.1.0 --title "Couch Co-op 0.1.0" --notes-file /tmp/notes.md
```

For later releases: add the changes under *Unreleased* in `CHANGELOG.md` as you go, then bump `version` in `.claude-plugin/plugin.json` and `package.json`, move *Unreleased* to the new version, commit, tag and release. Claude Code keeps people on the version in `plugin.json` until it changes, so bumping it is what delivers an update.

## 6. Share it

- The [Claude directory](https://claude.ai/directory) takes plugin submissions through Anthropic's developer portal, which tracks review and shows usage once a plugin is listed.
- A short screen recording sells it best: `/doom`, the click, a few seconds of play, then *"take a turn"* and Claude playing with its narration under the game.
- Credit the projects it stands on (Freedoom, doomgeneric, binjgb, Libbet) when you post; their authors like hearing about it.

## Before every release

```bash
npm test && npm run test:mod && npm run validate
COUCH_COOP_TEST_DOWNLOAD=1 npm test        # includes the Doom end-to-end test
npm run check:engines                       # committed engines match their checksums
```
