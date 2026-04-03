// ────────────────────────────────────────────────────────────
// KO Studio — Key Mapper Engine
// Maps slices, sounds, and pitches to MIDI note numbers
// for the virtual keyboard and play map.
// ────────────────────────────────────────────────────────────

export interface KeyZone {
  noteNumber: number       // MIDI note 0-127
  noteName: string         // "C3", "D#4", etc.
  soundNodeId?: number     // assigned sound
  sliceIndex?: number      // which slice this maps to
  type: 'one-shot' | 'loop' | 'pitched'
  rootNote: number         // original pitch reference
  semitoneOffset: number   // how far from root
}

export type MappingMode = 'chromatic' | 'scale' | 'drum-rack' | 'slices'

export type ScaleType = 'major' | 'minor' | 'pentatonic'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export class KeyMapper {
  /** Convert MIDI note number to readable name (e.g. 60 -> "C3") */
  static noteName(note: number): string {
    return NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1)
  }

  /** True if the note is a black key (sharp/flat) */
  static isBlackKey(note: number): boolean {
    const n = note % 12
    return n === 1 || n === 3 || n === 6 || n === 8 || n === 10
  }

  /** Map slices across keys chromatically starting from rootNote */
  static mapSlicesToKeys(
    sliceCount: number,
    rootNote: number = 60,
    soundNodeId?: number,
  ): KeyZone[] {
    const zones: KeyZone[] = []
    for (let i = 0; i < sliceCount; i++) {
      const note = rootNote + i
      if (note > 127) break
      zones.push({
        noteNumber: note,
        noteName: KeyMapper.noteName(note),
        soundNodeId,
        sliceIndex: i,
        type: 'one-shot',
        rootNote,
        semitoneOffset: i,
      })
    }
    return zones
  }

  /** Map a single sound pitched chromatically across 2 octaves */
  static mapChromaticPitch(soundNodeId: number, rootNote: number = 60): KeyZone[] {
    const zones: KeyZone[] = []
    for (let offset = -12; offset <= 12; offset++) {
      const note = rootNote + offset
      if (note < 0 || note > 127) continue
      zones.push({
        noteNumber: note,
        noteName: KeyMapper.noteName(note),
        soundNodeId,
        type: 'pitched',
        rootNote,
        semitoneOffset: offset,
      })
    }
    return zones
  }

  /** Drum rack mapping: specific notes for standard GM drum positions */
  static mapDrumRack(sounds: { nodeId: number; bank: string }[]): KeyZone[] {
    const drumMap: Record<string, number> = {
      'KICK': 36, 'SNARE': 38, 'CYMB': 42, 'PERC': 47,
      'BASS': 48, 'MELOD': 60, 'LOOP': 72,
      'USER 1': 84, 'USER 2': 85, 'SFX': 86,
    }
    const zones: KeyZone[] = []
    for (const sound of sounds) {
      const baseNote = drumMap[sound.bank] ?? 60
      zones.push({
        noteNumber: baseNote,
        noteName: KeyMapper.noteName(baseNote),
        soundNodeId: sound.nodeId,
        type: 'one-shot',
        rootNote: baseNote,
        semitoneOffset: 0,
      })
    }
    return zones
  }

  /** Scale-locked mapping across 3 octaves centered on rootNote */
  static mapScale(
    soundNodeId: number,
    rootNote: number,
    scale: ScaleType,
  ): KeyZone[] {
    const scales: Record<ScaleType, number[]> = {
      major: [0, 2, 4, 5, 7, 9, 11],
      minor: [0, 2, 3, 5, 7, 8, 10],
      pentatonic: [0, 2, 4, 7, 9],
    }
    const intervals = scales[scale]
    const zones: KeyZone[] = []
    for (let octave = -1; octave <= 1; octave++) {
      for (const interval of intervals) {
        const note = rootNote + octave * 12 + interval
        if (note < 0 || note > 127) continue
        zones.push({
          noteNumber: note,
          noteName: KeyMapper.noteName(note),
          soundNodeId,
          type: 'pitched',
          rootNote,
          semitoneOffset: note - rootNote,
        })
      }
    }
    return zones
  }

  /** Generate suggestion text based on mapping mode and context */
  static suggestion(
    mode: MappingMode,
    sliceCount: number,
    rootNote: number,
  ): string {
    const root = KeyMapper.noteName(rootNote)
    switch (mode) {
      case 'chromatic':
        return `Play chromatically from ${root}. Each semitone up/down shifts pitch. Use +/- buttons to transpose the root.`
      case 'scale':
        return `Scale-locked mode. Only in-scale notes are mapped. Root = ${root}. Change scale type with the dropdown.`
      case 'drum-rack':
        return `GM drum layout: C1=kick, D1=snare, F#1=hat, B1=perc. Each sound maps to its standard drum position.`
      case 'slices':
        return sliceCount > 0
          ? `${sliceCount} slices mapped starting at ${root}. ${root} = slice 1, each key up = next slice.`
          : `No slices yet. Go to the Sample tab to slice your audio, then return here to map them.`
    }
  }
}
