import { useState } from 'react'
import { useStore } from '../../store'
import type { BackupProgress } from '../../store'

export function BackupPanel() {
  const { state } = useStore()
  const [projectsOnly, setProjectsOnly] = useState(true)

  const bp = state.backupProgress
  const isBusy = bp !== null && bp.phase !== 'done' && bp.phase !== 'error'
  const canOperate = !!state.device && !state.isSyncing && !isBusy

  const triggerBackup = () => {
    window.dispatchEvent(new CustomEvent('ko:backup', { detail: { projectsOnly } }))
  }

  const triggerRestore = () => {
    window.dispatchEvent(new CustomEvent('ko:restore', { detail: { projectsOnly } }))
  }

  return (
    <div className="backup-panel">
      {bp && <ProgressBanner progress={bp} />}

      <div className="backup-section">
        <div className="backup-section-title">Backup</div>
        <div className="backup-info">
          Save your EP-133 projects and samples to a local ZIP archive.
          Projects-only mode is faster (under 1 minute) and skips large sample banks.
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer', fontSize: 12 }}>
          <input
            type="checkbox"
            checked={projectsOnly}
            onChange={e => setProjectsOnly(e.target.checked)}
          />
          Projects only (faster — skips samples)
        </label>

        <button
          className="btn btn-primary"
          disabled={!canOperate}
          onClick={triggerBackup}
        >
          Create Backup
        </button>
      </div>

      <div className="backup-section">
        <div className="backup-section-title">Restore</div>
        <div className="backup-info">
          Restore from a previously saved backup file. If restoring projects-only,
          existing samples on the device will not be affected.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn"
            disabled={!canOperate}
            onClick={triggerRestore}
          >
            Restore from File...
          </button>
        </div>
      </div>

      <div className="backup-section">
        <div className="backup-section-title">Projects</div>
        {state.projects.length === 0 ? (
          <div style={{ color: 'var(--text3)', fontSize: 12 }}>
            {state.device ? 'No projects found' : 'Connect device to view projects'}
          </div>
        ) : (
          <div>
            {state.projects.map(p => (
              <div key={p.nodeId} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 12,
              }}>
                <div>
                  <span style={{ color: 'var(--accent)' }}>{p.name}</span>
                  <span style={{ color: 'var(--text3)', marginLeft: 8, fontSize: 11 }}>
                    {p.groupCount} groups
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="btn btn-sm"
                    disabled={!canOperate}
                    title="Backup this project"
                    onClick={() => window.dispatchEvent(new CustomEvent('ko:backupProject', { detail: { path: p.path } }))}
                  >
                    ↓
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={!canOperate}
                    title="Restore into this project slot"
                    onClick={() => window.dispatchEvent(new CustomEvent('ko:restoreProject', { detail: { path: p.path } }))}
                  >
                    ↑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProgressBanner({ progress: p }: { progress: BackupProgress }) {
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
    <div className="backup-section" style={{
      background: p.phase === 'error' ? 'rgba(231,76,60,0.1)' : 'rgba(52,152,219,0.1)',
      borderRadius: 6,
      padding: '12px 16px',
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
        <span style={{ fontWeight: 600 }}>
          {p.operation === 'backup' ? 'Backup' : 'Restore'} — {phaseLabel[p.phase] ?? p.phase}
        </span>
        {isActive && p.fileCount > 0 && (
          <span style={{ color: 'var(--text3)' }}>{p.fileIndex}/{p.fileCount} files ({pct}%)</span>
        )}
      </div>

      {isActive && (
        <div style={{ background: 'var(--bg2)', borderRadius: 3, height: 6, overflow: 'hidden' }}>
          <div style={{
            background: 'var(--accent)',
            height: '100%',
            width: `${pct}%`,
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}

      {p.currentFile && isActive && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.currentFile}
        </div>
      )}

      {p.phase === 'done' && (
        <div style={{ fontSize: 12, color: 'var(--success)' }}>
          {p.fileCount === 0 ? 'No files to process.' : `Successfully processed ${p.fileCount} files.`}
          {p.currentFile && p.operation === 'backup' && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Saved to: {p.currentFile}</div>
          )}
        </div>
      )}

      {p.phase === 'error' && (
        <div style={{ fontSize: 12, color: 'var(--danger)', whiteSpace: 'pre-wrap', marginTop: 4 }}>
          {p.errorMessage}
        </div>
      )}
    </div>
  )
}
