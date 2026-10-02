---
name: play
description: Play the game open in the Couch Co-op arcade pane (Doom, or a Game Boy game such as Pokemon) using the look and press tools. Use when the person asks Claude to play, take a turn, help with a level, or play co-op in Couch Co-op, /arcade, /doom or /gameboy.
---

# Playing on the couch

The person opened a game in the Couch Co-op pane and wants you to play it, alone or alongside them. You have two tools (if they show as deferred, load both with ToolSearch first):

- `mcp__couch-coop__look`: the screen as an image, plus a line about the state of play.
- `mcp__couch-coop__press`: hold buttons for set times, step by step, then get the new screen.

## The loop

1. `look` once to see where things stand. Read the text line too: for Doom it says whether the menu is open, the level, health, ammo, and if you died.
2. Decide on a short plan: one to six steps that get you somewhere visible (through a door, to the next textbox, around a corner).
3. `press` with those steps and a `say` line. Then study the image it returns before the next move.
4. Repeat. When the person is not playing, the game pauses between your calls, so think as long as you need. If they are playing too, it runs in real time: keep moves short.

Play in bursts of about 25 presses, then stop and tell the person in a sentence or two what happened and ask if you should keep going. Each press sends a screenshot, so endless play spends their usage. Stop right away if they say so, or if `press` is refused because they benched you: say you are watching, and hand back.

## Narration

`say` shows under the game for the person watching. Keep it under ten words, in the moment, a little playful: "Door on the left looks promising", "Imp! Backing up and firing", "Talking to Mom before we head out". No long commentary in your replies while playing; the game is the show.

## Steps

A step is `{ "buttons": [...], "ms": 30-3000 }`. Buttons in one step are held together; `[]` waits. Some patterns:

- Tap: `{ "buttons": ["a"], "ms": 120 }`. Menus and text want taps, not holds.
- Walk: `{ "buttons": ["forward"], "ms": 600 }`. Longer holds go further.
- Turn about 90 degrees in Doom: `{ "buttons": ["turn_left"], "ms": 500 }` with run on (the default); about 180 ms for a small correction. Adjust after looking.
- Fight while moving: `{ "buttons": ["forward", "fire"], "ms": 400 }`.

## Doom

Buttons: forward, back, turn_left, turn_right, strafe_left, strafe_right, fire, use, run, map, menu, enter, back_menu, yes, no, pause, weapon_1 to weapon_7. Run is held on from the start.

- From the title screen: `menu`, then `enter` (New Game), `enter` (episode), `enter` (skill). Each as its own tap step with a short wait between.
- Doors and switches: walk up to them, then tap `use`.
- Dead: tap `use` to restart the level.
- Level done (tally screen): tap `use` or `enter`.
- If you are stuck, `map` shows the automap; tap it again to close it.
- To save (only when the person asks): `menu`, `back` three times to reach Save Game, `enter`, pick a slot with `forward`/`back` and `enter`, then a step `{ "text": "coop" }` and `enter`.
- Keep enemies in the middle of the screen before firing; strafe to dodge.

## Game Boy (Pokemon and others)

Buttons: up, down, left, right, a, b, start, select.

- One grid step in Pokemon is about a 270 ms hold of a direction; a quick tap only turns to face that way.
- Advance text with `a` taps (120 ms) and a short wait (300 ms) between them.
- `start` opens the menu, `b` backs out of almost anything.
- In battles, read the menu on screen before choosing. Prefer moves with type advantage, and heal before a Pokemon faints.
- Save in-game from the menu when the person asks; the cartridge save is kept on disk automatically.

## Co-op manners

- If the person is moving too, do not fight them for the same buttons. Take a role they ask for (aim and fire while they move, read the map, handle menus).
- Ask before anything hard to undo in their game: overwriting a save, releasing a Pokemon, spending rare items.
- Never claim you did something the screen does not show. If a press did not do what you expected, say so and adjust.
