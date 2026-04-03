import { useState, useCallback } from 'react'
import { useStore, useDispatch, SoundEntry } from '../../store'
import { BANKS } from '../../protocol/types'
import { Waveform } from './Waveform'
import { MemoryMeter } from './MemoryMeter'

const BANK_COLORS: Record<string, string> = {
  KICK:     '#8C959F', SNARE:  '#82C9EC', CYMB:   '#82EC88',
  PERC:     '#FAFF4A', BASS:   '#47F3E3', MELOD:  '#F45050',
  LOOP:     '#A475F9', 'USER 1': '#EE86E6', 'USER 2': '#FFAA00',
  SFX:      '#B88552',
}

// EP-133 hardware: 4 groups (A-D) per project, 12 pads per group
// Button grid maps button labels → pad indices (0-11)
// Row 1: A(group) 7→pad00 8→pad01 9→pad02
// Row 2: B(group) 4→pad03 5→pad04 6→pad05
// Row 3: C(group) 1→pad06 2→pad07 3→pad08
// Row 4: D(group) .→pad09 0→pad10 ENT→pad11
const PAD_GRID = [
  { group: 'A', pads: [{ label: '7', idx: 0 }, { label: '8', idx: 1 }, { label: '9', idx: 2 }] },
  { group: 'B', pads: [{ label: '4', idx: 3 }, { label: '5', idx: 4 }, { label: '6', idx: 5 }] },
  { group: 'C', pads: [{ label: '1', idx: 6 }, { label: '2', idx: 7 }, { label: '3', idx: 8 }] },
  { group: 'D', pads: [{ label: '.', idx: 9 }, { label: '0', idx: 10 }, { label: 'ENT', idx: 11 }] },
]

const GROUPS = ['A', 'B', 'C', 'D'] as const

export function DevicePanel() {
  const { state } = useStore()
  const dispatch = useDispatch()
  const [activeGroup, setActiveGroup] = useState<string>('A')

  const currentBank = state.selectedBank ?? BANKS[0].name
  const bankColor = BANK_COLORS[currentBank] ?? '#999'
  const bankSounds = state.sounds.filter(s => s.bank === currentBank)
  const selectedSound = state.sounds.find(s => s.nodeId === state.selectedSoundId) ?? null
  const isConnected = !!state.device

  // Map pad index → sound (by position in bank)
  const padSounds: (SoundEntry | null)[] = []
  for (let i = 0; i < 12; i++) {
    padSounds.push(bankSounds[i] ?? null)
  }

  return (
    <div className="device-panel">
      <div className="device-body">
        {/* Top accent strip */}
        <div className="device-top-strip">
          <div className="device-usb" />
          <div className="device-accent-strip" />
        </div>

        {/* Header: branding + status */}
        <div className="device-header">
          <div>
            <div className="device-brand">K.O.II</div>
            <div className="device-brand-sub">サンプラー</div>
          </div>
          <div className="device-status-area">
            <div className={`device-status-dot ${isConnected ? 'connected' : state.deviceError ? 'error' : ''}`} />
            <span className="device-status-text">
              {isConnected ? state.device!.name : state.isMidiScanning ? 'Scanning...' : 'No device'}
            </span>
          </div>
        </div>

        {/* Display / screen */}
        <div className="device-display">
          <div className="device-display-content">
            <span className="display-label">Sound Edit</span>
            <div className="display-waveform">
              {selectedSound?.waveform && (
                <Waveform data={selectedSound.waveform} color="#01A79D" />
              )}
            </div>
            <div className="display-info">
              <span>{selectedSound?.name?.replace(/\.[^.]+$/, '') ?? '---'}</span>
              <span>{selectedSound?.durationSec ? `${selectedSound.durationSec.toFixed(1)}s` : ''}</span>
            </div>
            <div className="display-markers">
              <span className="display-marker in">IN</span>
              <span className="display-marker out">OUT</span>
            </div>
          </div>
        </div>

        {/* Bank badge + Knobs */}
        <div className="device-knobs">
          <span style={{
            fontSize: 10, fontWeight: 'bold', padding: '2px 8px',
            background: bankColor, borderRadius: 3, color: 'var(--text-dark)',
          }}>
            {currentBank}
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-mid)', marginLeft: 4 }}>
            GRP {activeGroup}
          </span>
          <div style={{ flex: 1 }} />
          <div className="knob" title="Volume" />
          <div className="knob-record" title="Backup"
            onClick={() => window.dispatchEvent(new CustomEvent('ko:showBackup'))}
          />
          <div className="knob" title="Tempo" />
        </div>

        {/* Button grid: A/B/C/D groups + 12 pads */}
        <div className="device-buttons">
          {PAD_GRID.map(({ group, pads }) => (
            <div key={group} className="device-btn-row">
              {/* Group button */}
              <button
                className={`device-btn row-label ${activeGroup === group ? 'active-group' : ''}`}
                onClick={() => setActiveGroup(group)}
                title={`Group ${group}`}
              >
                {group}
              </button>
              {/* 3 pad buttons */}
              {pads.map(({ label, idx }) => {
                const sound = padSounds[idx]
                return (
                  <PadButton
                    key={idx}
                    padIndex={idx}
                    label={label}
                    sound={sound}
                    selectedSoundId={state.selectedSoundId}
                    bankColor={bankColor}
                  />
                )
              })}
            </div>
          ))}
        </div>

        {/* Bottom control row */}
        <div className="device-bottom-row">
          <button className="device-ctrl-btn play" title="Play selected"
            onClick={() => {
              if (selectedSound) {
                if (selectedSound.isPlaying) {
                  window.dispatchEvent(new CustomEvent('ko:stopSound', { detail: { nodeId: selectedSound.nodeId } }))
                } else {
                  window.dispatchEvent(new CustomEvent('ko:playSound', { detail: { nodeId: selectedSound.nodeId } }))
                }
              }
            }}
          >▶</button>
          <button className="device-ctrl-btn"
            disabled={state.isSyncing}
            onClick={() => window.dispatchEvent(new CustomEvent('ko:refresh'))}
          >
            {state.isSyncing ? '...' : 'SYNC'}
          </button>
          <button className="device-ctrl-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('ko:showBackup'))}
          >BACKUP</button>
          <button className="device-ctrl-btn" style={{ color: '#B22E20' }}
            onClick={() => window.dispatchEvent(new CustomEvent('ko:deleteAll'))}
          >CLEAR</button>
        </div>

        {/* Memory + footer */}
        <MemoryMeter usedBytes={state.memoryUsedBytes} totalBytes={state.memoryTotalBytes} />

        <div className="device-footer">
          <span>SERIAL: {state.device?.serial?.slice(0, 8) ?? '---'}</span>
          <span>OS: {state.device?.firmware ?? '---'}</span>
        </div>
      </div>
    </div>
  )
}

function PadButton({
  padIndex,
  label,
  sound,
  selectedSoundId,
  bankColor,
}: {
  padIndex: number
  label: string
  sound: SoundEntry | null
  selectedSoundId: number | null
  bankColor: string
}) {
  const dispatch = useDispatch()
  const [dragOver, setDragOver] = useState(false)
  const occupied = sound !== null
  const isSelected = sound && sound.nodeId === selectedSoundId

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const nodeIdStr = e.dataTransfer.getData('text/x-sound-node-id')
    if (!nodeIdStr) return
    window.dispatchEvent(new CustomEvent('ko:assignPad', { detail: { nodeId: Number(nodeIdStr), padIndex } }))
  }, [padIndex])

  const handleClick = () => {
    if (occupied) {
      if (sound.isPlaying) {
        window.dispatchEvent(new CustomEvent('ko:stopSound', { detail: { nodeId: sound.nodeId } }))
      } else {
        window.dispatchEvent(new CustomEvent('ko:playSound', { detail: { nodeId: sound.nodeId } }))
      }
      dispatch({ type: 'SELECT_SOUND', nodeId: sound.nodeId })
    }
  }

  const displayName = sound?.name?.replace(/\.[^.]+$/, '')

  return (
    <button
      className={[
        'device-btn',
        occupied ? 'occupied' : '',
        dragOver ? 'drag-over' : '',
        isSelected ? 'selected' : '',
        sound?.isPlaying ? 'playing' : '',
      ].filter(Boolean).join(' ')}
      style={occupied ? { borderColor: bankColor + '60' } : undefined}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={handleClick}
      title={displayName ?? `Pad ${label} (empty)`}
    >
      <span style={{ fontSize: 11, color: occupied ? 'var(--text-light)' : 'var(--text-faint)' }}>
        {label}
      </span>
      {displayName && (
        <span className="device-btn-name">{displayName}</span>
      )}
    </button>
  )
}
