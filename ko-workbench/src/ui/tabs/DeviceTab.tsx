import { useState, useEffect, useRef } from 'react'
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
  const audioRef = useRef<{ stop: () => void } | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const samplesDir = await window.electronAPI.samplesPath()
        const dirs = await window.electronAPI.listDirs(samplesDir)
        setPacks(dirs)
      } catch (e) {
        console.error('Failed to load packs:', e)
      }
      setLoading(false)
    })()
  }, [])

  useEffect(() => {
    if (!selectedPack) { setFiles([]); return }
    (async () => {
      const audioFiles = await window.electronAPI.listAudioFiles(selectedPack.path)
      setFiles(audioFiles)
    })()
  }, [selectedPack])

  // Cleanup audio on unmount
  useEffect(() => {
    return () => { audioRef.current?.stop() }
  }, [])

  const previewFile = async (f: AudioFile) => {
    // Stop current preview
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
    }
  }

  const loadAllToQueue = async () => {
    for (const f of files) {
      await loadOneToQueue(f)
    }
  }

  const loadOneToQueue = async (f: AudioFile) => {
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
    } catch (e) {
      console.error(`Failed to load ${f.name}:`, e)
    }
  }

  return (
    <div className="library-panel">
      <div className="library-header">
        <span>SAMPLE PACKS</span>
        <span style={{ cursor: 'pointer', fontSize: 13 }} onClick={onClose} title="Back to library">x</span>
      </div>

      {loading ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : !selectedPack ? (
        <div className="library-list">
          {packs.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-mid)', fontSize: 11 }}>
              No packs found in samples/ directory
            </div>
          ) : (
            packs.map(pack => (
              <div
                key={pack.path}
                className="library-row"
                style={{ cursor: 'pointer', padding: '8px 12px' }}
                onClick={() => setSelectedPack(pack)}
              >
                <span style={{ fontSize: 14, marginRight: 8 }}>📁</span>
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
              disabled={!state.device}
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
              >
                <span className="library-row-num">{i + 1}</span>

                {/* Play/stop button */}
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

                {/* Name — click to preview */}
                <span
                  className="library-row-name"
                  onClick={() => previewFile(f)}
                >
                  {f.name.replace(/\.[^.]+$/, '')}
                </span>

                {/* Upload button */}
                <span
                  style={{
                    fontSize: 9, color: 'var(--accent2)', cursor: 'pointer',
                    flexShrink: 0, padding: '0 4px',
                    opacity: state.device ? 1 : 0.3,
                  }}
                  onClick={() => state.device && loadOneToQueue(f)}
                  title={state.device ? 'Upload to device' : 'Connect device first'}
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
