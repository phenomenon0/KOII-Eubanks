import { useState, useCallback } from 'react'
import { useStore, useDispatch } from '../../store'
import { BANKS } from '../../protocol/types'

const BANK_COLORS: Record<string, string> = {
  KICK: '#e74c3c', SNARE: '#e67e22', CYMB: '#f1c40f', PERC: '#2ecc71',
  BASS: '#1abc9c', MELOD: '#3498db', LOOP: '#9b59b6',
  'USER 1': '#e91e63', 'USER 2': '#ff5722', SFX: '#607d8b',
}

const PADS_PER_BANK = 12

export function PadMatrix() {
  const { state } = useStore()
  const dispatch = useDispatch()

  // Default to first bank if none selected
  const currentBank = state.selectedBank ?? BANKS[0].name
  const bankColor = BANK_COLORS[currentBank] ?? '#666'

  // Get sounds in current bank, build pad→sound map from sym field
  const bankSounds = state.sounds.filter(s => s.bank === currentBank)
  const padMap = new Map<number, typeof bankSounds[0]>()
  for (const sound of bankSounds) {
    const sym = sound.meta?.sym
    if (typeof sym === 'number' && sym >= 0 && sym < PADS_PER_BANK) {
      padMap.set(sym, sound)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: bankColor }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>{currentBank}</span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>
          {padMap.size}/{PADS_PER_BANK} pads assigned
        </span>
        {padMap.size > 0 && (
          <button
            className="btn btn-sm"
            style={{ marginLeft: 'auto', fontSize: 10 }}
            onClick={() => {
              for (const [, sound] of padMap) {
                window.dispatchEvent(new CustomEvent('ko:clearPad', { detail: { nodeId: sound.nodeId } }))
              }
            }}
          >
            Clear All
          </button>
        )}
      </div>

      {/* 4×3 Pad Grid */}
      <div className="pad-grid">
        {Array.from({ length: PADS_PER_BANK }, (_, i) => (
          <PadCell
            key={i}
            padIndex={i}
            sound={padMap.get(i) ?? null}
            bankColor={bankColor}
            selectedSoundId={state.selectedSoundId}
            allSounds={state.sounds}
          />
        ))}
      </div>

      {/* Help text */}
      <div style={{ marginTop: 'auto', padding: '12px 0', fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
        <div>Drag a sound from the library onto a pad to assign it.</div>
        <div>Click a pad to play its sound. Right-click to clear.</div>
        {state.selectedSoundId && (
          <div style={{ color: 'var(--accent)', marginTop: 4 }}>
            Sound selected — click an empty pad to assign it.
          </div>
        )}
      </div>
    </div>
  )
}

function PadCell({
  padIndex,
  sound,
  bankColor,
  selectedSoundId,
  allSounds,
}: {
  padIndex: number
  sound: { nodeId: number; name: string; isPlaying: boolean } | null
  bankColor: string
  selectedSoundId: number | null
  allSounds: { nodeId: number }[]
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
    const nodeId = Number(nodeIdStr)
    window.dispatchEvent(new CustomEvent('ko:assignPad', { detail: { nodeId, padIndex } }))
  }, [padIndex])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])

  const handleClick = () => {
    if (occupied) {
      // Play/stop the sound on the device
      if (sound.isPlaying) {
        window.dispatchEvent(new CustomEvent('ko:stopSound', { detail: { nodeId: sound.nodeId } }))
      } else {
        window.dispatchEvent(new CustomEvent('ko:playSound', { detail: { nodeId: sound.nodeId } }))
      }
      dispatch({ type: 'SELECT_SOUND', nodeId: sound.nodeId })
    } else if (selectedSoundId !== null) {
      // Click-to-assign: assign the currently selected sound
      window.dispatchEvent(new CustomEvent('ko:assignPad', { detail: { nodeId: selectedSoundId, padIndex } }))
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (occupied) {
      window.dispatchEvent(new CustomEvent('ko:clearPad', { detail: { nodeId: sound.nodeId } }))
    }
  }

  const displayName = sound
    ? sound.name.replace(/\.(wav|aif|aiff|mp3|flac|ogg)$/i, '')
    : null

  return (
    <div
      className={[
        'pad-cell',
        occupied ? 'occupied' : '',
        dragOver ? 'drag-over' : '',
        isSelected ? 'selected' : '',
        sound?.isPlaying ? 'playing' : '',
      ].filter(Boolean).join(' ')}
      style={occupied ? { borderColor: bankColor + '80' } : undefined}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <span className="pad-number">{padIndex + 1}</span>
      {displayName ? (
        <span className="pad-name">{displayName}</span>
      ) : (
        <span className="pad-empty">
          {selectedSoundId ? '+' : ''}
        </span>
      )}
    </div>
  )
}
