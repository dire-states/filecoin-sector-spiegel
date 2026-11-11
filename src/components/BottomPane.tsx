import ChartPanel from './ChartPanel'
import SurvivalChart from './SurvivalChart'
import { seriesColor, useDarkMode } from '../lib/colors'
import { epochDate, formatCount, formatSpan } from '../lib/format'
import { histogram } from '../lib/lifetime'
import type { MinerIndex, MinerSummary } from '../lib/types'

function BottomPane({ index }: { index: MinerIndex | null }) {
  const dark = useDarkMode()

  if (!index) return <section className="bottom" />

  const netFaulty = index.miners.reduce((s, m) => s + m.faulty, 0)
  const netLive = index.miners.reduce((s, m) => s + m.live, 0)

  // A miner is alive while at least one of its sectors is, so its end is its last sector's end.
  const minerEnds = (pick: (m: MinerSummary) => number) => histogram(index.miners.map(pick))
  const lastMinerEnd = index.miners.reduce((a, m) => Math.max(a, m.lastExpiration), 0)
  const lastMinerMaxEnd = index.miners.reduce((a, m) => Math.max(a, m.maxLastExpiration), 0)

  return (
    <section className="bottom">
      <ChartPanel
        title="Network"
        live={netLive}
        faulty={netFaulty}
        end={index.totals.lastExpiration}
        index={index}
        extra={
          <>
            {' · max lifetime: '}
            <strong className="ink">{epochDate(index.totals.maxLastExpiration, index.genesisTimestamp)}</strong> (in{' '}
            {formatSpan(index.totals.maxLastExpiration - index.height)})
          </>
        }
      >
        <SurvivalChart
          series={[
            { id: 'network', label: 'Current expirations', color: seriesColor(0, dark), hist: index.totals.expirations },
            {
              id: 'max',
              label: 'If all extended to max lifetime (faulty recovered)',
              color: seriesColor(1, dark),
              hist: index.totals.maxExpirations,
              dashed: true,
            },
          ]}
          height={index.height}
          genesisTimestamp={index.genesisTimestamp}
        />
      </ChartPanel>
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Miners</span>
          <span className="muted">
            {formatCount(index.miners.length)} with live sectors · last one gone by{' '}
            <strong className="ink">{epochDate(lastMinerEnd, index.genesisTimestamp)}</strong> · max lifetime:{' '}
            <strong className="ink">{epochDate(lastMinerMaxEnd, index.genesisTimestamp)}</strong>
          </span>
        </div>
        <SurvivalChart
          series={[
            { id: 'miners', label: 'Current expirations', color: seriesColor(0, dark), hist: minerEnds((m) => m.lastExpiration) },
            {
              id: 'miners-max',
              label: 'If all extended to max lifetime',
              color: seriesColor(1, dark),
              hist: minerEnds((m) => m.maxLastExpiration),
              dashed: true,
            },
          ]}
          unit="miners"
          height={index.height}
          genesisTimestamp={index.genesisTimestamp}
        />
      </div>
    </section>
  )
}

export default BottomPane
