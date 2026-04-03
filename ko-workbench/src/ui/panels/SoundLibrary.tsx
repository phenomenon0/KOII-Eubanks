import { useCallback, useRef, useState } from 'react'
import { useStore, useDispatch, SoundEntry } from '../../store'
import { BANKS } from '../../protocol/types'

const BANK_COLORS: Record<string, string> = {
  KICK:     '#8C959F', SNARE:  '#82C9EC', CYMB:   '#82EC88',
  PERC:     '#FAFF4A', BASS:   '#47F3E3', MELOD:  '#F45050',
  LOOP:     '#A475F9', 'USER 1': '#EE86E6', 'USER 2': '#FFAA00',
  SFX:      '#B88552',
}

export function SoundLibrary() {
  const { state } = useStore()
  const dispatch = useDispatch()
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('audio/') || /\.(wav|mp3|aif|aiff|flac|ogg)$/i.test(f.name))
    if (files.length > 0) queueFiles(files, dispatch)
  }, [])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    if (files.length > 0) queueFiles(files, dispatch)
    e.target.value = ''
  }

  // Group sounds by bank
  const soundsByBank = new Map<string, SoundEntry[]>()
  for (const b of BANKS) soundsByBank.set(b.name, [])
  for (const s of state.sounds) {
    const arr = soundsByBank.get(s.bank)
    if (arr) arr.push(s)
    else soundsByBank.set(s.bank, [s])
  }

  const selectedBank = state.selectedBank
  const banksToShow = selectedBank
    ? [{ name: selectedBank, sounds: soundsByBank.get(selectedBank) ?? [] }]
    : BANKS.map(b => ({ name: b.name, sounds: soundsByBank.get(b.name) ?? [] }))
      .filter(b => b.sounds.length > 0)

  return (
    <div className="library-panel">
      {/* Header */}
      <div className="library-header">
        <span>SAMPLE LIBRARY</span>
        <div className="library-header-icons">
          <span
            style={{ cursor: 'pointer' }}
            title="Delete all sounds"
            onClick={() => window.dispatchEvent(new CustomEvent('ko:deleteAll'))}
          >✕</span>
          <span
            style={{ cursor: 'pointer' }}
            title="Upload sounds"
            onClick={() => fileInputRef.current?.click()}
          >+</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.aif,.aiff,.flac,.ogg"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileInput}
          />
        </div>
      </div>

      {/* Sound list organized by bank */}
      {!state.device ? (
        <div className="empty-state" style={{ color: 'var(--text-mid)' }}>
          <div style={{ fontSize: 11 }}>Connect EP-133 via USB-C</div>
        </div>
      ) : state.isSyncing ? (
        <div className="empty-state">
          <div className="spinner" />
        </div>
      ) : (
        <div className="library-list"
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {dragOver && (
            <div className="library-drop-zone drag-over" style={{ margin: 4 }}>
              Drop audio files to upload
            </div>
          )}

          {banksToShow.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-mid)', fontSize: 11 }}>
              {selectedBank ? `No ${selectedBank} sounds` : 'No sounds on device'}
            </div>
          ) : (
            banksToShow.map(({ name, sounds }) => (
              <BankSection
                key={name}
                bankName={name}
                sounds={sounds}
                selectedSoundId={state.selectedSoundId}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function BankSection({ bankName, sounds, selectedSoundId }: {
  bankName: string
  sounds: SoundEntry[]
  selectedSoundId: number | null
}) {
  const color = BANK_COLORS[bankName] ?? '#999'

  return (
    <div>
      {/* Bank header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 8px',
        background: color + '30',
        borderBottom: `2px solid ${color}`,
        position: 'sticky', top: 0, zIndex: 1,
      }}>
        <span style={{
          display: 'inline-block', width: 8, height: 8,
          borderRadius: '50%', background: color,
        }} />
        <span style={{ fontSize: 10, fontWeight: 'bold', letterSpacing: 1, color: 'var(--text-dark)' }}>
          {bankName}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-mid)', marginLeft: 'auto' }}>
          {sounds.length}
        </span>
      </div>

      {/* Sound rows */}
      {sounds.map((sound, i) => (
        <LibraryRow
          key={sound.nodeId}
          sound={sound}
          index={i + 1}
          selected={sound.nodeId === selectedSoundId}
        />
      ))}
    </div>
  )
}

function LibraryRow({ sound, index, selected }: { sound: SoundEntry; index: number; selected: boolean }) {
  const dispatch = useDispatch()
  const bankColor = BANK_COLORS[sound.bank] ?? '#999'
  const padIndex = typeof sound.meta?.sym === 'number' ? sound.meta.sym as number : null

  const handleClick = () => {
    dispatch({ type: 'SELECT_SOUND', nodeId: sound.nodeId })
    // Toggle play/stop
    if (sound.isPlaying) {
      window.dispatchEvent(new CustomEvent('ko:stopSound', { detail: { nodeId: sound.nodeId } }))
    } else {
      window.dispatchEvent(new CustomEvent('ko:playSound', { detail: { nodeId: sound.nodeId } }))
    }
  }

  return (
    <div
      className={`library-row ${selected ? 'selected' : ''} ${sound.isPlaying ? 'playing' : ''}`}
      onClick={handleClick}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/x-sound-node-id', String(sound.nodeId))
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      <span className="library-row-num">{index}</span>
      <span className="library-row-indicator" style={{ background: bankColor }} />
      <span className="library-row-name">{sound.name.replace(/\.[^.]+$/, '')}</span>
      {padIndex !== null && (
        <span style={{
          fontSize: 8, padding: '1px 4px', borderRadius: 2,
          background: 'var(--accent2)', color: '#fff', marginLeft: 4,
          flexShrink: 0,
        }}>
          P{padIndex + 1}
        </span>
      )}
      <span className="library-row-dur">
        {sound.durationSec != null ? `${sound.durationSec.toFixed(1)}s` : ''}
      </span>
    </div>
  )
}

function queueFiles(files: File[], dispatch: ReturnType<typeof useDispatch>) {
  for (const file of files) {
    dispatch({
      type: 'ENQUEUE_UPLOAD',
      job: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        status: 'queued',
        progress: 0,
      },
    })
  }
}
