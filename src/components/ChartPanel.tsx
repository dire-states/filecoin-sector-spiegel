import { epochDate, formatCount, formatSpan } from '../lib/format'
import type { MinerIndex } from '../lib/types'

interface Props {
  title: string
  live: number
  faulty: number
  end: number
  index: MinerIndex
  extra?: React.ReactNode
  children: React.ReactNode
}

// A survival chart with its sector summary line.
function ChartPanel({ title, live, faulty, end, index, extra, children }: Props) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        <span className="muted">
          {formatCount(live)} live · all expired by <strong className="ink">{epochDate(end, index.genesisTimestamp)}</strong> (in{' '}
          {formatSpan(end - index.height)})
          {faulty > 0 && ` · ${formatCount(faulty)} faulty end at early expiry`}
          {extra}
        </span>
      </div>
      {children}
    </div>
  )
}

export default ChartPanel
