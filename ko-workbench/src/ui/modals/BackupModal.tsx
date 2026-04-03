import { useState } from 'react'
import { useStore } from '../../store'
import type { BackupProgress } from '../../store'

export function BackupModal({ onClose }: { onClose: () => void }) {
  const { state } = useStore()
  const [projectsOnly, setProjectsOnly] = useState(true)
  const bp = state.backupProgress
  const isBusy = bp !== null && bp.phase !== 'done' && bp.phase !== 'error'
  const canOperate = !!state.device && !state.isSyncing && !isBusy

  const triggerBackup = (projOnly: boolean) => {
    window.dispatchEvent(new CustomEvent('ko:backup', { detail: { projectsOnly: projOnly } }))
  }

  const triggerRestore = () => {
    window.dispatchEvent(new CustomEvent('ko:restore', { detail: { projectsOnly } }))
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !isBusy) onClose() }}>
      <div className="modal-content">

        {bp && <ProgressCard progress={bp} />}

        {/* Full backup */}
        <div className="backup-card">
          <div className="backup-card-icon">↓</div>
          <div className="backup-card-body">
            <div className="backup-card-title">create full backup</div>
            <div className="backup-card-desc">
              save all samples and projects<br />to a file on your computer.
            </div>
            <div className="backup-card-action">
              <button className="btn" disabled={!canOperate} onClick={() => triggerBackup(false)}>
                backup
              </button>
            </div>
          </div>
        </div>

        {/* Projects only backup */}
        <div className="backup-card">
          <div className="backup-card-icon">↓</div>
          <div className="backup-card-body">
            <div className="backup-card-title">create projects only backup</div>
            <div className="backup-card-desc">
              save projects only (no samples).<br />faster — under 1 minute.
            </div>
            <div className="backup-card-action">
              <button className="btn" disabled={!canOperate} onClick={() => triggerBackup(true)}>
                backup
              </button>
            </div>
          </div>
        </div>

        {/* Restore */}
        <div className="backup-card">
          <div className="backup-card-icon" style={{ fontSize: 14 }}>↑</div>
          <div className="backup-card-body">
            <div className="backup-card-title">restore local backup</div>
            <div className="backup-card-desc">
              restore samples and projects from<br />a backup file on your computer.
            </div>
            <div className="backup-card-action">
              <button className="btn" disabled={!canOperate} onClick={triggerRestore}>
                restore
              </button>
            </div>
          </div>
        </div>

        {/* Per-project section */}
        {state.projects.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, letterSpacing: 1, color: 'var(--text-mid)', marginBottom: 6 }}>
              PROJECTS
            </div>
            {state.projects.map(p => (
              <div key={p.nodeId} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 0', fontSize: 11, color: 'var(--text-dark)',
              }}>
                <span>{p.name} <span style={{ color: 'var(--text-mid)' }}>({p.groupCount} groups)</span></span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-sm" disabled={!canOperate}
                    onClick={() => window.dispatchEvent(new CustomEvent('ko:backupProject', { detail: { path: p.path } }))}
                  >↓</button>
                  <button className="btn btn-sm" disabled={!canOperate}
                    onClick={() => window.dispatchEvent(new CustomEvent('ko:restoreProject', { detail: { path: p.path } }))}
                  >↑</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <button className="btn" onClick={onClose} disabled={isBusy}>back</button>
        </div>
      </div>
    </div>
  )
}

function ProgressCard({ progress: p }: { progress: BackupProgress }) {
  const pct = p.fileCount > 0 ? Math.round((p.fileIndex / p.fileCount) * 100) : 0
  const isActive = p.phase !== 'done' && p.phase !== 'error'

  const phaseLabel: Record<string, string> = {
    scanning: 'Scanning device...',
    transferring: p.operation === 'backup' ? 'Downloading files...' : 'Uploading files...',
    packing: 'Packing archive...',
    unpacking: 'Reading archive...',
    done: 'Complete',
    error: 'Error',
  }

  return (
    <div className={`backup-progress ${p.phase === 'error' ? 'error' : ''}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span style={{ fontWeight: 'bold' }}>
          {p.operation === 'backup' ? 'Backup' : 'Restore'} — {phaseLabel[p.phase] ?? p.phase}
        </span>
        {isActive && p.fileCount > 0 && (
          <span style={{ color: 'var(--text-mid)' }}>{p.fileIndex}/{p.fileCount} ({pct}%)</span>
        )}
      </div>

      {isActive && (
        <div className="backup-progress-bar">
          <div className="backup-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      {p.currentFile && isActive && (
        <div style={{ fontSize: 10, color: 'var(--text-mid)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.currentFile}
        </div>
      )}

      {p.phase === 'done' && (
        <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>
          Successfully processed {p.fileCount} files.
        </div>
      )}

      {p.phase === 'error' && (
        <div style={{ fontSize: 11, color: 'var(--danger)', whiteSpace: 'pre-wrap', marginTop: 4 }}>
          {p.errorMessage}
        </div>
      )}
    </div>
  )
}
