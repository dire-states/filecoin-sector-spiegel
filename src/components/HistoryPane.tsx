import { useMemo, useState } from 'react'
import { epochDate, formatCount } from '../lib/format'
import { aggregateHistory, type MinerHistory } from '../lib/history'
import type { History, MinerIndex } from '../lib/types'

type HistoryFilter = 'extended' | 'gone' | 'all'
type HistorySort = 'extended' | 'recent' | 'days' | 'lost'

const lost = (m: MinerHistory) => m.expired + m.terminated

const SORTS: Record<HistorySort, (a: MinerHistory, b: MinerHistory) => number> = {
  extended: (a, b) => b.extended - a.extended,
  recent: (a, b) => b.lastChanged - a.lastChanged || lost(b) + b.extended - (lost(a) + a.extended),
  days: (a, b) => b.extendedDays / b.extended - a.extendedDays / a.extended,
  lost: (a, b) => lost(b) - lost(a),
}
// Under the extensions filter "most recent" means the last extension, not the last change.
const RECENT_EXTENDED = (a: MinerHistory, b: MinerHistory) => b.lastExtended - a.lastExtended || b.extended - a.extended

// Default sort per filter; extension-based sorts make no sense for miners that never extended.
const DEFAULT_SORT: Record<HistoryFilter, HistorySort> = { extended: 'extended', gone: 'lost', all: 'lost' }

interface Props {
  index: MinerIndex | null
  history: History | null
  selected: string[]
  onMinerClick: (e: React.MouseEvent, id: string) => void
}

// Joins the non-empty parts of a row's detail line.
const details = (...parts: (string | false)[]) => parts.filter(Boolean).join(' · ')

// Miners' changes summed over the recorded snapshot-to-snapshot history: extensions, or miners
// that dropped out of the index (all their sectors expired or terminated).
function HistoryPane({ index, history, selected, onMinerClick }: Props) {
  const [filter, setFilter] = useState<HistoryFilter>('extended')
  const [sort, setSort] = useState<HistorySort>('extended')
  const live = useMemo(() => new Set(index?.miners.map((m) => m.id)), [index])
  const miners = useMemo(() => {
    if (!history) return []
    const all = aggregateHistory(history)
    const shown =
      filter === 'extended' ? all.filter((m) => m.extended > 0) : filter === 'gone' ? all.filter((m) => !live.has(m.id)) : all
    return shown.sort(filter === 'extended' && sort === 'recent' ? RECENT_EXTENDED : SORTS[sort])
  }, [history, live, filter, sort])
  const entries = history?.entries ?? []
  const genesis = index?.genesisTimestamp ?? 0

  function changeFilter(f: HistoryFilter) {
    setFilter(f)
    setSort(DEFAULT_SORT[f])
  }

  return (
    <aside className="right">
      <h2 className="pane-title">History ({miners.length})</h2>
      {entries.length === 0 ? (
        <p className="muted history-note">No history yet. Changes are recorded from the next snapshot on.</p>
      ) : (
        <>
          <p className="muted history-note">
            since {epochDate(entries[0].prevHeight, genesis)} · {entries.length} snapshot{entries.length > 1 ? 's' : ''}
          </p>
          <div className="list-controls">
            <select value={filter} onChange={(e) => changeFilter(e.target.value as HistoryFilter)} aria-label="Filter history">
              <option value="extended">Extended</option>
              <option value="gone">Gone</option>
              <option value="all">All changes</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as HistorySort)} aria-label="Sort history">
              {filter === 'extended' && <option value="extended">Most extended</option>}
              <option value="recent">Most recent</option>
              {filter === 'extended' && <option value="days">Longest extension</option>}
              <option value="lost">Most lost</option>
            </select>
          </div>
        </>
      )}
      <ul className="miner-list">
        {miners.map((m) => {
          const gone = lost(m)
          // Departed miners have no file left to load, so they can't be selected.
          if (index && !live.has(m.id)) {
            return (
              <li key={m.id} className="miner departed">
                <div className="miner-body">
                  <span className="miner-row">
                    <span className="miner-id">{m.id}</span>
                    <span className="miner-counts">{formatCount(gone)}</span>
                  </span>
                  <span className="miner-end">
                    {details(
                      m.expired > 0 && `${formatCount(m.expired)} expired`,
                      m.terminated > 0 && `${formatCount(m.terminated)} terminated`,
                      `gone ${epochDate(m.lastChanged, genesis)}`,
                    )}
                  </span>
                </div>
              </li>
            )
          }
          const isSelected = selected.includes(m.id)
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
                  <span className="miner-counts">{formatCount(m.extended > 0 ? m.extended : gone || m.added)}</span>
                </span>
                <span className="miner-end">
                  {m.extended > 0
                    ? details(
                        `+${Math.round(m.extendedDays / m.extended)} d avg · last ${epochDate(m.lastExtended, genesis)}`,
                        m.extensionRuns > 1 && `${m.extensionRuns}×`,
                        gone > 0 && `${formatCount(gone)} gone`,
                      )
                    : details(
                        m.added > 0 && `+${formatCount(m.added)} added`,
                        gone > 0 && `${formatCount(gone)} gone`,
                        `last ${epochDate(m.lastChanged, genesis)}`,
                      )}
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
