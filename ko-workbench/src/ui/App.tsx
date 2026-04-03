import { useEffect, useRef, useState } from 'react'
import { useStore, useDispatch } from '../store'
import { DeviceController } from '../DeviceController'
import { PerformTab } from './tabs/PerformTab'
import { SampleTab } from './tabs/SampleTab'
import { PlayTab } from './tabs/PlayTab'
import { DeviceTab } from './tabs/DeviceTab'
import { ControllersTab } from './tabs/ControllersTab'
import { BackupModal } from './modals/BackupModal'
import './styles.css'

type TabId = 'perform' | 'sample' | 'play' | 'device' | 'controllers'

const TABS: { id: TabId; label: string }[] = [
  { id: 'perform', label: 'Perform' },
  { id: 'sample',  label: 'Sample' },
  { id: 'play',    label: 'Play' },
  { id: 'device',  label: 'Device' },
  { id: 'controllers', label: 'Controllers' },
]

export function App() {
  const { state } = useStore()
  const dispatch = useDispatch()
  const controllerRef = useRef<DeviceController | null>(null)
  const [showBackup, setShowBackup] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('device')

  // Init device controller + wire controller bus events to store
  useEffect(() => {
    const ctrl = new DeviceController(dispatch)
    controllerRef.current = ctrl
    ctrl.init().catch(console.error)

    // Bridge ControllerBus events to controllers store + custom event
    const unsubBus = ctrl.controllerBus.onEvent((event) => {
      window.dispatchEvent(new CustomEvent('ko:controllerEvent', { detail: event }))
    })

    return () => {
      unsubBus()
      ctrl.dispose()
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return

      switch (e.key) {
        case '1': setActiveTab('perform'); break
        case '2': setActiveTab('sample'); break
        case '3': setActiveTab('play'); break
        case '4': setActiveTab('device'); break
        case '5': setActiveTab('controllers'); break
        case ' ':
          e.preventDefault()
          // Toggle play on selected sound
          const sel = state.sounds.find(s => s.nodeId === state.selectedSoundId)
          if (sel) {
            const evt = sel.isPlaying ? 'ko:stopSound' : 'ko:playSound'
            window.dispatchEvent(new CustomEvent(evt, { detail: { nodeId: sel.nodeId } }))
          }
          break
        case 'r':
        case 'R':
          if (!e.metaKey && !e.ctrlKey) {
            window.dispatchEvent(new CustomEvent('ko:refresh'))
          }
          break
        case 'b':
        case 'B':
          if (!e.metaKey && !e.ctrlKey) {
            setShowBackup(prev => !prev)
          }
          break
        case 'Escape':
          setShowBackup(false)
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.sounds, state.selectedSoundId])

  // Process upload queue
  useEffect(() => {
    const queued = state.uploadQueue.filter(j => j.status === 'queued')
    if (queued.length === 0 || !state.device) return
    const ctrl = controllerRef.current
    if (!ctrl) return
    const next = queued[0]
    ctrl.processAndUploadFile(next.id, next.file).catch(console.error)
  }, [state.uploadQueue, state.device])

  // Wire global device events
  useEffect(() => {
    const getCtrl = () => controllerRef.current

    const onPlay = (e: Event) => {
      const { nodeId } = (e as CustomEvent).detail
      getCtrl()?.playSound(nodeId)
    }
    const onStop = (e: Event) => {
      const { nodeId } = (e as CustomEvent).detail
      getCtrl()?.stopSound(nodeId)
    }
    const onDelete = async (e: Event) => {
      const { nodeId } = (e as CustomEvent).detail
      try { await getCtrl()?.deleteSound(nodeId) } catch { /* ignore */ }
    }
    const onExport = async (e: Event) => {
      const { nodeId } = (e as CustomEvent).detail
      const c = getCtrl()
      const sound = state.sounds.find(s => s.nodeId === nodeId)
      if (!sound || !c) return
      const blob = await c.exportSound(nodeId, sound.name)
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = sound.name.replace(/\.[^.]+$/, '') + '.wav'
      a.click()
      URL.revokeObjectURL(url)
    }
    const onBackup = async (e: Event) => {
      const { projectsOnly } = (e as CustomEvent).detail
      try { await getCtrl()?.backup({ projectsOnly }) } catch (err) { console.error('Backup failed:', err) }
    }
    const onRestore = async () => {
      try { await getCtrl()?.restore() } catch (err) { console.error('Restore failed:', err) }
    }
    const onBackupProject = async (e: Event) => {
      const { path } = (e as CustomEvent).detail
      try { await getCtrl()?.backupProject(path) } catch (err) { console.error('Project backup failed:', err) }
    }
    const onRestoreProject = async (e: Event) => {
      const { path } = (e as CustomEvent).detail
      try { await getCtrl()?.restoreProject(path) } catch (err) { console.error('Project restore failed:', err) }
    }
    const onAssignPad = async (e: Event) => {
      const { nodeId, padIndex } = (e as CustomEvent).detail
      try { await getCtrl()?.assignPad(nodeId, padIndex) } catch (err) { console.error('Pad assign failed:', err) }
    }
    const onClearPad = async (e: Event) => {
      const { nodeId } = (e as CustomEvent).detail
      try { await getCtrl()?.clearPad(nodeId) } catch (err) { console.error('Pad clear failed:', err) }
    }
    const onShowBackup = () => setShowBackup(true)
    const onRefresh = () => getCtrl()?.refreshLibrary()
    const onDeleteAll = async () => {
      const c = getCtrl()
      console.log('[deleteAll] ctrl:', !!c)
      if (!window.confirm('Delete ALL sounds from device? This cannot be undone.')) return
      try {
        await c?.deleteAllSounds()
        console.log('[deleteAll] complete')
      } catch (err) {
        console.error('Delete all failed:', err)
        alert('Delete failed: ' + err)
      }
    }

    // Controller-specific events from ControllersTab
    const onStartLearn = (e: Event) => {
      const { targetAction } = (e as CustomEvent).detail
      getCtrl()?.startLearnMode(targetAction, (mapping) => {
        window.dispatchEvent(new CustomEvent('ko:learnComplete', { detail: mapping }))
      })
    }
    const onStopLearn = () => {
      getCtrl()?.stopLearnMode()
    }
    const onRemoveMapping = (e: Event) => {
      const { id } = (e as CustomEvent).detail
      getCtrl()?.removeMapping(id)
    }
    const onSetActivePage = (e: Event) => {
      const { page } = (e as CustomEvent).detail
      getCtrl()?.setActivePage(page)
    }
    const onRefreshControllers = () => {
      // Re-init MIDI to re-scan ports
      getCtrl()?.init().catch(console.error)
    }

    window.addEventListener('ko:playSound', onPlay)
    window.addEventListener('ko:stopSound', onStop)
    window.addEventListener('ko:deleteSound', onDelete)
    window.addEventListener('ko:exportSound', onExport)
    window.addEventListener('ko:backup', onBackup)
    window.addEventListener('ko:restore', onRestore)
    window.addEventListener('ko:backupProject', onBackupProject)
    window.addEventListener('ko:restoreProject', onRestoreProject)
    window.addEventListener('ko:assignPad', onAssignPad)
    window.addEventListener('ko:clearPad', onClearPad)
    window.addEventListener('ko:showBackup', onShowBackup)
    window.addEventListener('ko:refresh', onRefresh)
    window.addEventListener('ko:deleteAll', onDeleteAll)
    window.addEventListener('ko:startLearn', onStartLearn)
    window.addEventListener('ko:stopLearn', onStopLearn)
    window.addEventListener('ko:removeMapping', onRemoveMapping)
    window.addEventListener('ko:setActivePage', onSetActivePage)
    window.addEventListener('ko:refreshControllers', onRefreshControllers)

    return () => {
      window.removeEventListener('ko:playSound', onPlay)
      window.removeEventListener('ko:stopSound', onStop)
      window.removeEventListener('ko:deleteSound', onDelete)
      window.removeEventListener('ko:exportSound', onExport)
      window.removeEventListener('ko:backup', onBackup)
      window.removeEventListener('ko:restore', onRestore)
      window.removeEventListener('ko:backupProject', onBackupProject)
      window.removeEventListener('ko:restoreProject', onRestoreProject)
      window.removeEventListener('ko:assignPad', onAssignPad)
      window.removeEventListener('ko:clearPad', onClearPad)
      window.removeEventListener('ko:showBackup', onShowBackup)
      window.removeEventListener('ko:refresh', onRefresh)
      window.removeEventListener('ko:deleteAll', onDeleteAll)
      window.removeEventListener('ko:startLearn', onStartLearn)
      window.removeEventListener('ko:stopLearn', onStopLearn)
      window.removeEventListener('ko:removeMapping', onRemoveMapping)
      window.removeEventListener('ko:setActivePage', onSetActivePage)
      window.removeEventListener('ko:refreshControllers', onRefreshControllers)
    }
  }, [state.sounds])

  // Memory display helpers
  const memUsedMB = (state.memoryUsedBytes / (1024 * 1024)).toFixed(0)
  const memTotalMB = (state.memoryTotalBytes / (1024 * 1024)).toFixed(0)
  const isConnected = !!state.device

  return (
    <div className="app-shell">
      {/* Top bar: logo + tabs */}
      <div className="top-bar">
        <div className="top-bar-logo">KO STUDIO</div>
        <div className="top-bar-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="tab-content">
        {activeTab === 'perform' && <PerformTab />}
        {activeTab === 'sample' && <SampleTab />}
        {activeTab === 'play' && <PlayTab />}
        {activeTab === 'device' && <DeviceTab />}
        {activeTab === 'controllers' && <ControllersTab />}
      </div>

      {/* Bottom transport strip */}
      <div className="transport-strip">
        <div className="transport-group">
          <span className="transport-play-indicator">&#9654;</span>
          <span className="transport-bpm">120 BPM</span>
          <span className="transport-sep">|</span>
          <span className="transport-quantize">Q: 1bar</span>
          <span className="transport-sep">|</span>
          <TapTempo />
          <span className="transport-sep">|</span>
          <span className="transport-rec">&#9679; REC</span>
        </div>
        <div className="transport-group">
          <span className={`transport-device-status ${isConnected ? 'connected' : ''}`}>
            Device: {isConnected ? `${state.device!.name} \u2713` : 'None'}
          </span>
          <span className="transport-sep">|</span>
          <span className="transport-memory">Mem: {memUsedMB}/{memTotalMB}MB</span>
        </div>
      </div>

      {/* Floating upload queue */}
      {state.uploadQueue.length > 0 && <UploadFloat />}

      {/* Backup modal (top-level, triggered by ko:showBackup) */}
      {showBackup && <BackupModal onClose={() => setShowBackup(false)} />}
    </div>
  )
}

function UploadFloat() {
  const { state } = useStore()
  const dispatch = useDispatch()

  return (
    <div className="upload-float">
      <div className="upload-float-header">UPLOAD QUEUE</div>
      {state.uploadQueue.map(job => (
        <div key={job.id} className="upload-item">
          <div className="upload-item-name">{job.file.name}</div>
          <div className="upload-progress-bar">
            <div className="upload-progress-fill" style={{ width: `${job.progress}%` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className={`upload-status ${job.status === 'error' ? 'error' : job.status === 'done' ? 'done' : ''}`}>
              {job.status === 'queued' && 'Queued'}
              {job.status === 'processing' && 'Processing...'}
              {job.status === 'uploading' && `Uploading ${job.progress}%`}
              {job.status === 'done' && 'Done'}
              {job.status === 'error' && (job.error ?? 'Error')}
            </div>
            {(job.status === 'done' || job.status === 'error') && (
              <button
                className="btn btn-sm"
                style={{ padding: '1px 4px', fontSize: 9 }}
                onClick={() => dispatch({ type: 'REMOVE_UPLOAD', id: job.id })}
              >×</button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function TapTempo() {
  const [taps, setTaps] = useState<number[]>([])
  const [displayBpm, setDisplayBpm] = useState<number | null>(null)

  const handleTap = () => {
    const now = performance.now()
    setTaps(prev => {
      const recent = [...prev, now].filter(t => now - t < 4000) // keep last 4s of taps
      if (recent.length >= 2) {
        const intervals: number[] = []
        for (let i = 1; i < recent.length; i++) {
          intervals.push(recent[i] - recent[i - 1])
        }
        const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length
        const bpm = Math.round(60000 / avgMs)
        if (bpm >= 20 && bpm <= 300) {
          setDisplayBpm(bpm)
        }
      }
      return recent
    })
  }

  return (
    <button
      className="transport-tap"
      onClick={handleTap}
      title={displayBpm ? `Tap tempo: ${displayBpm} BPM` : 'Tap to set tempo'}
      style={{
        background: 'transparent', border: '1px solid var(--lib-border)',
        borderRadius: 2, padding: '1px 6px', cursor: 'pointer',
        fontSize: 9, color: displayBpm ? 'var(--accent)' : 'var(--text-mid)',
        fontFamily: 'inherit',
      }}
    >
      TAP{displayBpm ? ` ${displayBpm}` : ''}
    </button>
  )
}
