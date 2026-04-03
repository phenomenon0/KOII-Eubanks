// ────────────────────────────────────────────────────────────
// KO Workbench — EP-133 Protocol Types
// Reverse-engineered from garrettjwilke/ep_133_sample_tool
// ────────────────────────────────────────────────────────────

// TE SysEx framing constants
export const MIDI_SYSEX_START    = 0xF0  // 240
export const MIDI_SYSEX_END      = 0xF7  // 247
export const MIDI_SYSEX_TE       = 0x40  // 64  — byte[5]
export const TE_MIDI_ID_0        = 0x00
export const TE_MIDI_ID_1        = 0x20  // 32
export const TE_MIDI_ID_2        = 0x76  // 118

export const BIT_IS_REQUEST              = 0x40  // 64
export const BIT_REQUEST_ID_AVAILABLE    = 0x20  // 32

// Top-level command codes
export const TE_CMD = {
  GREET:            1,
  ECHO:             2,
  DFU:              3,
  PRODUCT_SPECIFIC: 127,
  FILE:             5,   // file-system sub-system
} as const

// Status codes
export const TE_STATUS = {
  OK:                   0,
  ERROR:                1,
  COMMAND_NOT_FOUND:    2,
  BAD_REQUEST:          3,
  SPECIFIC_ERROR_START: 16,
  SPECIFIC_ERROR_END:   63,
  SPECIFIC_SUCCESS_START: 64,
} as const

// File sub-commands
export const TE_FILE = {
  INIT:           1,
  PUT:            2,
  GET:            3,
  LIST:           4,
  PLAYBACK:       5,
  DELETE:         6,
  METADATA:       7,
  INFO:           11,
  MOVED:          12,
} as const

// File sub-command types
export const TE_FILE_PUT    = { INIT: 0, DATA: 1 } as const
export const TE_FILE_GET    = { INIT: 0, DATA: 1 } as const
export const TE_FILE_META   = { SET: 1, GET: 2, SET_PAGED: 4 } as const
export const TE_FILE_META_PAGED = { INIT: 0, DATA: 1 } as const

export const TE_FILE_TYPE   = { FILE: 1, DIR: 2 } as const
export const TE_FILE_CAP    = {
  READ:     4,
  WRITE:    8,
  DELETE:   16,
  MOVE:     32,
  PLAYBACK: 64,
} as const

export const TE_PLAYBACK    = { START: 1, STOP: 2 } as const

// Audio
export const DEVICE_SAMPLE_RATE = 46875
export const DEVICE_AUDIO_FORMAT = 's16' as const
export const MAX_SAMPLE_LENGTH_SECS = 20

// Banks (10 groups)
export const BANKS = [
  { id: 0, name: 'KICK' },
  { id: 1, name: 'SNARE' },
  { id: 2, name: 'CYMB' },
  { id: 3, name: 'PERC' },
  { id: 4, name: 'BASS' },
  { id: 5, name: 'MELOD' },
  { id: 6, name: 'LOOP' },
  { id: 7, name: 'USER 1' },
  { id: 8, name: 'USER 2' },
  { id: 9, name: 'SFX' },
] as const

// Filesystem paths
export const FS_PATH = {
  SOUNDS:   '/sounds',
  PROJECTS: '/projects',
  groups: (projectId: string) => `/projects/${projectId}/groups`,
} as const

// ─── Wire types ───────────────────────────────────────────────

export interface TeSysexMessage {
  identity_code: number
  request_id: number
  has_request_id: boolean
  status: number
  command: number
  type: 'request' | 'response'
  data: Uint8Array
}

export interface FileNode {
  node_id: number
  name: string
  type: 'file' | 'dir'
  capabilities: number
  size?: number
  metadata?: SoundMeta
  path: string
}

export interface SoundMeta {
  name?: string
  channels?: number
  samplerate?: number
  format?: string
  crc?: number
  'sound.loopstart'?: number
  'sound.loopend'?: number
  'sound.playmode'?: number
  'sound.rootnote'?: number
  'sound.bpm'?: number
  'sound.pitch'?: number
  'sound.pan'?: number
  'sound.amplitude'?: number
  'envelope.attack'?: number
  'envelope.release'?: number
  'time.mode'?: number
  'sample.mode'?: number
  sym?: number   // pad assignment (node_id of sound)
  [key: string]: unknown
}

export interface DeviceInfo {
  serial: string
  sku: string
  name: string
  firmware: string
  input_id: string
  output_id: string
  identityCode: number
}

export interface ProgressCallback {
  (progress: number, total: number, status: string): void
}
