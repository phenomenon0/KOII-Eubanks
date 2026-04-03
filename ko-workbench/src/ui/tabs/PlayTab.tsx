// ────────────────────────────────────────────────────────────
// KO Studio — Play Map Tab
// Virtual keyboard, slice-to-key mapping, "how to play"
// overlay, and quick audio operations.
// ────────────────────────────────────────────────────────────

import { useState, useMemo, useCallback, useRef } from 'react'
import { useDevice } from '../../store'
import { useWorkspace } from '../../store'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { KeyMapper } from '../../engine/KeyMapper'
import type { KeyZone, MappingMode, ScaleType } from '../../engine/KeyMapper'
import { pitchShift, reverseAudio, normalizeAudio, previewAudio } from '../../audio/quickops'

const MODES: { value: MappingMode; label: string }[] = [
  { value: 'chromatic', label: 'Chromatic' },
  { value: 'scale', label: 'Scale' },
  { value: 'drum-rack', label: 'Drum Rack' },
  { value: 'slices', label: 'Slices' },
]

const SCALES: { value: ScaleType; label: string }[] = [
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
  { value: 'pentatonic', label: 'Pentatonic' },
]

export function PlayTab() {
  const { sounds, selectedSoundId } = useDevice()
  const { sliceMarkers } = useWorkspace()

  const [mode, setMode] = useState<MappingMode>('chromatic')
  const [rootNote, setRootNote] = useState(60) // C3
  const [scale, setScale] = useState<ScaleType>('major')
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set())

  // Track active audio stop functions
  const stopFns = useRef<Map<number, () => void>>(new Map())

  // Find the selected sound
  const selectedSound = useMemo(
    () => sounds.find(s => s.nodeId === selectedSoundId) ?? null,
    [sounds, selectedSoundId],
  )

  // Build key zones based on current mode
  const keyZones = useMemo<KeyZone[]>(() => {
    switch (mode) {
      case 'chromatic':
        return selectedSound
          ? KeyMapper.mapChromaticPitch(selectedSound.nodeId, rootNote)
          : []
      case 'scale':
        return selectedSound
          ? KeyMapper.mapScale(selectedSound.nodeId, rootNote, scale)
          : []
      case 'drum-rack':
        return KeyMapper.mapDrumRack(
          sounds.map(s => ({ nodeId: s.nodeId, bank: s.bank })),
        )
      case 'slices':
        return KeyMapper.mapSlicesToKeys(
          sliceMarkers.length,
          rootNote,
          selectedSound?.nodeId,
        )
      default:
        return []
    }
  }, [mode, rootNote, scale, selectedSound, sounds, sliceMarkers])

  // Suggestion text
  const suggestion = useMemo(
    () => KeyMapper.suggestion(mode, sliceMarkers.length, rootNote),
    [mode, sliceMarkers.length, rootNote],
  )

  // Zone lookup for quick info
  const zoneMap = useMemo(() => {
    const m = new Map<number, KeyZone>()
    for (const z of keyZones) m.set(z.noteNumber, z)
    return m
  }, [keyZones])

  // ── Note on/off handlers ──

  const handleNoteOn = useCallback((note: number) => {
    setActiveNotes(prev => {
      const next = new Set(prev)
      next.add(note)
      return next
    })

    // Preview audio with pitch shift
    const zone = zoneMap.get(note)
    if (!zone || !selectedSound?.waveform) return

    const samples = zone.semitoneOffset !== 0
      ? pitchShift(selectedSound.waveform, zone.semitoneOffset)
      : selectedSound.waveform

    const stop = previewAudio(samples, selectedSound.sampleRate)
    stopFns.current.set(note, stop)
  }, [zoneMap, selectedSound])

  const handleNoteOff = useCallback((note: number) => {
    setActiveNotes(prev => {
      const next = new Set(prev)
      next.delete(note)
      return next
    })

    const stop = stopFns.current.get(note)
    if (stop) {
      stop()
      stopFns.current.delete(note)
    }
  }, [])

  // ── Quick ops ──

  const handleQuickOp = useCallback((op: 'reverse' | 'normalize' | '+12' | '-12') => {
    if (!selectedSound?.waveform) return
    // Quick ops work on the waveform data — in a full implementation these
    // would dispatch an UPDATE_SOUND action. For now we preview the result.
    let samples = selectedSound.waveform
    switch (op) {
      case 'reverse':
        samples = reverseAudio(samples)
        break
      case 'normalize':
        samples = normalizeAudio(samples)
        break
      case '+12':
        samples = pitchShift(samples, 12)
        break
      case '-12':
        samples = pitchShift(samples, -12)
        break
    }
    previewAudio(samples, selectedSound.sampleRate)
  }, [selectedSound])

  // Root note controls
  const nudgeRoot = useCallback((delta: number) => {
    setRootNote(prev => Math.max(0, Math.min(127, prev + delta)))
  }, [])

  // ── Compute keyboard start so root is visible ──
  const kbStart = useMemo(() => {
    // Center the keyboard so rootNote is roughly in the middle
    const ideal = rootNote - 18 // ~1.5 octaves below root
    // Snap to nearest C
    const snapped = Math.floor(ideal / 12) * 12
    return Math.max(0, Math.min(108, snapped))
  }, [rootNote])

  // Visible zone list (only zones within keyboard range)
  const visibleZones = useMemo(
    () => keyZones.filter(z => z.noteNumber >= kbStart && z.noteNumber < kbStart + 36),
    [keyZones, kbStart],
  )

  // ── Render ──

  return (
    <div className="play-map">
      {/* Left: info panel */}
      <div className="play-info-panel">
        <div className="play-info-section">
          <div className="play-info-label">ROOT NOTE</div>
          <div className="play-root-control">
            <button className="play-btn-sm" onClick={() => nudgeRoot(-1)}>-</button>
            <span className="play-root-display">{KeyMapper.noteName(rootNote)}</span>
            <button className="play-btn-sm" onClick={() => nudgeRoot(1)}>+</button>
          </div>
        </div>

        {mode === 'scale' && (
          <div className="play-info-section">
            <div className="play-info-label">SCALE</div>
            <select
              className="play-select"
              value={scale}
              onChange={e => setScale(e.target.value as ScaleType)}
            >
              {SCALES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="play-info-section">
          <div className="play-info-label">MODE</div>
          <div className="play-mode-buttons">
            {MODES.map(m => (
              <button
                key={m.value}
                className={`play-mode-btn ${mode === m.value ? 'active' : ''}`}
                onClick={() => setMode(m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="play-info-section">
          <div className="play-info-label">MAPPED</div>
          <div className="play-stat">{keyZones.length} keys</div>
        </div>

        {selectedSound && (
          <div className="play-info-section">
            <div className="play-info-label">SOUND</div>
            <div className="play-stat">{selectedSound.name}</div>
          </div>
        )}

        <div className="play-suggestion">
          <div className="play-info-label">HOW TO PLAY</div>
          <p>{suggestion}</p>
        </div>

        <div className="play-quick-actions">
          <div className="play-info-label">QUICK OPS</div>
          <div className="play-action-row">
            <button className="play-btn" onClick={() => handleQuickOp('reverse')}>Reverse</button>
            <button className="play-btn" onClick={() => handleQuickOp('normalize')}>Normalize</button>
          </div>
          <div className="play-action-row">
            <button className="play-btn" onClick={() => handleQuickOp('+12')}>+12st</button>
            <button className="play-btn" onClick={() => handleQuickOp('-12')}>-12st</button>
          </div>
        </div>
      </div>

      {/* Right: keyboard + zone list */}
      <div className="play-keyboard-area">
        <div className="play-keyboard-scroll">
          <VirtualKeyboard
            startNote={kbStart}
            octaves={3}
            keyZones={keyZones}
            activeNotes={activeNotes}
            onNoteOn={handleNoteOn}
            onNoteOff={handleNoteOff}
          />
        </div>

        <div className="play-zone-list">
          <div className="play-zone-list-header">
            <span>Note</span>
            <span>Mapping</span>
            <span>Type</span>
          </div>
          {visibleZones.length === 0 && (
            <div className="play-zone-empty">
              {selectedSound
                ? 'No zones mapped in visible range'
                : 'Select a sound in the Device tab to begin'}
            </div>
          )}
          {visibleZones.map(z => (
            <div
              key={z.noteNumber}
              className={`play-zone-row ${activeNotes.has(z.noteNumber) ? 'active' : ''}`}
            >
              <span className="play-zone-note">{z.noteName}</span>
              <span className="play-zone-mapping">
                {z.sliceIndex !== undefined
                  ? `slice_${z.sliceIndex}`
                  : z.semitoneOffset === 0
                    ? 'root'
                    : `${z.semitoneOffset > 0 ? '+' : ''}${z.semitoneOffset}st`}
              </span>
              <span className="play-zone-type">{z.type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
