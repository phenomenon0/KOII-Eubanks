import { useStore, useDispatch } from '../../store'
import { BANKS } from '../../protocol/types'

const BANK_COLORS: Record<string, string> = {
  KICK:     '#8C959F',
  SNARE:    '#82C9EC',
  CYMB:     '#82EC88',
  PERC:     '#FAFF4A',
  BASS:     '#47F3E3',
  MELOD:    '#F45050',
  LOOP:     '#A475F9',
  'USER 1': '#EE86E6',
  'USER 2': '#FFAA00',
  SFX:      '#B88552',
}

const SHORT_NAMES: Record<string, string> = {
  KICK: 'KICK', SNARE: 'SNARE', CYMB: 'CYMB', PERC: 'PERC',
  BASS: 'BASS', MELOD: 'MELOD', LOOP: 'LOOP',
  'USER 1': 'USR 1', 'USER 2': 'USR 2', SFX: 'SFX',
}

export function BankTabs() {
  const { state } = useStore()
  const dispatch = useDispatch()
  const currentBank = state.selectedBank

  return (
    <div className="bank-tabs">
      {BANKS.map(b => {
        const color = BANK_COLORS[b.name] ?? '#999'
        const active = currentBank === b.name
        const count = state.sounds.filter(s => s.bank === b.name).length

        return (
          <div
            key={b.name}
            className={`bank-tab ${active ? 'active' : ''}`}
            style={{ background: color }}
            onClick={() => dispatch({ type: 'SELECT_BANK', bank: active ? null : b.name })}
            title={`${b.name} (${count})`}
          >
            {SHORT_NAMES[b.name] ?? b.name}
          </div>
        )
      })}

      <div className="bank-tabs-divider" />

      {/* Page ranges */}
      <div className="page-ranges">
        {BANKS.map((b, i) => {
          const start = i * 100 + 1
          const end = (i + 1) * 100 - 1
          const label = `${String(start).padStart(3, '0')}-${String(end).padStart(3, '0')}`
          const color = BANK_COLORS[b.name] ?? '#999'
          const count = state.sounds.filter(s => s.bank === b.name).length
          return (
            <div
              key={i}
              className="page-range"
              style={{
                borderLeft: `3px solid ${color}`,
              }}
              title={`${b.name}: ${label}`}
            >
              {label}
            </div>
          )
        })}
      </div>
    </div>
  )
}
