// ────────────────────────────────────────────────────────────
// KO Studio — Virtual Keyboard
// 3-octave piano rendered as CSS divs with zone overlays,
// mouse interaction (click + drag glissando), and key labels.
// ────────────────────────────────────────────────────────────

import { useCallback, useRef } from 'react'
import type { KeyZone } from '../../engine/KeyMapper'
import { KeyMapper } from '../../engine/KeyMapper'

export interface VirtualKeyboardProps {
  startNote?: number        // default 48 (C3)
  octaves?: number          // default 3
  keyZones: KeyZone[]       // from KeyMapper
  activeNotes: Set<number>  // currently playing/pressed
  onNoteOn: (note: number) => void
  onNoteOff: (note: number) => void
  highlightScale?: number[] // optional scale note highlights
}

/** Layout constants — white keys per octave: C D E F G A B */
const WHITE_NOTES_IN_OCTAVE = [0, 2, 4, 5, 7, 9, 11]

/** Black key offsets relative to their preceding white key position */
const BLACK_KEY_OFFSETS: Record<number, number> = {
  1: 0,   // C#  after C
  3: 1,   // D#  after D
  6: 3,   // F#  after F
  8: 4,   // G#  after G
  10: 5,  // A#  after A
}

export function VirtualKeyboard({
  startNote = 48,
  octaves = 3,
  keyZones,
  activeNotes,
  onNoteOn,
  onNoteOff,
  highlightScale,
}: VirtualKeyboardProps) {
  const isDragging = useRef(false)
  const lastNote = useRef<number | null>(null)

  // Build the zone lookup for fast access
  const zoneMap = new Map<number, KeyZone>()
  for (const z of keyZones) {
    zoneMap.set(z.noteNumber, z)
  }

  const scaleSet = highlightScale ? new Set(highlightScale) : null

  // Collect all notes in range
  const endNote = startNote + octaves * 12
  const whiteKeys: number[] = []
  const blackKeys: { note: number; whiteIndex: number }[] = []

  for (let note = startNote; note < endNote; note++) {
    if (!KeyMapper.isBlackKey(note)) {
      whiteKeys.push(note)
    }
  }

  for (let note = startNote; note < endNote; note++) {
    if (KeyMapper.isBlackKey(note)) {
      // Find which white key index this black key sits after
      const prevWhite = note - 1
      // Walk back to find the preceding white key
      let wn = note - 1
      while (wn >= startNote && KeyMapper.isBlackKey(wn)) wn--
      const wIdx = whiteKeys.indexOf(wn)
      if (wIdx >= 0) {
        blackKeys.push({ note, whiteIndex: wIdx })
      }
    }
  }

  const WHITE_W = 40
  const WHITE_H = 160
  const BLACK_W = 26
  const BLACK_H = 100
  const totalWidth = whiteKeys.length * WHITE_W

  // ── Mouse handlers ──

  const handleNoteOn = useCallback((note: number) => {
    onNoteOn(note)
    lastNote.current = note
  }, [onNoteOn])

  const handleNoteOff = useCallback((note: number) => {
    onNoteOff(note)
    if (lastNote.current === note) lastNote.current = null
  }, [onNoteOff])

  const handleMouseDown = useCallback((note: number) => {
    isDragging.current = true
    handleNoteOn(note)
  }, [handleNoteOn])

  const handleMouseEnter = useCallback((note: number) => {
    if (!isDragging.current) return
    // Glissando: release previous, press new
    if (lastNote.current !== null && lastNote.current !== note) {
      handleNoteOff(lastNote.current)
    }
    handleNoteOn(note)
  }, [handleNoteOn, handleNoteOff])

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
    if (lastNote.current !== null) {
      handleNoteOff(lastNote.current)
    }
  }, [handleNoteOff])

  const handleMouseLeave = useCallback(() => {
    // Only release if we leave the entire keyboard
    // Individual key leave is handled by mouseEnter on next key
  }, [])

  // ── Key class builder ──

  function keyClasses(note: number, isBlack: boolean): string {
    const parts = [isBlack ? 'vk-black-key' : 'vk-white-key']
    if (zoneMap.has(note)) parts.push('mapped')
    if (activeNotes.has(note)) parts.push('active')
    if (scaleSet?.has(note % 12)) parts.push('scale-highlight')
    return parts.join(' ')
  }

  // ── Zone badge text ──

  function zoneBadge(note: number): string | null {
    const z = zoneMap.get(note)
    if (!z) return null
    if (z.sliceIndex !== undefined) return `S${z.sliceIndex}`
    if (z.semitoneOffset === 0) return 'ROOT'
    const sign = z.semitoneOffset > 0 ? '+' : ''
    return `${sign}${z.semitoneOffset}st`
  }

  return (
    <div
      className="virtual-keyboard"
      style={{ width: totalWidth, height: WHITE_H + 24 }}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* White keys */}
      {whiteKeys.map((note, i) => {
        const badge = zoneBadge(note)
        return (
          <div
            key={note}
            className={keyClasses(note, false)}
            style={{
              position: 'absolute',
              left: i * WHITE_W,
              top: 0,
              width: WHITE_W,
              height: WHITE_H,
            }}
            onMouseDown={() => handleMouseDown(note)}
            onMouseEnter={() => handleMouseEnter(note)}
          >
            {badge && <span className="vk-zone-badge">{badge}</span>}
            <span className="vk-key-label">{KeyMapper.noteName(note)}</span>
          </div>
        )
      })}

      {/* Black keys */}
      {blackKeys.map(({ note, whiteIndex }) => {
        const badge = zoneBadge(note)
        return (
          <div
            key={note}
            className={keyClasses(note, true)}
            style={{
              position: 'absolute',
              left: whiteIndex * WHITE_W + WHITE_W - BLACK_W / 2,
              top: 0,
              width: BLACK_W,
              height: BLACK_H,
              zIndex: 2,
            }}
            onMouseDown={() => handleMouseDown(note)}
            onMouseEnter={() => handleMouseEnter(note)}
          >
            {badge && <span className="vk-zone-badge">{badge}</span>}
          </div>
        )
      })}
    </div>
  )
}
