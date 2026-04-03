// ────────────────────────────────────────────────────────────
// KO Workbench — Sample Lab tab
// Import, chop, preview, and commit samples to EP-133.
// ────────────────────────────────────────────────────────────

import { useCallback, useRef, useState, useEffect } from 'react'
import { WaveformEditor } from '../components/WaveformEditor'
import type { WaveformMarker } from '../components/WaveformEditor'
import { detectTransients, equalSlices } from '../../audio/slicer'
import { useWorkspaceDispatch } from '../../store'

// ─── Types ──────────────────────────────────────────────────

type SliceMode = 'manual' | 'transient' | 'equal4' | 'equal8' | 'equal16'

interface LoadedSample {
  name: string
  durationSec: number
  sampleRate: number
  audioData: Float32Array   // mono float [-1,1]
}

// ─── Audio helpers ──────────────────────────────────────────

/** Decode a File into mono Float32Array at its native rate. */
async function decodeToFloat(file: File): Promise<LoadedSample> {
  const arrayBuffer = await file.arrayBuffer()
  const audioCtx = new AudioContext()
  let audioBuffer: AudioBuffer
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0))
  } catch (e) {
    throw new Error(`Cannot decode: ${file.name} — ${String(e)}`)
  } finally {
    audioCtx.close()
  }

  // Mix to mono
  const ch0 = audioBuffer.getChannelData(0)
  let mono: Float32Array
  if (audioBuffer.numberOfChannels > 1) {
    const ch1 = audioBuffer.getChannelData(1)
    mono = new Float32Array(ch0.length)
    for (let i = 0; i < ch0.length; i++) {
      mono[i] = (ch0[i] + ch1[i]) / 2
    }
  } else {
    mono = new Float32Array(ch0) // copy
  }

  return {
    name: file.name,
    durationSec: audioBuffer.duration,
    sampleRate: audioBuffer.sampleRate,
    audioData: mono,
  }
}

// ─── Preview playback ──────────────────────────────────────

let previewCtx: AudioContext | null = null
let previewSource: AudioBufferSourceNode | null = null

function stopPreview() {
  try { previewSource?.stop() } catch { /* noop */ }
  previewSource = null
}

function playPreview(
  data: Float32Array,
  sampleRate: number,
  onEnd: () => void,
  onFrame?: (pos: number) => void,
): void {
  stopPreview()
  if (!previewCtx || previewCtx.state === 'closed') {
    previewCtx = new AudioContext()
  }
  const ctx = previewCtx
  const buffer = ctx.createBuffer(1, data.length, sampleRate)
  buffer.getChannelData(0).set(data)

  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  src.onended = onEnd

  const startTime = ctx.currentTime
  src.start()
  previewSource = src

  // Drive position callback
  if (onFrame) {
    const tick = () => {
      if (!previewSource) return
      const elapsed = ctx.currentTime - startTime
      const pos = Math.round(elapsed * sampleRate)
      onFrame(pos)
      if (pos < data.length) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
}

// ─── Component ──────────────────────────────────────────────

export function SampleTab() {
  const dispatch = useWorkspaceDispatch()

  // Sample state
  const [sample, setSample] = useState<LoadedSample | null>(null)
  const [markers, setMarkers] = useState<WaveformMarker[]>([])
  const [loopStart, setLoopStart] = useState<number | undefined>()
  const [loopEnd, setLoopEnd] = useState<number | undefined>()
  const [sliceMode, setSliceMode] = useState<SliceMode>('manual')
  const [playbackPos, setPlaybackPos] = useState<number | undefined>()
  const [isPlaying, setIsPlaying] = useState(false)
  const [targetBank, setTargetBank] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const nextMarkerId = useRef(1)

  // ── File loading ─────────────────────────────────────────

  const loadFile = useCallback(async (file: File) => {
    setLoadError(null)
    try {
      const loaded = await decodeToFloat(file)
      setSample(loaded)
      setMarkers([])
      setLoopStart(undefined)
      setLoopEnd(undefined)
      setSliceMode('manual')
      stopPreview()
      setIsPlaying(false)
      setPlaybackPos(undefined)
      nextMarkerId.current = 1
    } catch (e) {
      setLoadError(String(e))
    }
  }, [])

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)

    // Check for pack file path (dragged from Packs browser)
    const packPath = e.dataTransfer.getData('text/x-pack-file-path')
    if (packPath && window.electronAPI) {
      try {
        const buffer = await window.electronAPI.readFile(packPath)
        const name = e.dataTransfer.getData('text/x-pack-file-name') || 'sample.wav'
        const blob = new Blob([buffer], { type: 'audio/wav' })
        const file = new File([blob], name, { type: 'audio/wav' })
        loadFile(file)
      } catch (err) {
        console.error('Failed to load pack file:', err)
      }
      return
    }

    // Regular file drop from desktop
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
  }, [loadFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadFile(file)
  }, [loadFile])

  // ── Marker operations ────────────────────────────────────

  const addMarker = useCallback((position: number) => {
    const id = `m${nextMarkerId.current++}`
    const marker: WaveformMarker = { id, position, label: `S${markers.length + 1}` }
    const newMarkers = [...markers, marker].sort((a, b) => a.position - b.position)
    setMarkers(newMarkers)
    // Sync to workspace store
    dispatch({ type: 'ADD_SLICE_MARKER', marker: { id, position, label: marker.label } })
  }, [markers, dispatch])

  const moveMarker = useCallback((id: string, position: number) => {
    setMarkers(prev => {
      const updated = prev.map(m => m.id === id ? { ...m, position } : m)
      return updated.sort((a, b) => a.position - b.position)
    })
  }, [])

  const removeMarker = useCallback((id: string) => {
    setMarkers(prev => prev.filter(m => m.id !== id))
    dispatch({ type: 'REMOVE_SLICE_MARKER', id })
  }, [dispatch])

  // ── Slice modes ──────────────────────────────────────────

  const applySliceMode = useCallback((mode: SliceMode) => {
    if (!sample) return
    setSliceMode(mode)

    if (mode === 'manual') return // keep existing markers

    let positions: number[]

    if (mode === 'transient') {
      positions = detectTransients(sample.audioData, sample.sampleRate, 0.5)
    } else {
      const countMap: Record<string, number> = { equal4: 4, equal8: 8, equal16: 16 }
      const count = countMap[mode] ?? 4
      const boundaries = equalSlices(sample.audioData.length, count)
      // Skip first (0) and last (total) — they're implicit boundaries
      positions = boundaries.slice(1, -1)
    }

    nextMarkerId.current = 1
    const newMarkers: WaveformMarker[] = positions.map((pos, i) => ({
      id: `m${nextMarkerId.current++}`,
      position: pos,
      label: `S${i + 1}`,
    }))
    setMarkers(newMarkers)
  }, [sample])

  const clearMarkers = useCallback(() => {
    setMarkers([])
    setSliceMode('manual')
  }, [])

  // ── Preview playback ────────────────────────────────────

  const handlePreview = useCallback(() => {
    if (!sample) return
    if (isPlaying) {
      stopPreview()
      setIsPlaying(false)
      setPlaybackPos(undefined)
      return
    }

    setIsPlaying(true)
    playPreview(
      sample.audioData,
      sample.sampleRate,
      () => { setIsPlaying(false); setPlaybackPos(undefined) },
      (pos) => setPlaybackPos(pos),
    )
  }, [sample, isPlaying])

  const handleSeek = useCallback((position: number) => {
    setPlaybackPos(position)
  }, [])

  // ── Loop change ──────────────────────────────────────────

  const handleLoopChange = useCallback((start: number, end: number) => {
    setLoopStart(start)
    setLoopEnd(end)
  }, [])

  // ── Commit actions (placeholders for device integration) ─

  const handleSendToDevice = useCallback(() => {
    if (!sample) return
    console.log('Send to device — bank:', targetBank, 'sample:', sample.name)
    // TODO: process via AudioProcessor and upload via protocol
  }, [sample, targetBank])

  const handleSpreadToPads = useCallback(() => {
    if (!sample || markers.length === 0) return
    console.log('Spread to pads — bank:', targetBank, 'slices:', markers.length + 1)
    // TODO: extract each slice, process, and assign to sequential pads
  }, [sample, markers, targetBank])

  // ── Render ───────────────────────────────────────────────

  const sliceCount = markers.length + 1

  const bankOptions = [
    'KICK', 'SNARE', 'CYMBAL', 'PERC',
    'BASS', 'MELODY', 'LOOP', 'USER 1',
    'USER 2', 'SFX',
  ]

  return (
    <div className="sample-lab" style={{ display: 'flex', height: '100%' }}>
      {/* ── Left: Inline file browser ── */}
      <InlinePacksBrowser onLoadFile={loadFile} />

      {/* ── Right: Editor area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Ingest strip ── */}
      <div className="sample-ingest">
        <div
          className={`sample-drop-zone ${dragOver ? 'drag-over' : ''} ${sample ? 'has-sample' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {sample ? (
            <div className="sample-loaded-info">
              <span className="sample-loaded-name">{sample.name}</span>
              <span className="sample-loaded-dur">{sample.durationSec.toFixed(2)}s</span>
              <span className="sample-loaded-rate">{sample.sampleRate} Hz</span>
            </div>
          ) : (
            <div className="sample-drop-prompt">
              <span className="sample-drop-icon">+</span>
              <span>Drop audio or click to browse</span>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.flac,.ogg,.aiff,.aif"
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />

        <button
          className="btn btn-sm"
          disabled
          title="Record (coming soon)"
          style={{ opacity: 0.4 }}
        >
          REC
        </button>
      </div>

      {loadError && (
        <div className="sample-error">{loadError}</div>
      )}

      {/* ── Waveform Editor ── */}
      {sample ? (
        <div className="sample-editor">
          <WaveformEditor
            audioData={sample.audioData}
            sampleRate={sample.sampleRate}
            markers={markers}
            loopStart={loopStart}
            loopEnd={loopEnd}
            onMarkerAdd={addMarker}
            onMarkerMove={moveMarker}
            onMarkerRemove={removeMarker}
            onLoopChange={handleLoopChange}
            onSeek={handleSeek}
            playbackPosition={playbackPos}
          />
        </div>
      ) : (
        <div className="sample-editor sample-editor-empty">
          <div className="empty-state">
            <div className="empty-state-icon">&#x2702;</div>
            <div>Sample Lab</div>
            <div style={{ fontSize: 11 }}>Import an audio file to start editing</div>
          </div>
        </div>
      )}

      {/* ── Slice controls ── */}
      <div className="sample-controls">
        <div className="slice-btn-row">
          <button
            className={`slice-btn ${sliceMode === 'transient' ? 'active' : ''}`}
            onClick={() => applySliceMode('transient')}
            disabled={!sample}
          >
            Transient
          </button>
          <button
            className={`slice-btn ${sliceMode === 'equal4' ? 'active' : ''}`}
            onClick={() => applySliceMode('equal4')}
            disabled={!sample}
          >
            Equal (4)
          </button>
          <button
            className={`slice-btn ${sliceMode === 'equal8' ? 'active' : ''}`}
            onClick={() => applySliceMode('equal8')}
            disabled={!sample}
          >
            Equal (8)
          </button>
          <button
            className={`slice-btn ${sliceMode === 'equal16' ? 'active' : ''}`}
            onClick={() => applySliceMode('equal16')}
            disabled={!sample}
          >
            Equal (16)
          </button>
          <button
            className={`slice-btn ${sliceMode === 'manual' ? 'active' : ''}`}
            onClick={() => applySliceMode('manual')}
            disabled={!sample}
          >
            Manual
          </button>
          <button
            className="slice-btn slice-btn-clear"
            onClick={clearMarkers}
            disabled={!sample || markers.length === 0}
          >
            Clear
          </button>
        </div>
        <span className="slice-count">
          {sample ? `${sliceCount} slice${sliceCount !== 1 ? 's' : ''}` : ''}
        </span>
      </div>

      {/* ── Commit area ── */}
      <div className="sample-commit">
        <div className="commit-bar">
          <button
            className={`btn ${isPlaying ? 'btn-primary' : 'btn-teal'}`}
            onClick={handlePreview}
            disabled={!sample}
          >
            {isPlaying ? 'Stop' : 'Preview'}
          </button>

          <button
            className="btn btn-primary"
            onClick={handleSendToDevice}
            disabled={!sample}
          >
            Send to Device
          </button>

          <button
            className="btn btn-primary"
            onClick={handleSpreadToPads}
            disabled={!sample || markers.length === 0}
          >
            Spread to Pads
          </button>

          <div className="commit-bank-select">
            <label>Bank:</label>
            <select
              value={targetBank}
              onChange={e => setTargetBank(Number(e.target.value))}
            >
              {bankOptions.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      </div>{/* end editor area */}
    </div>
  )
}

// ── Inline file browser (packs + recent) ──────────────────

interface PackInfo { name: string; path: string }
interface AudioFileInfo { name: string; path: string; size: number }

function InlinePacksBrowser({ onLoadFile }: { onLoadFile: (file: File) => void }) {
  const [packs, setPacks] = useState<PackInfo[]>([])
  const [selectedPack, setSelectedPack] = useState<PackInfo | null>(null)
  const [files, setFiles] = useState<AudioFileInfo[]>([])
  const [playingPath, setPlayingPath] = useState<string | null>(null)
  const audioRef = useRef<{ stop: () => void } | null>(null)

  useEffect(() => {
    if (!window.electronAPI?.samplesPath) return
    ;(async () => {
      try {
        const dir = await window.electronAPI.samplesPath()
        const dirs = await window.electronAPI.listDirs(dir)
        setPacks(dirs)
        // Auto-select first pack
        if (dirs.length > 0) setSelectedPack(dirs[0])
      } catch { /* no electronAPI */ }
    })()
  }, [])

  useEffect(() => {
    if (!selectedPack || !window.electronAPI?.listAudioFiles) return
    ;(async () => {
      const f = await window.electronAPI.listAudioFiles(selectedPack.path)
      setFiles(f)
    })()
  }, [selectedPack])

  useEffect(() => () => { audioRef.current?.stop() }, [])

  const preview = async (f: AudioFileInfo) => {
    audioRef.current?.stop()
    audioRef.current = null
    if (playingPath === f.path) { setPlayingPath(null); return }

    try {
      const buf = await window.electronAPI.readFile(f.path)
      const ctx = new AudioContext()
      const ab = await ctx.decodeAudioData(buf.slice(0))
      const src = ctx.createBufferSource()
      src.buffer = ab; src.connect(ctx.destination); src.start()
      src.onended = () => { setPlayingPath(null); audioRef.current = null; ctx.close() }
      audioRef.current = { stop: () => { try { src.stop() } catch {} ctx.close() } }
      setPlayingPath(f.path)
    } catch { setPlayingPath(null) }
  }

  const loadIntoEditor = async (f: AudioFileInfo) => {
    try {
      const buf = await window.electronAPI.readFile(f.path)
      const blob = new Blob([buf], { type: 'audio/wav' })
      const file = new File([blob], f.name, { type: 'audio/wav' })
      onLoadFile(file)
    } catch (e) { console.error('Load failed:', e) }
  }

  if (packs.length === 0) {
    return (
      <div style={{
        width: 200, minWidth: 200, borderRight: '1px solid var(--lib-border)',
        background: 'var(--lib-bg)', display: 'flex', flexDirection: 'column',
        fontSize: 10, color: 'var(--text-mid)', padding: 12, textAlign: 'center',
      }}>
        No sample packs found.<br />
        Add folders to samples/
      </div>
    )
  }

  return (
    <div style={{
      width: 220, minWidth: 220, borderRight: '1px solid var(--lib-border)',
      background: 'var(--lib-bg)', display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Pack tabs */}
      <div style={{
        display: 'flex', gap: 2, padding: '4px 4px 0', flexWrap: 'wrap',
        borderBottom: '1px solid var(--lib-border)', background: 'var(--lib-header)',
      }}>
        {packs.map(p => (
          <button
            key={p.path}
            style={{
              fontSize: 8, padding: '3px 6px', border: '1px solid var(--lib-border)',
              borderBottom: 'none', borderRadius: '3px 3px 0 0', cursor: 'pointer',
              background: selectedPack?.path === p.path ? 'var(--lib-bg)' : 'transparent',
              fontWeight: selectedPack?.path === p.path ? 'bold' : 'normal',
              color: 'var(--text-dark)', fontFamily: 'inherit',
            }}
            onClick={() => setSelectedPack(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {files.map((f, i) => {
          const playing = playingPath === f.path
          return (
            <div
              key={f.path}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 6px', fontSize: 10, cursor: 'pointer',
                borderBottom: '1px solid var(--lib-border)',
                background: playing ? 'rgba(1,167,157,0.12)' : i % 2 ? 'var(--lib-row-alt)' : 'var(--lib-row)',
              }}
            >
              <span style={{ width: 16, color: 'var(--text-mid)', textAlign: 'right', flexShrink: 0 }}>
                {i + 1}
              </span>

              {/* Preview */}
              <span
                style={{ width: 14, textAlign: 'center', color: playing ? 'var(--accent)' : 'var(--text-mid)', flexShrink: 0 }}
                onClick={() => preview(f)}
                title="Preview"
              >
                {playing ? '■' : '▶'}
              </span>

              {/* Name — click to load into editor */}
              <span
                style={{
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap', color: 'var(--text-dark)',
                }}
                onClick={() => loadIntoEditor(f)}
                title={`Load "${f.name}" into editor`}
              >
                {f.name.replace(/\.[^.]+$/, '')}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
