import { useState, useRef, useCallback, useEffect } from 'react'
import { useStore, useDispatch, useWorkspace, useWorkspaceDispatch, usePerformance, usePerformanceDispatch, SoundEntry } from '../../store'
import { BANKS } from '../../protocol/types'
import { SceneEngine } from '../../engine/SceneEngine'
import { QuantizeEngine } from '../../engine/QuantizeEngine'

const BANK_COLORS: Record<string, string> = {
  KICK:     '#8C959F', SNARE:  '#82C9EC', CYMB:   '#82EC88',
  PERC:     '#FAFF4A', BASS:   '#47F3E3', MELOD:  '#F45050',
  LOOP:     '#A475F9', 'USER 1': '#EE86E6', 'USER 2': '#FFAA00',
  SFX:      '#B88552',
}

const PAD_GRID = [
  { group: 'A', pads: [{ label: '7', idx: 0 }, { label: '8', idx: 1 }, { label: '9', idx: 2 }] },
  { group: 'B', pads: [{ label: '4', idx: 3 }, { label: '5', idx: 4 }, { label: '6', idx: 5 }] },
  { group: 'C', pads: [{ label: '1', idx: 6 }, { label: '2', idx: 7 }, { label: '3', idx: 8 }] },
  { group: 'D', pads: [{ label: '.', idx: 9 }, { label: '0', idx: 10 }, { label: 'ENT', idx: 11 }] },
]

const GROUPS = ['A', 'B', 'C', 'D'] as const
const QUANTIZE_OPTIONS: Array<'off' | '1bar' | '2bar' | '4bar'> = ['off', '1bar', '2bar', '4bar']

type FaderBankMode = 'mixer' | 'macros' | 'sample'

export function PerformTab() {
  const { state } = useStore()
  const dispatch = useDispatch()
  const workspace = useWorkspace()
  const workspaceDispatch = useWorkspaceDispatch()
  const perf = usePerformance()
  const perfDispatch = usePerformanceDispatch()

  const [activeGroup, setActiveGroup] = useState<string>('A')
  const [faderBank, setFaderBank] = useState<FaderBankMode>('mixer')
  const [faderValues, setFaderValues] = useState<number[]>([75, 60, 80, 50, 65, 70])
  const [isPlaying, setIsPlaying] = useState(false)
  const [recordArm, setRecordArm] = useState(false)
  const [editingBpm, setEditingBpm] = useState(false)
  const [bpmInput, setBpmInput] = useState(String(perf.bpm))
  const [queuedPads, setQueuedPads] = useState<Set<number>>(new Set())

  // Quantize engine instance (persists across renders)
  const quantizeEngine = useRef<QuantizeEngine | null>(null)
  if (!quantizeEngine.current) {
    quantizeEngine.current = new QuantizeEngine()
  }

  // Sync BPM and quantize to engine whenever they change
  useEffect(() => {
    quantizeEngine.current?.setBpm(perf.bpm)
  }, [perf.bpm])

  useEffect(() => {
    quantizeEngine.current?.setQuantize(perf.quantize)
  }, [perf.quantize])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      quantizeEngine.current?.dispose()
    }
  }, [])

  const currentBank = state.selectedBank ?? (BANKS.length > 0 ? BANKS[0].name : 'KICK')
  const bankColor = BANK_COLORS[currentBank] ?? '#999'
  const bankSounds = state.sounds.filter(s => s.bank === currentBank)

  const padSounds: (SoundEntry | null)[] = []
  for (let i = 0; i < 12; i++) {
    padSounds.push(bankSounds[i] ?? null)
  }

  // ── Scene actions ───────────────────────────────────────────

  const createScene = () => {
    const name = window.prompt('Scene name:', `Scene ${workspace.scenes.length + 1}`)
    if (!name) return

    const currentPadSounds = padSounds
      .map((s, i) => (s ? { padIndex: i, soundNodeId: s.nodeId } : null))
      .filter((p): p is { padIndex: number; soundNodeId: number } => p !== null)

    // Build macro values from current fader state
    const macroValues: Record<string, number> = {}
    faderLabels[faderBank].forEach((label, i) => {
      macroValues[`${faderBank}_${label}`] = faderValues[i]
    })

    const scene = SceneEngine.captureScene(name, currentPadSounds, macroValues)
    workspaceDispatch({ type: 'ADD_SCENE', scene })
    perfDispatch({ type: 'SET_SCENE', id: scene.id })
  }

  const launchScene = (scene: typeof workspace.scenes[number]) => {
    const recalled = SceneEngine.recallScene(scene)
    perfDispatch({ type: 'SET_SCENE', id: scene.id })

    // Apply macro values back to fader state
    const newFaderValues = [...faderValues]
    faderLabels[faderBank].forEach((label, i) => {
      const key = `${faderBank}_${label}`
      if (key in recalled.macroValues) {
        newFaderValues[i] = recalled.macroValues[key]
      }
    })
    setFaderValues(newFaderValues)
  }

  const deleteScene = (sceneId: string) => {
    workspaceDispatch({ type: 'REMOVE_SCENE', id: sceneId })
    if (perf.activeSceneId === sceneId) {
      perfDispatch({ type: 'SET_SCENE', id: null })
    }
  }

  // ── Transport ─────────────────────────────────────────────

  const togglePlay = () => {
    if (isPlaying) {
      quantizeEngine.current?.stop()
      setIsPlaying(false)
      setQueuedPads(new Set())
    } else {
      quantizeEngine.current?.start()
      setIsPlaying(true)
    }
  }

  const handleBpmCommit = () => {
    const val = parseInt(bpmInput, 10)
    if (!isNaN(val) && val >= 20 && val <= 300) {
      perfDispatch({ type: 'SET_BPM', bpm: val })
    } else {
      setBpmInput(String(perf.bpm))
    }
    setEditingBpm(false)
  }

  const cycleQuantize = () => {
    const idx = QUANTIZE_OPTIONS.indexOf(perf.quantize)
    const next = QUANTIZE_OPTIONS[(idx + 1) % QUANTIZE_OPTIONS.length]
    perfDispatch({ type: 'SET_QUANTIZE', quantize: next })
  }

  // ── Pad click with quantize ───────────────────────────────

  const handlePadClick = useCallback((sound: SoundEntry, padIdx: number) => {
    if (sound.isPlaying) {
      window.dispatchEvent(new CustomEvent('ko:stopSound', { detail: { nodeId: sound.nodeId } }))
      dispatch({ type: 'SELECT_SOUND', nodeId: sound.nodeId })
      return
    }

    if (perf.quantize !== 'off' && quantizeEngine.current?.isRunning()) {
      // Show queued state
      setQueuedPads(prev => new Set(prev).add(padIdx))
      quantizeEngine.current.scheduleAtNextBoundary(() => {
        window.dispatchEvent(new CustomEvent('ko:playSound', { detail: { nodeId: sound.nodeId } }))
        setQueuedPads(prev => {
          const next = new Set(prev)
          next.delete(padIdx)
          return next
        })
      })
    } else {
      window.dispatchEvent(new CustomEvent('ko:playSound', { detail: { nodeId: sound.nodeId } }))
    }

    dispatch({ type: 'SELECT_SOUND', nodeId: sound.nodeId })
  }, [perf.quantize, dispatch])

  const faderLabels: Record<FaderBankMode, string[]> = {
    mixer:  ['VOL', 'PAN', 'SEND', 'LOW', 'MID', 'HIGH'],
    macros: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
    sample: ['START', 'END', 'PITCH', 'DECAY', 'FILT', 'RES'],
  }

  return (
    <div className="perform-layout">
      {/* Left: Pad grid */}
      <div className="perform-pads">
        <div className="perform-section-header">
          <span>PAD GRID</span>
          <span className="perform-bank-badge" style={{ background: bankColor }}>
            {currentBank}
          </span>
        </div>

        {/* Group selector */}
        <div className="perform-group-selector">
          {GROUPS.map(g => (
            <button
              key={g}
              className={`perform-group-btn ${activeGroup === g ? 'active' : ''}`}
              onClick={() => setActiveGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>

        {/* Transport bar */}
        <div className="perform-transport">
          <button
            className={`transport-btn ${isPlaying ? 'active' : ''}`}
            onClick={togglePlay}
            title={isPlaying ? 'Stop' : 'Play'}
          >
            {isPlaying ? '\u25A0' : '\u25B6'}
          </button>

          {editingBpm ? (
            <input
              className="transport-bpm-input"
              type="number"
              min={20}
              max={300}
              value={bpmInput}
              onChange={e => setBpmInput(e.target.value)}
              onBlur={handleBpmCommit}
              onKeyDown={e => { if (e.key === 'Enter') handleBpmCommit() }}
              autoFocus
            />
          ) : (
            <button
              className="transport-bpm"
              onClick={() => { setBpmInput(String(perf.bpm)); setEditingBpm(true) }}
              title="Click to edit BPM"
            >
              {perf.bpm} BPM
            </button>
          )}

          <button
            className="transport-quantize"
            onClick={cycleQuantize}
            title="Cycle quantize mode"
          >
            Q: {perf.quantize.toUpperCase()}
          </button>

          <button
            className={`transport-btn record ${recordArm ? 'armed' : ''}`}
            onClick={() => setRecordArm(!recordArm)}
            title="Record arm"
          >
            {'\u25CF'}
          </button>
        </div>

        {/* 4x3 pad grid */}
        <div className="perform-pad-grid">
          {PAD_GRID.map(({ group, pads }) => (
            pads.map(({ label, idx }) => {
              const sound = padSounds[idx]
              return (
                <PerformPad
                  key={idx}
                  label={label}
                  padIdx={idx}
                  sound={sound}
                  bankColor={bankColor}
                  isActiveGroup={activeGroup === group}
                  isQueued={queuedPads.has(idx)}
                  onPadClick={handlePadClick}
                />
              )
            })
          ))}
        </div>
      </div>

      {/* Center: Scene launcher */}
      <div className="perform-scenes">
        <div className="perform-section-header">
          <span>SCENES</span>
          <button className="perform-add-btn" onClick={createScene} title="Capture current state as scene">
            +
          </button>
        </div>

        <div className="scene-list">
          {workspace.scenes.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 16px' }}>
              <div className="empty-state-icon" style={{ fontSize: 24 }}>
                <span style={{ opacity: 0.3 }}>&#9654;</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>Create your first scene</div>
              <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>
                Captures current pad state
              </div>
            </div>
          ) : (
            workspace.scenes.map(scene => (
              <div
                key={scene.id}
                className={`scene-item ${perf.activeSceneId === scene.id ? 'active' : ''}`}
                onClick={() => launchScene(scene)}
                onContextMenu={e => { e.preventDefault(); deleteScene(scene.id) }}
              >
                <span className="scene-item-name">{scene.name}</span>
                <span className="scene-item-meta">
                  {Object.keys(scene.padStates).length} pads
                </span>
                <button
                  className="scene-delete-btn"
                  onClick={e => { e.stopPropagation(); deleteScene(scene.id) }}
                  title="Delete scene"
                >
                  &times;
                </button>
                <button
                  className="scene-launch-btn"
                  onClick={e => { e.stopPropagation(); launchScene(scene) }}
                  title="Launch scene"
                >
                  &#9654;
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: Fader bank */}
      <div className="perform-faders">
        <div className="perform-section-header">
          <span>FADERS</span>
        </div>

        {/* Fader bank selector */}
        <div className="fader-bank-selector">
          {(['mixer', 'macros', 'sample'] as FaderBankMode[]).map(mode => (
            <button
              key={mode}
              className={`fader-bank-tab ${faderBank === mode ? 'active' : ''}`}
              onClick={() => setFaderBank(mode)}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>

        {/* 6 faders */}
        <div className="fader-bank">
          {faderLabels[faderBank].map((label, i) => (
            <Fader
              key={`${faderBank}-${i}`}
              label={label}
              value={faderValues[i]}
              onChange={val => {
                setFaderValues(prev => {
                  const next = [...prev]
                  next[i] = val
                  return next
                })
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Perform Pad ──────────────────────────────────────────────

function PerformPad({
  label,
  padIdx,
  sound,
  bankColor,
  isActiveGroup,
  isQueued,
  onPadClick,
}: {
  label: string
  padIdx: number
  sound: SoundEntry | null
  bankColor: string
  isActiveGroup: boolean
  isQueued: boolean
  onPadClick: (sound: SoundEntry, padIdx: number) => void
}) {
  const dispatch = useDispatch()
  const [dragOver, setDragOver] = useState(false)
  const occupied = sound !== null

  const handleClick = () => {
    if (!occupied) return
    onPadClick(sound, padIdx)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const nodeIdStr = e.dataTransfer.getData('text/x-sound-node-id')
    if (!nodeIdStr) return
    window.dispatchEvent(new CustomEvent('ko:assignPad', { detail: { nodeId: Number(nodeIdStr), padIndex: 0 } }))
  }, [])

  const displayName = sound?.name?.replace(/\.[^.]+$/, '')

  return (
    <button
      className={[
        'perform-pad',
        occupied ? 'occupied' : '',
        dragOver ? 'drag-over' : '',
        sound?.isPlaying ? 'playing' : '',
        !isActiveGroup ? 'dimmed' : '',
        isQueued ? 'queued' : '',
      ].filter(Boolean).join(' ')}
      style={occupied ? { borderColor: bankColor + '80' } : undefined}
      onClick={handleClick}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      title={displayName ?? `Pad ${label} (empty)`}
    >
      <span className="perform-pad-label">{label}</span>
      {displayName && (
        <span className="perform-pad-name">{displayName}</span>
      )}
      {sound?.isPlaying && (
        <span className="perform-pad-playing-indicator" />
      )}
      {isQueued && (
        <span className="perform-pad-queued-indicator" />
      )}
      {!!sound?.meta?.loop && (
        <span className="perform-pad-loop-icon" title="Looping">&#8634;</span>
      )}
    </button>
  )
}

// ── Fader ────────────────────────────────────────────────────

function Fader({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (val: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const updateFromMouse = useCallback((clientY: number) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const pct = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    onChange(Math.round(pct * 100))
  }, [onChange])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    updateFromMouse(e.clientY)

    const onMove = (ev: MouseEvent) => updateFromMouse(ev.clientY)
    const onUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [updateFromMouse])

  const fillHeight = `${value}%`
  const thumbBottom = `${value}%`

  return (
    <div className={`fader ${dragging ? 'dragging' : ''}`}>
      <div className="fader-label">{label}</div>
      <div className="fader-track" ref={trackRef} onMouseDown={handleMouseDown}>
        <div className="fader-fill" style={{ height: fillHeight }} />
        <div className="fader-thumb" style={{ bottom: thumbBottom }} />
      </div>
      <div className="fader-value">{value}</div>
    </div>
  )
}
