import { epochDate, formatCount } from '../lib/format'
import type { MinerIndex, MinerSummary } from '../lib/types'

export type SortKey = 'live' | 'end' | 'faulty'

interface Props {
  index: MinerIndex | null
  // Miners matching the search, sorted.
  miners: MinerSummary[]
  selected: string[]
  onMinerClick: (e: React.MouseEvent, id: string) => void
  onClear: () => void
  search: string
  onSearch: (q: string) => void
  sort: SortKey
  onSort: (key: SortKey) => void
  error: string | null
}

function LeftPane({ index, miners, selected, onMinerClick, onClear, search, onSearch, sort, onSort, error }: Props) {
  const total = index?.miners.length ?? 0
  return (
    <aside className="left">
      <div className="left-head">
        <h2 className="pane-title">
          Miners ({miners.length === total ? total : `${miners.length} of ${total}`})
        </h2>
        <button className="link" disabled={selected.length === 0} onClick={onClear}>
          {selected.length ? `Show all (${selected.length} selected)` : 'Showing all'}
        </button>
      </div>
      <div className="list-controls">
        <input
          type="search"
          placeholder="Search miner ID"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          aria-label="Search miners"
        />
        <select value={sort} onChange={(e) => onSort(e.target.value as SortKey)} aria-label="Sort miners">
          <option value="live">Most sectors</option>
          <option value="end">Ends soonest</option>
          <option value="faulty">Most faulty</option>
        </select>
      </div>
      {error && <p className="error">Failed to load data: {error}</p>}
      <ul className="miner-list">
        {miners.map((m) => {
          const isSelected = selected.includes(m.id)
          return (
            <li key={m.id} className={isSelected ? 'miner selected' : 'miner'}>
              <button
                className="miner-body"
                aria-pressed={isSelected}
                title="Shift-click to add or remove from the selection"
                // Keep Shift-click from selecting text.
                onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                onClick={(e) => onMinerClick(e, m.id)}
              >
                <span className="miner-row">
                  <span className="miner-id">{m.id}</span>
                  <span className="miner-counts">
                    {formatCount(m.live)}
                    {m.faulty > 0 && <span className="faulty"> · {formatCount(m.faulty)} faulty</span>}
                  </span>
                </span>
                <span className="miner-end">ends {epochDate(m.lastExpiration, index!.genesisTimestamp)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

export default LeftPane
