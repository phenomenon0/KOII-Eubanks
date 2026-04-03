// ────────────────────────────────────────────────────────────
// KO Workbench — Controller Profile Definitions
// Known MIDI controller profiles for auto-detection and labeling
// ────────────────────────────────────────────────────────────

export interface ControllerProfile {
  name: string
  matchPatterns: string[]    // substrings to match against MIDI device name
  type: 'keyboard' | 'pad' | 'fader' | 'generic'
  noteRange?: [number, number]  // [lowest, highest] MIDI note
  ccMap?: Record<number, string>  // CC# → suggested label
  hasTransport?: boolean
  hasPads?: boolean
  faderCount?: number
  knobCount?: number
}

export const CONTROLLER_PROFILES: ControllerProfile[] = [
  {
    name: 'Generic 49-Key',
    matchPatterns: ['49', 'keyboard'],
    type: 'keyboard',
    noteRange: [36, 84],
    faderCount: 0,
  },
  {
    name: 'Generic 61-Key',
    matchPatterns: ['61'],
    type: 'keyboard',
    noteRange: [36, 96],
    faderCount: 0,
  },
  {
    name: 'Akai MPK Mini',
    matchPatterns: ['mpk mini', 'mpk'],
    type: 'pad',
    noteRange: [48, 72],
    hasPads: true,
    knobCount: 8,
    ccMap: { 1: 'Knob 1', 2: 'Knob 2', 3: 'Knob 3', 4: 'Knob 4', 5: 'Knob 5', 6: 'Knob 6', 7: 'Knob 7', 8: 'Knob 8' },
  },
  {
    name: 'Novation Launchkey',
    matchPatterns: ['launchkey'],
    type: 'keyboard',
    noteRange: [36, 96],
    hasPads: true,
    faderCount: 9,
    hasTransport: true,
  },
  {
    name: 'Arturia MiniLab',
    matchPatterns: ['minilab', 'arturia'],
    type: 'keyboard',
    noteRange: [36, 84],
    knobCount: 16,
    hasPads: true,
  },
  {
    name: 'Korg nanoKONTROL',
    matchPatterns: ['nanokontrol', 'nanocontrol'],
    type: 'fader',
    faderCount: 8,
    knobCount: 8,
    hasTransport: true,
    ccMap: { 0: 'Fader 1', 1: 'Fader 2', 2: 'Fader 3', 3: 'Fader 4', 4: 'Fader 5', 5: 'Fader 6', 6: 'Fader 7', 7: 'Fader 8' },
  },
  {
    name: 'Generic Controller',
    matchPatterns: [],  // fallback — always matches
    type: 'generic',
  },
]

/**
 * Match a device name to the best profile.
 * Checks matchPatterns in order; falls back to Generic Controller.
 */
export function matchProfile(deviceName: string): ControllerProfile {
  const lower = deviceName.toLowerCase()
  for (const profile of CONTROLLER_PROFILES) {
    if (profile.matchPatterns.length === 0) continue
    if (profile.matchPatterns.some(p => lower.includes(p))) return profile
  }
  return CONTROLLER_PROFILES[CONTROLLER_PROFILES.length - 1] // fallback to generic
}
