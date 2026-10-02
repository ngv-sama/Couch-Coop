// What the game is doing, in words, for Claude.
//
// Doom's engine publishes a few numbers every frame (doomgeneric_arcade.c):
// the game state, whether the menu or map is open, and the player's health,
// armor, weapon and ammo. Turned into a sentence, they tell Claude what the
// picture alone can leave unclear, like "the menu is open" or "you are dead".

const DOOM_FIELDS = ['gamestate', 'menu', 'paused', 'automap', 'demo', 'episode', 'map', 'playerstate', 'health', 'armor', 'weapon', 'ammo', 'kills', 'totalKills', 'typingSaveName']
const DOOM_WEAPONS = ['fist', 'pistol', 'shotgun', 'chaingun', 'rocket launcher', 'plasma rifle', 'BFG 9000', 'chainsaw', 'super shotgun']
const GS_LEVEL = 0
const GS_INTERMISSION = 1
const GS_FINALE = 2
const GS_DEMOSCREEN = 3
const PST_DEAD = 1

/** Doom's status numbers as named fields, or null before the first frame. */
export function doomStatus(fields) {
  if (!fields || fields.length < DOOM_FIELDS.length) return null
  return Object.fromEntries(DOOM_FIELDS.map((name, i) => [name, fields[i]]))
}

/** One or two sentences about where Doom is and what to press next. */
export function describeDoom(fields) {
  const s = doomStatus(fields)
  if (!s) return 'Doom is starting.'
  if (s.typingSaveName) return 'The save menu is waiting for a save name: type it with a text step, then tap enter.'
  if (s.menu) return 'The Doom menu is open: up and down (forward/back) move the skull, enter picks, back_menu goes back, menu closes it.'
  if (s.gamestate === GS_DEMOSCREEN || s.demo) {
    return 'No game is running: this is the title screen or a recorded attract demo, so nothing you press moves anyone yet. ' +
      'To start: tap menu, then enter (New Game), enter (episode), enter (skill), each as its own step.'
  }
  if (s.gamestate === GS_INTERMISSION) return 'Level complete: the tally screen is up. Press use or enter to go on to the next level.'
  if (s.gamestate === GS_FINALE) return 'The episode is over and the ending is showing. Press enter to continue.'
  if (s.gamestate !== GS_LEVEL) return 'Doom is between screens.'
  const where = `E${s.episode}M${s.map}`
  if (s.playerstate === PST_DEAD) return `You died in ${where}. Press use to restart the level.`
  const weapon = DOOM_WEAPONS[s.weapon] ?? 'weapon'
  const ammo = s.ammo >= 0 ? `, ${s.ammo} ammo` : ''
  const extras = [s.automap ? 'the automap is open (press map to close it)' : '', s.paused ? 'the game is paused (press pause)' : ''].filter(Boolean)
  return `In ${where}: health ${s.health}%, armor ${s.armor}%, ${weapon}${ammo}, kills ${s.kills}/${s.totalKills}.${extras.length ? ` Note: ${extras.join('; ')}.` : ''}`
}

/** True while Doom waits for typed text (a save name), so keys should type, not play. */
export function isTyping(gameId, fields) {
  return gameId === 'doom' && doomStatus(fields)?.typingSaveName === 1
}

/** A sentence for any game; Game Boy games publish no status. */
export function describeStatus(gameId, fields) {
  if (gameId === 'doom') return describeDoom(fields)
  return ''
}
