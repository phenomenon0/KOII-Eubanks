import { useStore, useDispatch } from '../../store'
import { Waveform } from '../components/Waveform'

const EMPTY_WAVEFORM = new Float32Array(0)

export function DetailPanel() {
  const { state } = useStore()
  const dispatch = useDispatch()

  const sound = state.sounds.find(s => s.nodeId === state.selectedSoundId)

  if (!sound) {
    return (
      <div className="right-panel">
        <div className="empty-state" style={{ height: '200px' }}>
          <div className="empty-state-icon">◇</div>
          <div>Select a sound</div>
        </div>
        <UploadQueue />
      </div>
    )
  }

  const waveform = sound.waveform ?? EMPTY_WAVEFORM

  return (
    <div className="right-panel">
      <div className="detail-panel">
        <div className="detail-title" title={sound.name}>{sound.name}</div>

        {/* Waveform */}
        <div className="waveform-container" style={{ marginBottom: 12 }}>
          {waveform.length > 0
            ? <Waveform data={waveform} height={80} />
            : <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 11 }}>No preview</div>
          }
        </div>

        {/* Metadata rows */}
        <div className="detail-row">
          <span className="detail-key">BANK</span>
          <span className="detail-val">{sound.bank}</span>
        </div>
        <div className="detail-row">
          <span className="detail-key">RATE</span>
          <span className="detail-val">{sound.sampleRate?.toLocaleString()} Hz</span>
        </div>
        {sound.channels != null && (
          <div className="detail-row">
            <span className="detail-key">CH</span>
            <span className="detail-val">{sound.channels === 1 ? 'Mono' : 'Stereo'}</span>
          </div>
        )}
        {sound.durationSec != null && (
          <div className="detail-row">
            <span className="detail-key">DUR</span>
            <span className="detail-val">{sound.durationSec.toFixed(2)}s</span>
          </div>
        )}
        {sound.sizeBytes != null && (
          <div className="detail-row">
            <span className="detail-key">SIZE</span>
            <span className="detail-val">{(sound.sizeBytes / 1024).toFixed(0)} KB</span>
          </div>
        )}
        {sound.meta['sound.rootnote'] != null && (
          <div className="detail-row">
            <span className="detail-key">ROOT</span>
            <span className="detail-val">{midiNoteToName(sound.meta['sound.rootnote'] as number)}</span>
          </div>
        )}
        {sound.meta['sound.bpm'] != null && (
          <div className="detail-row">
            <span className="detail-key">BPM</span>
            <span className="detail-val">{String(sound.meta['sound.bpm'])}</span>
          </div>
        )}

        {/* Actions */}
        <div className="detail-actions">
          <button
            className="btn btn-sm"
            title="Play on device"
            disabled={!state.device}
            onClick={() => {
              // Trigger playback event — handled by DeviceController
              window.dispatchEvent(new CustomEvent('ko:playSound', { detail: { nodeId: sound.nodeId } }))
            }}
          >
            ▶ Play
          </button>
          <button
            className="btn btn-sm"
            title="Export as WAV"
            disabled={!state.device}
            onClick={() => {
              window.dispatchEvent(new CustomEvent('ko:exportSound', { detail: { nodeId: sound.nodeId } }))
            }}
          >
            ↓ Export
          </button>
          <button
            className="btn btn-sm btn-danger"
            title="Delete from device"
            disabled={!state.device}
            onClick={() => {
              if (confirm(`Delete "${sound.name}" from device?`)) {
                window.dispatchEvent(new CustomEvent('ko:deleteSound', { detail: { nodeId: sound.nodeId } }))
              }
            }}
          >
            ✕ Delete
          </button>
        </div>
      </div>

      <UploadQueue />
    </div>
  )
}

function midiNoteToName(note: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`
}

function UploadQueue() {
  const { state } = useStore()
  const dispatch = useDispatch()

  if (state.uploadQueue.length === 0) return null

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
      <div className="sidebar-header" style={{ padding: '4px 12px 6px' }}>UPLOAD QUEUE</div>
      <div className="upload-queue">
        {state.uploadQueue.map(job => (
          <div key={job.id} className="upload-item">
            <div className="upload-item-name" title={job.file.name}>
              {job.file.name.replace(/\.[^.]+$/, '')}
            </div>
            <div className="upload-progress-bar">
              <div
                className="upload-progress-fill"
                style={{ width: `${job.progress}%` }}
              />
            </div>
            <div className={`upload-status ${job.status === 'error' ? 'error' : job.status === 'done' ? 'done' : ''}`}>
              {job.status === 'queued'     && 'Queued'}
              {job.status === 'processing' && 'Converting...'}
              {job.status === 'uploading'  && `Uploading ${job.progress}%`}
              {job.status === 'done'       && '✓ Done'}
              {job.status === 'error'      && `✗ ${job.error ?? 'Error'}`}
            </div>
            {(job.status === 'done' || job.status === 'error') && (
              <button
                className="btn btn-sm"
                style={{ marginTop: 4, fontSize: 10, padding: '2px 6px' }}
                onClick={() => dispatch({ type: 'REMOVE_UPLOAD', id: job.id })}
              >
                Dismiss
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
