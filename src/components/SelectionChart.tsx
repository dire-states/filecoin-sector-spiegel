import { useMemo } from 'react'
import ChartPanel from './ChartPanel'
import SurvivalChart, { type Series } from './SurvivalChart'
import { SERIES_SLOTS, seriesColor } from '../lib/colors'
import { DAILY, histogram, stripBuckets, type Buckets, type Histogram } from '../lib/lifetime'
import type { DecodedMiner } from '../lib/sectors'
import type { MinerIndex, MinerSummary } from '../lib/types'

interface Props {
  index: MinerIndex
  title: string
  // Charted miners in color-slot order context; ids map to slots.
  miners: MinerSummary[]
  slots: Map<string, number>
  // Exact per-sector data for selected miners. Without it (overview), lines come from the
  // index's 30-day strips.
  loaded: Map<string, DecodedMiner> | null
  dark: boolean
}

function mergeHistograms(hists: Histogram[]): Histogram {
  const sum = new Map<number, number>()
  for (const h of hists) for (const [b, c] of h) sum.set(b, (sum.get(b) ?? 0) + c)
  return [...sum].sort((a, b) => a[0] - b[0])
}

// One survival line per miner (first SERIES_SLOTS by slot), the rest folded into one line.
function SelectionChart({ index, title, miners, slots, loaded, dark }: Props) {
  const ready = !loaded || miners.every((m) => loaded.has(m.id))

  const series = useMemo((): Series[] => {
    if (!ready) return []
    const buckets: Buckets = loaded ? DAILY : stripBuckets(index.height)
    const histOf = (m: MinerSummary): Histogram => (loaded ? histogram(loaded.get(m.id)!.endEpoch) : m.strip)
    const bySlot = [...miners].sort((a, b) => slots.get(a.id)! - slots.get(b.id)!)
    const own = bySlot.filter((m) => slots.get(m.id)! < SERIES_SLOTS)
    const rest = bySlot.filter((m) => slots.get(m.id)! >= SERIES_SLOTS)
    const out: Series[] = own.map((m) => ({
      id: m.id,
      label: m.id,
      color: seriesColor(slots.get(m.id)!, dark),
      hist: histOf(m),
      buckets,
      lastEpoch: m.lastExpiration,
    }))
    if (rest.length) {
      out.push({
        id: 'other',
        label: `${rest.length} other miners`,
        members: rest.map((m) => m.id),
        color: seriesColor(SERIES_SLOTS, dark),
        hist: mergeHistograms(rest.map(histOf)),
        buckets,
        lastEpoch: rest.reduce((a, m) => Math.max(a, m.lastExpiration), 0),
      })
    }
    return out
  }, [ready, index.height, miners, slots, loaded, dark])

  if (series.length === 0) return <div className="panel muted">Loading selection…</div>

  const live = miners.reduce((s, m) => s + m.live, 0)
  const faulty = miners.reduce((s, m) => s + m.faulty, 0)
  const end = miners.reduce((a, m) => Math.max(a, m.lastExpiration), 0)

  return (
    <ChartPanel title={title} live={live} faulty={faulty} end={end} index={index}>
      <SurvivalChart
        series={series}
        normalize={series.length > 1}
        height={index.height}
        genesisTimestamp={index.genesisTimestamp}
      />
    </ChartPanel>
  )
}

export default SelectionChart
