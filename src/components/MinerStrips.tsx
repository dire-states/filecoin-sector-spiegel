import { useEffect, useMemo, useRef, useState } from 'react'
import { lifetimeRamp, rampColor } from '../lib/colors'
import { epochDate, formatCount } from '../lib/format'
import { bucketEnd, stripBuckets } from '../lib/lifetime'
import type { MinerIndex, MinerSummary } from '../lib/types'

const STRIP_HEIGHT = 10

interface Segment {
  // Share of the miner's live sectors.
  from: number
  to: number
  count: number
  color: string
  label: string
}

// A miner's live sectors as a 100% stacked bar: faulty first, then by remaining lifetime.
function segments(m: MinerSummary, index: MinerIndex, ramp: string[], faultyColor: string): Segment[] {
  const buckets = stripBuckets(index.height)
  const span = Math.max(1, index.totals.lastExpiration - index.height)
  const faultyIn = new Map(m.faultyStrip)
  const out: Segment[] = []
  let at = 0
  const push = (count: number, color: string, label: string) => {
    if (count <= 0) return
    out.push({ from: at / m.live, to: (at + count) / m.live, count, color, label })
    at += count
  }
  push(m.faulty, faultyColor, 'faulty (end at early expiry)')
  for (const [b, count] of m.strip) {
    const end = bucketEnd(b, buckets)
    const from = Math.max(index.height, end - buckets.width)
    push(
      count - (faultyIn.get(b) ?? 0),
      rampColor(ramp, (end - index.height) / span),
      `expire ${epochDate(from, index.genesisTimestamp)} – ${epochDate(end, index.genesisTimestamp)}`,
    )
  }
  return out
}

interface RowProps {
  miner: MinerSummary
  index: MinerIndex
  dark: boolean
  onClick: (e: React.MouseEvent, id: string) => void
}

function StripRow({ miner, index, dark, onClick }: RowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ seg: Segment; x: number; y: number } | null>(null)
  const segs = useMemo(() => {
    const faulty = getComputedStyle(document.documentElement).getPropertyValue('--status-critical').trim()
    return segments(miner, index, lifetimeRamp(dark), faulty)
  }, [miner, index, dark])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = STRIP_HEIGHT * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    for (const seg of segs) {
      ctx.fillStyle = seg.color
      ctx.fillRect(seg.from * width, 0, Math.max(1, (seg.to - seg.from) * width), STRIP_HEIGHT)
    }
  }, [segs, width])

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const t = e.nativeEvent.offsetX / Math.max(1, width)
    const seg = segs.find((s) => t >= s.from && t < s.to)
    setHover(seg ? { seg, x: e.clientX, y: e.clientY } : null)
  }

  return (
    <li>
      <button className="strip-row" onMouseDown={(e) => e.shiftKey && e.preventDefault()} onClick={(e) => onClick(e, miner.id)}>
        <span className="strip-label">
          <span className="miner-id">{miner.id}</span>
          <span className="muted">
            {formatCount(miner.live)}
            {miner.faulty > 0 && <span className="faulty"> · {formatCount(miner.faulty)} faulty</span>}
          </span>
        </span>
        <canvas ref={canvasRef} className="strip" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        <span className="strip-end muted">ends {epochDate(miner.lastExpiration, index.genesisTimestamp)}</span>
      </button>
      {hover && (
        <div
          className="strip-tip"
          style={
            hover.x > window.innerWidth - 260
              ? { right: window.innerWidth - hover.x + 12, top: hover.y + 12 }
              : { left: hover.x + 12, top: hover.y + 12 }
          }
        >
          <strong>{formatCount(hover.seg.count)}</strong> sectors ({Math.round((hover.seg.to - hover.seg.from) * 100)}%)
          <div className="muted">{hover.seg.label}</div>
        </div>
      )}
    </li>
  )
}

interface Props {
  index: MinerIndex
  miners: MinerSummary[]
  dark: boolean
  onClick: (e: React.MouseEvent, id: string) => void
}

// Overview of every miner from the index alone; clicking a row loads its sectors.
function MinerStrips({ index, miners, dark, onClick }: Props) {
  return (
    <ul className="strips">
      {miners.map((m) => (
        <StripRow key={m.id} miner={m} index={index} dark={dark} onClick={onClick} />
      ))}
    </ul>
  )
}

export default MinerStrips
