import { useMemo, useState } from 'react'
import { epochDate, formatCount } from '../lib/format'
import { aggregateHistory, type MinerHistory } from '../lib/history'
import type { History, MinerIndex } from '../lib/types'

type HistorySort = 'extended' | 'recent' | 'days'

const SORTS: Record<HistorySort, (a: MinerHistory, b: MinerHistory) => number> = {
  extended: (a, b) => b.extended - a.extended,
  recent: (a, b) => b.lastExtended - a.lastExtended || b.extended - a.extended,
  days: (a, b) => b.extendedDays / b.extended - a.extendedDays / a.extended,
}

interface Props {
  index: MinerIndex | null
  history: History | null
  selected: string[]
  onMinerClick: (e: React.MouseEvent, id: string) => void
}

// Miners that extended sectors, summed over the recorded snapshot-to-snapshot changes.
function HistoryPane({ index, history, selected, onMinerClick }: Props) {
  const [sort, setSort] = useState<HistorySort>('extended')
  const miners = useMemo(
    () => (history ? aggregateHistory(history).filter((m) => m.extended > 0).sort(SORTS[sort]) : []),
    [history, sort],
  )
  const entries = history?.entries ?? []
  const genesis = index?.genesisTimestamp ?? 0

  return (
    <aside className="right">
      <h2 className="pane-title">Extensions ({miners.length})</h2>
      {entries.length === 0 ? (
        <p className="muted history-note">No history yet. Extensions are recorded from the next snapshot on.</p>
      ) : (
        <>
          <p className="muted history-note">
            since {epochDate(entries[0].prevHeight, genesis)} · {entries.length} snapshot{entries.length > 1 ? 's' : ''}
          </p>
          <div className="list-controls">
            <select value={sort} onChange={(e) => setSort(e.target.value as HistorySort)} aria-label="Sort extensions">
              <option value="extended">Most extended</option>
              <option value="recent">Most recent</option>
              <option value="days">Longest extension</option>
            </select>
          </div>
        </>
      )}
      <ul className="miner-list">
        {miners.map((m) => {
          const isSelected = selected.includes(m.id)
          const gone = m.expired + m.terminated
          return (
            <li key={m.id} className={isSelected ? 'miner selected' : 'miner'}>
              <button
                className="miner-body"
                aria-pressed={isSelected}
                title="Shift-click to add or remove from the selection"
                onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                onClick={(e) => onMinerClick(e, m.id)}
              >
                <span className="miner-row">
                  <span className="miner-id">{m.id}</span>
                  <span className="miner-counts">{formatCount(m.extended)}</span>
                </span>
                <span className="miner-end">
                  +{Math.round(m.extendedDays / m.extended)} d avg · last {epochDate(m.lastExtended, genesis)}
                  {m.extensionRuns > 1 && ` · ${m.extensionRuns}×`}
                  {gone > 0 && ` · ${formatCount(gone)} gone`}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

export default HistoryPane
