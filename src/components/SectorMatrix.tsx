import { useEffect, useMemo, useRef, useState } from 'react'
import { lifetimeRamp, rampColor } from '../lib/colors'
import { SectorState, type DecodedMiner } from '../lib/sectors'
import type { MinerIndex } from '../lib/types'
import SectorTooltip from './SectorTooltip'

const CELL = 5
// Leaves a 1px gap so neighbouring sectors stay distinguishable.
const FILL = 4
// Rows per canvas. Large miners (500k+ sectors) span thousands of rows; splitting keeps each
// canvas far below browser size limits, and only chunks near the viewport get painted.
const CHUNK_ROWS = 1000

interface Pointer {
  index: number
  x: number
  y: number
}

export interface Pin extends Pointer {
  minerId: string
}

interface Props {
  miner: DecodedMiner
  index: MinerIndex
  dark: boolean
  // The pinned sector, when it belongs to this miner.
  pin: Pin | null
  onPin: (pin: Pin | null) => void
}

// Fill style per sector: remaining lifetime for active sectors, state color otherwise.
type Colorer = (i: number) => string

function Chunk({ firstRow, rows, cols, count, color }: { firstRow: number; rows: number; cols: number; count: number; color: Colorer }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '600px 0px' })
    io.observe(canvas)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !visible) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = cols * CELL * dpr
    canvas.height = rows * CELL * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    const first = firstRow * cols
    const last = Math.min(count, first + rows * cols)
    for (let i = first; i < last; i++) {
      const local = i - first
      ctx.fillStyle = color(i)
      ctx.fillRect((local % cols) * CELL, Math.floor(local / cols) * CELL, FILL, FILL)
    }
  }, [visible, firstRow, rows, cols, count, color])

  return (
    <canvas
      ref={ref}
      className="matrix-chunk"
      style={{ top: firstRow * CELL, width: cols * CELL, height: rows * CELL }}
    />
  )
}

function SectorMatrix({ miner, index, dark, pin: pinned, onPin }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<Pointer | null>(null)
  const cols = Math.max(1, Math.floor(width / CELL))
  const n = miner.numbers.length
  const rows = Math.ceil(n / cols)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  const color = useMemo((): Colorer => {
    const css = getComputedStyle(document.documentElement)
    const faultyColor = css.getPropertyValue('--status-critical').trim()
    const recoveringColor = css.getPropertyValue('--status-warning').trim()
    const ramp = lifetimeRamp(dark)
    const span = Math.max(1, index.totals.lastExpiration - index.height)
    return (i) => {
      const state = miner.states[i]
      if (state === SectorState.Faulty) return faultyColor
      if (state === SectorState.Recovering) return recoveringColor
      return rampColor(ramp, (miner.endEpoch[i] - index.height) / span)
    }
  }, [miner, index, dark])

  function pointerAt(e: React.MouseEvent<HTMLDivElement>): Pointer | null {
    const rect = e.currentTarget.getBoundingClientRect()
    const col = Math.floor((e.clientX - rect.left) / CELL)
    const row = Math.floor((e.clientY - rect.top) / CELL)
    const i = row * cols + col
    return col >= 0 && col < cols && row >= 0 && i < n ? { index: i, x: e.clientX, y: e.clientY } : null
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const p = pointerAt(e)
    onPin(p && p.index !== pinned?.index ? { ...p, minerId: miner.id } : null)
  }

  const tooltip = (p: Pointer, isPinned: boolean) => (
    <SectorTooltip
      key={isPinned ? 'pinned' : 'hover'}
      network={index.network}
      minerId={miner.id}
      number={miner.numbers[p.index]}
      state={miner.states[p.index] as SectorState}
      activation={miner.activation[p.index]}
      expiration={miner.expiration[p.index]}
      earlyExpiration={miner.earlyExpiration[p.index]}
      height={index.height}
      genesisTimestamp={index.genesisTimestamp}
      x={p.x}
      y={p.y}
      pinned={isPinned}
    />
  )

  const chunks = []
  if (width > 0) {
    for (let r = 0; r < rows; r += CHUNK_ROWS) {
      chunks.push(
        <Chunk key={r} firstRow={r} rows={Math.min(CHUNK_ROWS, rows - r)} cols={cols} count={n} color={color} />,
      )
    }
  }

  return (
    <div ref={wrapRef} className="matrix">
      <div
        className="matrix-cells"
        style={{ width: cols * CELL, height: rows * CELL }}
        onMouseMove={(e) => setHover(pointerAt(e))}
        onMouseLeave={() => setHover(null)}
        onClick={onClick}
      >
        {chunks}
        {pinned && (
          <div
            className="cell-highlight"
            style={{ left: (pinned.index % cols) * CELL - 1, top: Math.floor(pinned.index / cols) * CELL - 1 }}
          />
        )}
      </div>
      {pinned && tooltip(pinned, true)}
      {hover && hover.index !== pinned?.index && tooltip(hover, false)}
    </div>
  )
}

export default SectorMatrix
