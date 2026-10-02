// Game Boy platform layer for Couch Co-op, around the binjgb emulator core.
//
// Built as a WebAssembly "reactor": no main loop here. The runner's worker
// thread (runner/cores/gameboy-worker.mjs) loads the ROM, then calls
// gb_run_frame about sixty times a second, sets the buttons, and reads the
// frame buffer, battery saves and save states through the exports below.
//
// Copyright (C) 2026 Nikhil Guru Venkatesh. MIT license (see LICENSE).

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "emulator.h"

#define EXPORT(name) __attribute__((export_name(name)))

static Emulator *emulator;
static EmulatorInit init;
static JoypadButtons buttons;
static Ticks target_ticks;
static FileData ext_ram;
static FileData state;

static void read_buttons(JoypadButtons *joypad, void *user_data) {
  (void)user_data;
  *joypad = buttons;
}

// Memory the host fills before a call: the ROM, a battery save, a save state.
EXPORT("gb_alloc") void *gb_alloc(size_t size) { return calloc(1, size); }

// Starts the emulator on a ROM already copied into memory. 1 on success.
EXPORT("gb_create") int gb_create(void *rom, size_t size) {
  init.rom.data = rom;
  init.rom.size = size;
  // Sound is not played; the core still wants a buffer to fill.
  init.audio_frequency = 44100;
  init.audio_frames = 4096;
  init.random_seed = 0xcabba6e5;
  init.cgb_color_curve = CGB_COLOR_CURVE_SAMEBOY_EMULATE_HARDWARE;
  emulator = emulator_new(&init);
  if (!emulator) return 0;
  emulator_set_joypad_callback(emulator, read_buttons, NULL);
  emulator_init_ext_ram_file_data(emulator, &ext_ram);
  memset(ext_ram.data, 0, ext_ram.size);
  emulator_init_state_file_data(&state);
  target_ticks = emulator_get_ticks(emulator);
  return 1;
}

// Bit 0 right, 1 left, 2 up, 3 down, 4 A, 5 B, 6 select, 7 start.
EXPORT("gb_set_buttons") void gb_set_buttons(uint32_t mask) {
  buttons.right = (mask >> 0) & 1;
  buttons.left = (mask >> 1) & 1;
  buttons.up = (mask >> 2) & 1;
  buttons.down = (mask >> 3) & 1;
  buttons.A = (mask >> 4) & 1;
  buttons.B = (mask >> 5) & 1;
  buttons.select = (mask >> 6) & 1;
  buttons.start = (mask >> 7) & 1;
}

// Runs one frame's worth of machine time (70224 CPU ticks, about 16.7 ms).
EXPORT("gb_run_frame") void gb_run_frame(void) {
  target_ticks += PPU_FRAME_TICKS;
  while (emulator_get_ticks(emulator) < target_ticks) {
    EmulatorEvent event = emulator_run_until(emulator, target_ticks);
    if (event & EMULATOR_EVENT_INVALID_OPCODE) break;
  }
}

// The 160x144 picture, RGBA bytes.
EXPORT("gb_frame") void *gb_frame(void) { return *emulator_get_frame_buffer(emulator); }

// Battery-backed cartridge RAM (where games like Pokemon keep their saves).
EXPORT("gb_save_ptr") void *gb_save_ptr(void) { return ext_ram.data; }
EXPORT("gb_save_size") size_t gb_save_size(void) { return ext_ram.size; }
// 1 if the game wrote to its save RAM since the last call.
EXPORT("gb_save_changed") int gb_save_changed(void) { return emulator_was_ext_ram_updated(emulator); }
// Copies save RAM out to gb_save_ptr. 1 on success.
EXPORT("gb_save_read") int gb_save_read(void) { return emulator_write_ext_ram(emulator, &ext_ram) == OK; }
// Loads gb_save_ptr's bytes into save RAM. 1 on success.
EXPORT("gb_save_load") int gb_save_load(void) { return emulator_read_ext_ram(emulator, &ext_ram) == OK; }

// A whole-machine snapshot (save state).
EXPORT("gb_state_ptr") void *gb_state_ptr(void) { return state.data; }
EXPORT("gb_state_size") size_t gb_state_size(void) { return state.size; }
EXPORT("gb_state_write") int gb_state_write(void) { return emulator_write_state(emulator, &state) == OK; }
EXPORT("gb_state_read") int gb_state_read(void) {
  if (emulator_read_state(emulator, &state) != OK) return 0;
  target_ticks = emulator_get_ticks(emulator);
  return 1;
}
