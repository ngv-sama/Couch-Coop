// doomgeneric platform layer for Couch Co-op.
//
// doomgeneric (https://github.com/ozkl/doomgeneric) asks each platform for six
// functions: set up, draw a frame, sleep, read the clock, read a key, set a
// title. Here each one is a WebAssembly import that the runner's worker thread
// (runner/cores/doom-worker.mjs) provides, so this file builds for wasm32-wasi
// with no windowing or sound library.
//
// Copyright (C) 2026 Nikhil Guru Venkatesh.
// Part of the Doom engine build, so it is distributed under the GNU General
// Public License, version 2 or later, like the rest of engines/doom.

#include <stdint.h>
#include "doomgeneric.h"
#include "doomstat.h"
#include "d_items.h"

// From m_menu.c: 1 while the save menu waits for a typed save name.
extern int saveStringEnter;

#define IMPORT(name) __attribute__((import_module("arcade"), import_name(name)))

// Copies the finished 32-bit frame (0x00RRGGBB per pixel) to the runner.
IMPORT("draw_frame") extern void host_draw_frame(const uint32_t *pixels, int width, int height);
// Sleeps without burning CPU; the runner can wake it early.
IMPORT("sleep_ms") extern void host_sleep_ms(uint32_t ms);
// Milliseconds since the game started, with paused time left out.
IMPORT("ticks_ms") extern uint32_t host_ticks_ms(void);
// The next key event as (pressed << 8) | doom_key, or -1 when none is queued.
IMPORT("get_key") extern int host_get_key(void);
// The game's window title (the loaded game's name).
IMPORT("set_title") extern void host_set_title(const char *title);
// What is on screen, as numbers, so Claude can read the state of play
// (runner/lib/status.mjs reads them in this order).
IMPORT("status") extern void host_status(const int32_t *fields, int count);

enum { STATUS_COUNT = 15 };
static int32_t status_fields[STATUS_COUNT];

static void publish_status(void) {
  const player_t *player = &players[consoleplayer];
  int ammo_type = weaponinfo[player->readyweapon].ammo;
  status_fields[0] = gamestate;
  status_fields[1] = menuactive;
  status_fields[2] = paused;
  status_fields[3] = automapactive;
  status_fields[4] = demoplayback;
  status_fields[5] = gameepisode;
  status_fields[6] = gamemap;
  status_fields[7] = player->playerstate;
  status_fields[8] = player->health;
  status_fields[9] = player->armorpoints;
  status_fields[10] = player->readyweapon;
  status_fields[11] = ammo_type < NUMAMMO ? player->ammo[ammo_type] : -1;
  status_fields[12] = player->killcount;
  status_fields[13] = totalkills;
  status_fields[14] = saveStringEnter;
  host_status(status_fields, STATUS_COUNT);
}

void DG_Init(void) {}

void DG_DrawFrame(void) {
  publish_status();
  host_draw_frame(DG_ScreenBuffer, DOOMGENERIC_RESX, DOOMGENERIC_RESY);
}

void DG_SleepMs(uint32_t ms) { host_sleep_ms(ms); }

uint32_t DG_GetTicksMs(void) { return host_ticks_ms(); }

int DG_GetKey(int *pressed, unsigned char *key) {
  int value = host_get_key();
  if (value < 0) return 0;
  *pressed = (value >> 8) & 1;
  *key = (unsigned char)(value & 0xff);
  return 1;
}

void DG_SetWindowTitle(const char *title) { host_set_title(title); }

// WASI has no shell. i_system.c only calls this to look for a desktop error
// dialog tool, so "not available" is the right answer.
int system(const char *command) {
  (void)command;
  return -1;
}

int main(int argc, char **argv) {
  doomgeneric_Create(argc, argv);
  for (;;) doomgeneric_Tick();
  return 0;
}
