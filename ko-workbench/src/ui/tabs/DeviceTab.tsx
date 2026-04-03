import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore, useDispatch } from '../../store'
import { DevicePanel } from '../components/DevicePanel'
import { SoundLibrary } from '../panels/SoundLibrary'
import { BankTabs } from '../components/BankTabs'

export function DeviceTab() {
  const [showPacks, setShowPacks] = useState(false)

  return (
    <div className="device-tab-layout">
      <DevicePanel />

      {showPacks ? (
        <PacksBrowser onClose={() => setShowPacks(false)} />
      ) : (
        <SoundLibrary />
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <button
          className="btn btn-sm"
          style={{ margin: '20px 6px 4px', fontSize: 9, letterSpacing: 1 }}
          onClick={() => setShowPacks(p => !p)}
        >
          {showPacks ? 'LIBRARY' : 'PACKS'}
        </button>
        <BankTabs />
      </div>
    </div>
  )
}

interface PackInfo { name: string; path: string }
interface AudioFile { name: string; path: string; size: number }

function PacksBrowser({ onClose }: { onClose: () => void }) {
  const { state } = useStore()
  const dispatch = useDispatch()
  const [packs, setPacks] = useState<PackInfo[]>([])
  const [selectedPack, setSelectedPack] = useState<PackInfo | null>(null)
  const [files, setFiles] = useState<AudioFile[]>([])
  const [loading, setLoading] = useState(true)
  const [playingFile, setPlayingFile] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const audioRef = useRef<{ stop: () => void } | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const samplesDir = await window.electronAPI.samplesPath()
        console.log('[Packs] samples path:', samplesDir)
        const dirs = await window.electronAPI.listDirs(samplesDir)
        console.log('[Packs] found packs:', dirs)
        setPacks(dirs)
      } catch (e) {
        console.error('Failed to load packs:', e)
        setStatusMsg('Error loading packs: ' + String(e))
      }
      setLoading(false)
    })()
  }, [])

  useEffect(() => {
    if (!selectedPack) { setFiles([]); return }
    (async () => {
      const audioFiles = await window.electronAPI.listAudioFiles(selectedPack.path)
      console.log('[Packs] files in', selectedPack.name, ':', audioFiles.length)
      setFiles(audioFiles)
    })()
  }, [selectedPack])

  useEffect(() => {
    return () => { audioRef.current?.stop() }
  }, [])

  const previewFile = async (f: AudioFile) => {
    audioRef.current?.stop()
    audioRef.current = null

    if (playingFile === f.path) {
      setPlayingFile(null)
      return
    }

    try {
      const buffer = await window.electronAPI.readFile(f.path)
      const ctx = new AudioContext()
      const audioBuffer = await ctx.decodeAudioData(buffer.slice(0))
      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)
      source.start()
      source.onended = () => {
        setPlayingFile(null)
        audioRef.current = null
        ctx.close()
      }
      audioRef.current = {
        stop: () => {
          try { source.stop() } catch { /* already stopped */ }
          ctx.close()
        }
      }
      setPlayingFile(f.path)
    } catch (e) {
      console.error('Preview failed:', e)
      setPlayingFile(null)
      setStatusMsg('Preview failed: ' + String(e))
    }
  }

  const loadFileToQueue = async (f: AudioFile) => {
    if (!state.device) {
      setStatusMsg('Connect EP-133 to KO Studio first (close EP Sample Tool if open)')
      return
    }
    try {
      const buffer = await window.electronAPI.readFile(f.path)
      const blob = new Blob([buffer], { type: 'audio/wav' })
      const file = new File([blob], f.name, { type: 'audio/wav' })
      dispatch({
        type: 'ENQUEUE_UPLOAD',
        job: {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          status: 'queued',
          progress: 0,
        },
      })
      setStatusMsg(`Queued: ${f.name}`)
    } catch (e) {
      console.error(`Failed to load ${f.name}:`, e)
      setStatusMsg(`Failed: ${f.name} — ${e}`)
    }
  }

  const loadAllToQueue = async () => {
    if (!state.device) {
      setStatusMsg('Connect EP-133 to KO Studio first (close EP Sample Tool if open)')
      return
    }
    setStatusMsg(`Loading ${files.length} files...`)
    for (const f of files) {
      await loadFileToQueue(f)
    }
    setStatusMsg(`Queued ${files.length} files for upload`)
  }

  // Drag start handler — allows dragging pack files to Sample Lab or external apps
  const handleDragStart = useCallback((e: React.DragEvent, f: AudioFile) => {
    e.dataTransfer.setData('text/x-pack-file-path', f.path)
    e.dataTransfer.setData('text/x-pack-file-name', f.name)
    e.dataTransfer.effectAllowed = 'copy'
  }, [])

  return (
    <div className="library-panel">
      <div className="library-header">
        <span>SAMPLE PACKS</span>
        <span style={{ cursor: 'pointer', fontSize: 13 }} onClick={onClose} title="Back to library">x</span>
      </div>

      {/* Status message */}
      {statusMsg && (
        <div style={{
          padding: '4px 8px', fontSize: 10,
          background: statusMsg.includes('Error') || statusMsg.includes('Failed') || statusMsg.includes('Connect')
            ? 'rgba(178,46,32,0.1)' : 'rgba(0,166,156,0.1)',
          color: statusMsg.includes('Error') || statusMsg.includes('Failed') || statusMsg.includes('Connect')
            ? 'var(--danger)' : 'var(--accent2)',
          borderBottom: '1px solid var(--lib-border)',
          cursor: 'pointer',
        }} onClick={() => setStatusMsg(null)}>
          {statusMsg}
        </div>
      )}

      {loading ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : !selectedPack ? (
        <div className="library-list">
          {packs.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-mid)', fontSize: 11, lineHeight: 1.8 }}>
              No packs found.<br />
              Add folders to:<br />
              <code style={{ fontSize: 9, background: 'var(--lib-row-alt)', padding: '2px 6px', borderRadius: 2 }}>
                ko-workbench/samples/
              </code>
            </div>
          ) : (
            packs.map(pack => (
              <div
                key={pack.path}
                className="library-row"
                style={{ cursor: 'pointer', padding: '8px 12px' }}
                onClick={() => setSelectedPack(pack)}
              >
                <span style={{ marginRight: 8, fontSize: 11 }}>+</span>
                <span className="library-row-name" style={{ fontWeight: 'bold' }}>{pack.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-mid)', marginLeft: 'auto' }}>→</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="library-list">
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 8px', background: 'var(--lib-header)',
            borderBottom: '1px solid var(--lib-border)',
            position: 'sticky', top: 0, zIndex: 1,
          }}>
            <span
              style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-mid)' }}
              onClick={() => { audioRef.current?.stop(); setSelectedPack(null); setPlayingFile(null) }}
            >←</span>
            <span style={{ fontSize: 10, fontWeight: 'bold', letterSpacing: 1, flex: 1 }}>
              {selectedPack.name}
            </span>
            <button
              className="btn btn-sm btn-primary"
              style={{ fontSize: 9 }}
              onClick={loadAllToQueue}
              title={state.device ? 'Upload all to device' : 'Connect device first'}
            >
              LOAD ALL ({files.length})
            </button>
          </div>

          {files.map((f, i) => {
            const isPlaying = playingFile === f.path
            return (
              <div
                key={f.path}
                className={`library-row ${isPlaying ? 'playing' : ''}`}
                style={{ cursor: 'pointer' }}
                draggable
                onDragStart={e => handleDragStart(e, f)}
              >
                <span className="library-row-num">{i + 1}</span>

                <span
                  style={{
                    width: 20, textAlign: 'center', cursor: 'pointer',
                    color: isPlaying ? 'var(--accent)' : 'var(--text-mid)',
                    fontSize: 11, flexShrink: 0,
                  }}
                  onClick={() => previewFile(f)}
                  title={isPlaying ? 'Stop' : 'Play preview'}
                >
                  {isPlaying ? '■' : '▶'}
                </span>

                <span className="library-row-name" onClick={() => previewFile(f)}>
                  {f.name.replace(/\.[^.]+$/, '')}
                </span>

                <span
                  style={{
                    fontSize: 9, color: 'var(--accent2)', cursor: 'pointer',
                    flexShrink: 0, padding: '0 4px',
                  }}
                  onClick={() => loadFileToQueue(f)}
                  title="Upload to device"
                >
                  ↑
                </span>

                <span className="library-row-dur" style={{ fontSize: 9 }}>
                  {(f.size / 1024).toFixed(0)}KB
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
