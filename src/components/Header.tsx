import { epochDate, formatCount, formatSpan } from '../lib/format'
import { NETWORKS, type NetKey } from '../lib/networks'
import type { MinerIndex } from '../lib/types'

interface Props {
  index: MinerIndex | null
  net: NetKey
  onNet: (net: NetKey) => void
}

function Header({ index, net, onNet }: Props) {
  const live = index?.miners.reduce((s, m) => s + m.live, 0) ?? 0
  return (
    <header className="header">
      <h1>sector-spiegel</h1>
      <div className="net-toggle" role="group" aria-label="Network">
        {(Object.keys(NETWORKS) as NetKey[]).map((key) => (
          <button key={key} className={key === net ? 'on' : ''} aria-pressed={key === net} onClick={() => onNet(key)}>
            {NETWORKS[key].label}
          </button>
        ))}
      </div>
      {index && (
        <>
          <span className="header-death">
            {index.network} ends <strong>{epochDate(index.totals.lastExpiration, index.genesisTimestamp)}</strong>
            <span className="muted"> · in {formatSpan(index.totals.lastExpiration - index.height)} · {formatCount(live)} live sectors</span>
          </span>
          <span className="header-meta">
            height {index.height} · snapshot {new Date(index.fetchedAt).toLocaleString()}
          </span>
        </>
      )}
    </header>
  )
}

export default Header
