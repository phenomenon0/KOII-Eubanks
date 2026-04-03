// ────────────────────────────────────────────────────────────
// KO Workbench — Controllers Management Tab
// Connected devices, MIDI learn, mapping management, page/bank
// ────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import { useControllers, useControllersDispatch } from '../../store'
import { useStore } from '../../store'
import { matchProfile, ControllerProfile } from '../../controllers/profiles'
import type { ControllerMapping } from '../../store/controllers'

// ─── Action target options for learn mode ────────────────────

const LEARN_TARGETS: { label: string; value: string }[] = [
  // Pads
  ...Array.from({ length: 12 }, (_, i) => ({ label: `Play Pad ${i}`, value: `playPad:${i}` })),
  // Transport
  { label: 'Transport: Play', value: 'transport:play' },
  { label: 'Transport: Stop', value: 'transport:stop' },
  { label: 'Transport: Record', value: 'transport:record' },
  // Macros
  { label: 'Macro: Volume', value: 'setMacro:vol' },
  { label: 'Macro: Pan', value: 'setMacro:pan' },
  { label: 'Macro: Filter', value: 'setMacro:filter' },
  { label: 'Macro: Reverb', value: 'setMacro:reverb' },
  // Bank select
  { label: 'Bank: KICK', value: 'selectBank:KICK' },
  { label: 'Bank: SNARE', value: 'selectBank:SNARE' },
  { label: 'Bank: CYMB', value: 'selectBank:CYMB' },
  { label: 'Bank: PERC', value: 'selectBank:PERC' },
  { label: 'Bank: BASS', value: 'selectBank:BASS' },
  { label: 'Bank: MELOD', value: 'selectBank:MELOD' },
  { label: 'Bank: LOOP', value: 'selectBank:LOOP' },
  { label: 'Bank: USER 1', value: 'selectBank:USER 1' },
  { label: 'Bank: USER 2', value: 'selectBank:USER 2' },
  // Scene recall
  { label: 'Recall Scene 1', value: 'recallScene:1' },
  { label: 'Recall Scene 2', value: 'recallScene:2' },
  { label: 'Recall Scene 3', value: 'recallScene:3' },
  { label: 'Recall Scene 4', value: 'recallScene:4' },
]

// ─── Type icon helper ────────────────────────────────────────

function typeIcon(type: ControllerProfile['type']): string {
  switch (type) {
    case 'keyboard': return '\u{1F3B9}'  // keyboard emoji as plain text fallback
    case 'pad':      return '\u{1F3B6}'
    case 'fader':    return '\u{1F39A}'
    default:         return '\u{1F3AE}'
  }
}

function typeLabel(type: ControllerProfile['type']): string {
  switch (type) {
    case 'keyboard': return 'Keyboard'
    case 'pad':      return 'Pad Controller'
    case 'fader':    return 'Fader/Knob'
    default:         return 'Generic'
  }
}

// ─── Page filter options ─────────────────────────────────────

const PAGE_FILTERS = [
  { label: 'All', value: -1 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '4', value: 4 },
]

// ─── Main component ─────────────────────────────────────────

export function ControllersTab() {
  const controllers = useControllers()
  const controllersDispatch = useControllersDispatch()
  const { state } = useStore()

  const [learnTarget, setLearnTarget] = useState(LEARN_TARGETS[0].value)
  const [learnStatus, setLearnStatus] = useState<string | null>(null)
  const [pageFilter, setPageFilter] = useState(-1) // -1 = all

  const isConnected = !!state.device

  // Listen for controller events to update lastTouched
  useEffect(() => {
    const handler = (e: Event) => {
      const event = (e as CustomEvent).detail
      if (event && event.controllerId && event.type) {
        let control = ''
        if (event.type === 'cc' && event.cc !== undefined) {
          control = `cc:${event.cc}`
        } else if ((event.type === 'noteOn' || event.type === 'noteOff') && event.note !== undefined) {
          control = `note:${event.note}`
        } else if (event.type === 'pitchBend') {
          control = 'pitchBend'
        } else if (event.type === 'aftertouch') {
          control = event.note !== undefined ? `aftertouch:${event.note}` : 'aftertouch'
        }
        if (control) {
          controllersDispatch({
            type: 'SET_LAST_TOUCHED',
            controllerId: event.controllerId,
            control,
            value: event.value ?? 0,
          })
        }
      }
    }
    window.addEventListener('ko:controllerEvent', handler)
    return () => window.removeEventListener('ko:controllerEvent', handler)
  }, [controllersDispatch])

  // Start learn mode
  const handleStartLearn = useCallback(() => {
    controllersDispatch({ type: 'SET_LEARN_MODE', active: true, target: learnTarget })
    setLearnStatus('Waiting for MIDI input...')

    // Dispatch custom event so App.tsx can call DeviceController.startLearnMode
    window.dispatchEvent(new CustomEvent('ko:startLearn', {
      detail: { targetAction: learnTarget },
    }))
  }, [learnTarget, controllersDispatch])

  // Stop learn mode
  const handleStopLearn = useCallback(() => {
    controllersDispatch({ type: 'SET_LEARN_MODE', active: false, target: null })
    setLearnStatus(null)
    window.dispatchEvent(new CustomEvent('ko:stopLearn'))
  }, [controllersDispatch])

  // Listen for learn complete
  useEffect(() => {
    const handler = (e: Event) => {
      const mapping = (e as CustomEvent).detail as ControllerMapping
      controllersDispatch({ type: 'ADD_MAPPING', mapping })
      controllersDispatch({ type: 'SET_LEARN_MODE', active: false, target: null })
      setLearnStatus(`Learned: ${mapping.control} -> ${mapping.action}`)
    }
    window.addEventListener('ko:learnComplete', handler)
    return () => window.removeEventListener('ko:learnComplete', handler)
  }, [controllersDispatch])

  // Remove a mapping
  const handleRemoveMapping = useCallback((id: string) => {
    controllersDispatch({ type: 'REMOVE_MAPPING', id })
    window.dispatchEvent(new CustomEvent('ko:removeMapping', { detail: { id } }))
  }, [controllersDispatch])

  // Set active page
  const handleSetPage = useCallback((page: number) => {
    controllersDispatch({ type: 'SET_ACTIVE_PAGE', page })
    window.dispatchEvent(new CustomEvent('ko:setActivePage', { detail: { page } }))
  }, [controllersDispatch])

  // Refresh MIDI ports
  const handleRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent('ko:refreshControllers'))
  }, [])

  // Resolve controller name from ID
  const controllerName = (id: string): string => {
    const c = controllers.controllers.find(d => d.id === id)
    return c ? c.name : id
  }

  // Filter mappings by page
  const filteredMappings = pageFilter === -1
    ? controllers.mappings
    : controllers.mappings.filter(m => m.page === 0 || m.page === pageFilter)

  return (
    <div className="controllers-layout">
      {/* ── Left column: connected devices ── */}
      <div className="controllers-list">
        <div className="controllers-list-header">CONNECTED</div>

        {/* EP-133 target device */}
        <div className="controller-item controller-item-primary">
          <div className="controller-item-row">
            <span className={`controller-status-dot ${isConnected ? 'connected' : ''}`} />
            <span className="controller-item-name">
              {isConnected ? state.device!.name : 'EP-133 (KO)'}
            </span>
          </div>
          <div className="controller-item-meta">
            Status: {isConnected ? 'Connected' : 'Not connected'}
          </div>
        </div>

        {/* External controllers */}
        {controllers.controllers.map(ctrl => {
          const profile = matchProfile(ctrl.name)
          return (
            <div key={ctrl.id} className="controller-item">
              <div className="controller-item-row">
                <span className="controller-status-dot connected" />
                <span className="controller-item-name">{ctrl.name}</span>
              </div>
              <div className="controller-profile-badge">
                <span className="profile-type-icon">{typeIcon(profile.type)}</span>
                <span>{profile.name}</span>
              </div>
              <div className="controller-item-meta">
                Type: {typeLabel(profile.type)}
                {profile.knobCount ? ` | ${profile.knobCount} knobs` : ''}
                {profile.faderCount ? ` | ${profile.faderCount} faders` : ''}
                {profile.hasPads ? ' | pads' : ''}
                {profile.hasTransport ? ' | transport' : ''}
              </div>
              {profile.noteRange && (
                <div className="controller-item-meta">
                  Notes: {profile.noteRange[0]}-{profile.noteRange[1]}
                </div>
              )}
            </div>
          )
        })}

        {controllers.controllers.length === 0 && (
          <div className="controller-item controller-item-empty">
            No external controllers detected
          </div>
        )}

        <button className="btn controllers-refresh-btn" onClick={handleRefresh}>
          Refresh
        </button>
      </div>

      {/* ── Right column: mappings + learn mode ── */}
      <div className="mappings-panel">
        {/* Page selector */}
        <div className="mappings-panel-header">
          <span className="mappings-panel-title">MAPPINGS</span>
          <div className="page-selector">
            <span className="page-selector-label">Page:</span>
            {[1, 2, 3, 4].map(p => (
              <button
                key={p}
                className={`page-btn ${controllers.activePage === p ? 'active' : ''}`}
                onClick={() => handleSetPage(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="mappings-filter-tabs">
          {PAGE_FILTERS.map(f => (
            <button
              key={f.value}
              className={`mappings-filter-btn ${pageFilter === f.value ? 'active' : ''}`}
              onClick={() => setPageFilter(f.value)}
            >
              {f.label === 'All' ? 'All' : `Page ${f.label}`}
            </button>
          ))}
        </div>

        {/* Mapping list */}
        <div className="mappings-list">
          {filteredMappings.length === 0 && (
            <div className="mappings-empty">
              No mappings{pageFilter !== -1 ? ` on page ${pageFilter}` : ''}. Use Learn Mode to create one.
            </div>
          )}
          {filteredMappings.map(m => (
            <div key={m.id} className="mapping-row">
              <span className="mapping-control">{m.control}</span>
              <span className="mapping-controller">({controllerName(m.controllerId)})</span>
              <span className="mapping-arrow">-&gt;</span>
              <span className="mapping-action">{m.action}</span>
              <span className="mapping-page">
                {m.page === 0 ? 'All' : `P${m.page}`}
              </span>
              <button
                className="mapping-delete-btn"
                onClick={() => handleRemoveMapping(m.id)}
                title="Remove mapping"
              >
                x
              </button>
            </div>
          ))}
        </div>

        {/* Learn Mode */}
        <div className="learn-mode-section">
          <div className="learn-mode-header">LEARN MODE</div>
          <div className="learn-mode-row">
            <label className="learn-mode-label">Target:</label>
            <select
              className="learn-mode-select"
              value={learnTarget}
              onChange={e => setLearnTarget(e.target.value)}
              disabled={controllers.learnMode.active}
            >
              {LEARN_TARGETS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="learn-mode-row">
            {!controllers.learnMode.active ? (
              <button className="btn learn-btn" onClick={handleStartLearn}>
                Start Learn
              </button>
            ) : (
              <button className="btn learn-btn learn-btn-stop" onClick={handleStopLearn}>
                Stop
              </button>
            )}
          </div>
          {learnStatus && (
            <div className={`learn-status ${controllers.learnMode.active ? 'waiting' : 'learned'}`}>
              {learnStatus}
            </div>
          )}
          {controllers.lastTouched && (
            <div className="learn-last-touched">
              Last: {controllers.lastTouched.control} from "{controllerName(controllers.lastTouched.controllerId)}" (val: {controllers.lastTouched.value})
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
