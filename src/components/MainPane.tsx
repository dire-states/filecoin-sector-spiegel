import { useEffect, useMemo, useState } from 'react'
import MinerStrips from './MinerStrips'
import SectorMatrix, { type Pin } from './SectorMatrix'
import SelectionChart from './SelectionChart'
import { lifetimeRamp, useDarkMode } from '../lib/colors'
import { epochDate, formatCount } from '../lib/format'
import type { DecodedMiner } from '../lib/sectors'
import type { MinerIndex, MinerSummary } from '../lib/types'

interface Props {
  index: MinerIndex | null
  // Miners matching the list search, sorted: the overview when nothing is selected.
  listed: MinerSummary[]
  selectedMiners: MinerSummary[]
  loaded: Map<string, DecodedMiner>
  // Chart color slot per selected miner.
  slots: Map<string, number>
  onMinerClick: (e: React.MouseEvent, id: string) => void
}

function counts(miners: MinerSummary[]) {
  return miners.reduce(
    (t, m) => ({ live: t.live + m.live, active: t.active + m.active, faulty: t.faulty + m.faulty, recovering: t.recovering + m.recovering }),
    { live: 0, active: 0, faulty: 0, recovering: 0 },
  )
}

function MainPane({ index, listed, selectedMiners, loaded, slots, onMinerClick }: Props) {
  // One pinned sector across all matrices.
  const [pin, setPin] = useState<Pin | null>(null)
  const dark = useDarkMode()
  const overview = selectedMiners.length === 0
  const shown = overview ? listed : selectedMiners

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPin(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The overview chart colors miners in list order.
  const chartSlots = useMemo(
    () => (overview ? new Map(listed.map((m, i) => [m.id, i])) : slots),
    [overview, listed, slots],
  )

  if (!index) return <main className="main" />

  const t = counts(shown)
  const total = index.miners.length
  const scope = overview
    ? listed.length === total ? `All ${total} miners` : `${listed.length} of ${total} miners`
    : shown.length === 1 ? shown[0].id : `${shown.length} miners`

  return (
    <main className="main">
      <div className="main-head">
        <h2 className="pane-title miner-title">
          {scope} · {formatCount(t.live)} live · {formatCount(t.active)} active · {formatCount(t.faulty)} faulty
          {t.recovering > 0 && ` · ${formatCount(t.recovering)} recovering`}
        </h2>
      </div>
      <div className="legend">
        <span className="ramp-legend">
          <span>expires now</span>
          <i className="ramp" style={{ background: `linear-gradient(to right, ${lifetimeRamp(dark).join(', ')})` }} />
          <span>{epochDate(index.totals.lastExpiration, index.genesisTimestamp)} (network end)</span>
        </span>
        <span><i className="swatch faulty" /> faulty</span>
        <span><i className="swatch recovering" /> recovering</span>
        {overview && <span className="muted">· click a miner to load its sectors, Shift-click to add</span>}
      </div>
      <div className="main-scroll">
        {overview ? (
          <MinerStrips index={index} miners={listed} dark={dark} onClick={onMinerClick} />
        ) : (
          selectedMiners.map((m) => {
            const miner = loaded.get(m.id)
            return (
              <section key={m.id} className="miner-block">
                {selectedMiners.length > 1 && (
                  <h3 className="miner-block-title">
                    {m.id}{' '}
                    <span className="muted">
                      · {formatCount(m.live)} live · ends {epochDate(m.lastExpiration, index.genesisTimestamp)}
                    </span>
                  </h3>
                )}
                {miner ? (
                  <SectorMatrix
                    miner={miner}
                    index={index}
                    dark={dark}
                    // A pin on a miner that's no longer shown simply matches nothing.
                    pin={pin?.minerId === m.id ? pin : null}
                    onPin={setPin}
                  />
                ) : (
                  <p className="muted">Loading sectors…</p>
                )}
              </section>
            )
          })
        )}
      </div>
      {shown.length > 0 && (
        <div className="main-chart">
          <SelectionChart
            index={index}
            title={scope}
            miners={shown}
            slots={chartSlots}
            loaded={overview ? null : loaded}
            dark={dark}
          />
        </div>
      )}
    </main>
  )
}

export default MainPane
