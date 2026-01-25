/**
 * Auto-generated event constants from PyFLP
 * FL Studio .flp file event IDs and types
 *
 * Event ID ranges:
 * - BYTE (0-63): 1 byte data
 * - WORD (64-127): 2 bytes data
 * - DWORD (128-191): 4 bytes data
 * - TEXT (192-207): Variable length strings (+ some IDs in DATA range)
 * - DATA (208+): Variable length binary data
 */

// Base offsets for event ID ranges
export const BYTE = 0;
export const WORD = 64;
export const DWORD = 128;
export const TEXT = 192;
export const DATA = 208;

// IDs for TEXT events that use UTF-16LE in newer FL versions
export const NEW_TEXT_IDS = [
  TEXT + 49, // ArrangementID.Name
  TEXT + 39, // DisplayGroupID.Name
  TEXT + 47, // TrackID.Name
] as const;

/**
 * Event IDs used by FL Studio project files
 * Based on PyFLP's event definitions
 */
export const EVENT_ID = {
  // === Project IDs (from project.py) ===
  PROJECT_LOOP_ACTIVE: 9,
  PROJECT_SHOW_INFO: 10,
  PROJECT__VOLUME: 12,
  PROJECT_PAN_LAW: 23,
  PROJECT_LICENSED: 28,
  PROJECT__TEMPO_COARSE: WORD + 2, // 66
  PROJECT_PITCH: WORD + 16, // 80
  PROJECT__TEMPO_FINE: WORD + 29, // 93
  PROJECT_CUR_GROUP_ID: DWORD + 18,
  PROJECT_TEMPO: DWORD + 28,
  PROJECT_FL_BUILD: DWORD + 31,
  PROJECT_TITLE: TEXT + 2, // 194
  PROJECT_COMMENTS: TEXT + 3, // 195
  PROJECT_URL: TEXT + 5, // 197
  PROJECT__RTF_COMMENTS: TEXT + 6, // 198
  PROJECT_FL_VERSION: TEXT + 7, // 199
  PROJECT_LICENSEE: TEXT + 8, // 200
  PROJECT_DATA_PATH: TEXT + 10, // 202
  PROJECT_GENRE: TEXT + 14, // 206
  PROJECT_ARTISTS: TEXT + 15, // 207
  PROJECT_TIMESTAMP: DATA + 29, // 237

  // === Channel IDs (from channel.py) ===
  CHANNEL_IS_ENABLED: 0,
  CHANNEL__VOL_BYTE: 2,
  CHANNEL__PAN_BYTE: 3,
  CHANNEL_ZIPPED: 15,
  CHANNEL_PING_PONG_LOOP: 20,
  CHANNEL_TYPE: 21,
  CHANNEL_ROUTED_TO: 22,
  CHANNEL_IS_LOCKED: 32,
  CHANNEL_NEW: WORD,
  CHANNEL_FREQ_TILT: WORD + 5, // 69
  CHANNEL_FX_FLAGS: WORD + 6, // 70
  CHANNEL_CUTOFF: WORD + 7, // 71
  CHANNEL__VOL_WORD: WORD + 8, // 72
  CHANNEL__PAN_WORD: WORD + 9, // 73
  CHANNEL_PREAMP: WORD + 10, // 74
  CHANNEL_FADE_OUT: WORD + 11, // 75
  CHANNEL_FADE_IN: WORD + 12, // 76
  CHANNEL_RESONANCE: WORD + 19, // 83
  CHANNEL_STEREO_DELAY: WORD + 21, // 85
  CHANNEL_POGO: WORD + 22, // 86
  CHANNEL_TIME_SHIFT: WORD + 25, // 89
  CHANNEL_CHILDREN: WORD + 30, // 94
  CHANNEL_SWING: WORD + 33, // 97
  CHANNEL_RING_MOD: DWORD + 3,
  CHANNEL_CUT_GROUP: DWORD + 4,
  CHANNEL_ROOT_NOTE: DWORD + 7,
  CHANNEL_DELAY_MOD_XY: DWORD + 10,
  CHANNEL_REVERB: DWORD + 11,
  CHANNEL__STRETCH_TIME: DWORD + 12,
  CHANNEL_FINE_TUNE: DWORD + 14,
  CHANNEL_SAMPLER_FLAGS: DWORD + 15,
  CHANNEL_LAYER_FLAGS: DWORD + 16,
  CHANNEL_GROUP_NUM: DWORD + 17,
  CHANNEL_AU_SAMPLE_RATE: DWORD + 25,
  CHANNEL__NAME: TEXT,
  CHANNEL_SAMPLE_PATH: TEXT + 4, // 196
  CHANNEL_DELAY: DATA + 1, // 209
  CHANNEL_PARAMETERS: DATA + 7, // 215
  CHANNEL_ENVELOPE_LFO: DATA + 10, // 218
  CHANNEL_LEVELS: DATA + 11, // 219
  CHANNEL_POLYPHONY: DATA + 13, // 221
  CHANNEL_TRACKING: DATA + 20, // 228
  CHANNEL_LEVEL_ADJUSTS: DATA + 21, // 229
  CHANNEL_AUTOMATION: DATA + 26, // 234

  // === Plugin IDs (from plugin.py) ===
  PLUGIN_COLOR: DWORD,
  PLUGIN_ICON: DWORD + 27,
  PLUGIN_INTERNAL_NAME: TEXT + 9, // 201
  PLUGIN_NAME: TEXT + 11, // 203
  PLUGIN_WRAPPER: DATA + 4, // 212
  PLUGIN_DATA: DATA + 5, // 213

  // === Display Group IDs ===
  DISPLAY_GROUP_NAME: TEXT + 39, // 231

  // === Rack IDs ===
  RACK_SWING: 11,
  RACK__FIT_TO_STEPS: 13,
  RACK_WINDOW_HEIGHT: DWORD + 5,

  // === Mixer IDs (from mixer.py) ===
  MIXER_SLOT_INDEX: WORD + 34, // 98
  MIXER_INSERT_ICON: WORD + 31, // 95
  MIXER_INSERT_OUTPUT: DWORD + 19,
  MIXER_INSERT_COLOR: DWORD + 21,
  MIXER_INSERT_INPUT: DWORD + 26,
  MIXER_INSERT_NAME: TEXT + 12, // 204
  MIXER_INSERT_ROUTING: DATA + 27, // 235
  MIXER_INSERT_FLAGS: DATA + 28, // 236
} as const;

/**
 * Event data type classification
 */
export type EventKind =
  | "u8"
  | "i8"
  | "u16"
  | "i16"
  | "u32"
  | "i32"
  | "f32"
  | "text"
  | "data"
  | "unknown";

/**
 * Maps event IDs to their data type
 * Used for proper serialization/deserialization
 */
export const EVENT_KIND: Record<number, EventKind> = {
  // Project events
  [EVENT_ID.PROJECT_LOOP_ACTIVE]: "u8",
  [EVENT_ID.PROJECT_SHOW_INFO]: "u8",
  [EVENT_ID.PROJECT__VOLUME]: "u8",
  [EVENT_ID.PROJECT_PAN_LAW]: "u8",
  [EVENT_ID.PROJECT_LICENSED]: "u8",
  [EVENT_ID.PROJECT__TEMPO_COARSE]: "u16",
  [EVENT_ID.PROJECT_PITCH]: "i16",
  [EVENT_ID.PROJECT__TEMPO_FINE]: "u16",
  [EVENT_ID.PROJECT_CUR_GROUP_ID]: "i32",
  [EVENT_ID.PROJECT_TEMPO]: "u32",
  [EVENT_ID.PROJECT_FL_BUILD]: "u32",
  [EVENT_ID.PROJECT_TITLE]: "text",
  [EVENT_ID.PROJECT_COMMENTS]: "text",
  [EVENT_ID.PROJECT_URL]: "text",
  [EVENT_ID.PROJECT__RTF_COMMENTS]: "text",
  [EVENT_ID.PROJECT_FL_VERSION]: "text",
  [EVENT_ID.PROJECT_LICENSEE]: "text",
  [EVENT_ID.PROJECT_DATA_PATH]: "text",
  [EVENT_ID.PROJECT_GENRE]: "text",
  [EVENT_ID.PROJECT_ARTISTS]: "text",
  [EVENT_ID.PROJECT_TIMESTAMP]: "data",

  // Channel events
  [EVENT_ID.CHANNEL_IS_ENABLED]: "u8",
  [EVENT_ID.CHANNEL__VOL_BYTE]: "u8",
  [EVENT_ID.CHANNEL__PAN_BYTE]: "u8",
  [EVENT_ID.CHANNEL_ZIPPED]: "u8",
  [EVENT_ID.CHANNEL_PING_PONG_LOOP]: "u8",
  [EVENT_ID.CHANNEL_TYPE]: "u8",
  [EVENT_ID.CHANNEL_ROUTED_TO]: "i8",
  [EVENT_ID.CHANNEL_IS_LOCKED]: "u8",
  [EVENT_ID.CHANNEL_NEW]: "u16",
  [EVENT_ID.CHANNEL_FREQ_TILT]: "u16",
  [EVENT_ID.CHANNEL_FX_FLAGS]: "u16",
  [EVENT_ID.CHANNEL_CUTOFF]: "u16",
  [EVENT_ID.CHANNEL__VOL_WORD]: "u16",
  [EVENT_ID.CHANNEL__PAN_WORD]: "u16",
  [EVENT_ID.CHANNEL_PREAMP]: "u16",
  [EVENT_ID.CHANNEL_FADE_OUT]: "u16",
  [EVENT_ID.CHANNEL_FADE_IN]: "u16",
  [EVENT_ID.CHANNEL_RESONANCE]: "u16",
  [EVENT_ID.CHANNEL_STEREO_DELAY]: "u16",
  [EVENT_ID.CHANNEL_POGO]: "u16",
  [EVENT_ID.CHANNEL_TIME_SHIFT]: "u16",
  [EVENT_ID.CHANNEL_CHILDREN]: "u16",
  [EVENT_ID.CHANNEL_SWING]: "u16",
  [EVENT_ID.CHANNEL_RING_MOD]: "u32",
  [EVENT_ID.CHANNEL_CUT_GROUP]: "u32",
  [EVENT_ID.CHANNEL_ROOT_NOTE]: "u32",
  [EVENT_ID.CHANNEL_DELAY_MOD_XY]: "u32",
  [EVENT_ID.CHANNEL_REVERB]: "u32",
  [EVENT_ID.CHANNEL__STRETCH_TIME]: "f32",
  [EVENT_ID.CHANNEL_FINE_TUNE]: "i32",
  [EVENT_ID.CHANNEL_SAMPLER_FLAGS]: "u32",
  [EVENT_ID.CHANNEL_LAYER_FLAGS]: "u32",
  [EVENT_ID.CHANNEL_GROUP_NUM]: "i32",
  [EVENT_ID.CHANNEL_AU_SAMPLE_RATE]: "u32",
  [EVENT_ID.CHANNEL__NAME]: "text",
  [EVENT_ID.CHANNEL_SAMPLE_PATH]: "text",
  [EVENT_ID.CHANNEL_DELAY]: "data",
  [EVENT_ID.CHANNEL_PARAMETERS]: "data",
  [EVENT_ID.CHANNEL_ENVELOPE_LFO]: "data",
  [EVENT_ID.CHANNEL_LEVELS]: "data",
  [EVENT_ID.CHANNEL_POLYPHONY]: "data",
  [EVENT_ID.CHANNEL_TRACKING]: "data",
  [EVENT_ID.CHANNEL_LEVEL_ADJUSTS]: "data",
  [EVENT_ID.CHANNEL_AUTOMATION]: "data",

  // Plugin events
  [EVENT_ID.PLUGIN_COLOR]: "u32",
  [EVENT_ID.PLUGIN_ICON]: "u32",
  [EVENT_ID.PLUGIN_INTERNAL_NAME]: "text",
  [EVENT_ID.PLUGIN_NAME]: "text",
  [EVENT_ID.PLUGIN_WRAPPER]: "data",
  [EVENT_ID.PLUGIN_DATA]: "data",

  // Display Group events
  [EVENT_ID.DISPLAY_GROUP_NAME]: "data",

  // Rack events
  [EVENT_ID.RACK_SWING]: "u8",
  [EVENT_ID.RACK__FIT_TO_STEPS]: "u8",
  [EVENT_ID.RACK_WINDOW_HEIGHT]: "u32",

  // Mixer events
  [EVENT_ID.MIXER_SLOT_INDEX]: "u16",
  [EVENT_ID.MIXER_INSERT_ICON]: "i16",
  [EVENT_ID.MIXER_INSERT_OUTPUT]: "i32",
  [EVENT_ID.MIXER_INSERT_COLOR]: "u32",
  [EVENT_ID.MIXER_INSERT_INPUT]: "i32",
  [EVENT_ID.MIXER_INSERT_NAME]: "text",
  [EVENT_ID.MIXER_INSERT_ROUTING]: "data",
  [EVENT_ID.MIXER_INSERT_FLAGS]: "data",

};

/**
 * Determines the event kind based on ID
 * Falls back to range-based detection if not explicitly mapped
 */
export function getEventKind(eventId: number): EventKind {
  // Check explicit mapping first
  const mapped = EVENT_KIND[eventId];
  if (mapped !== undefined) {
    return mapped;
  }

  // Fall back to range-based detection
  if (eventId < WORD) {
    return "u8";
  } else if (eventId < DWORD) {
    return "u16";
  } else if (eventId < TEXT) {
    return "u32";
  } else if (eventId < DATA || NEW_TEXT_IDS.includes(eventId as 241 | 231 | 239)) {
    return "text";
  } else {
    return "data";
  }
}

/**
 * Returns the fixed size for BYTE/WORD/DWORD events
 * Returns -1 for variable-length events (TEXT/DATA)
 */
export function getEventFixedSize(eventId: number): number {
  if (eventId < WORD) {
    return 1;
  } else if (eventId < DWORD) {
    return 2;
  } else if (eventId < TEXT) {
    return 4;
  }
  return -1; // Variable length
}
