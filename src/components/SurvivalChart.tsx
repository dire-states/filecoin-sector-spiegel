import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useDarkMode } from '../lib/colors'
import { EPOCH_SECONDS } from '../lib/epochs'
import { epochDate, formatCompact, formatCount } from '../lib/format'
import { DAILY, liveAt, survivalCurve, type Buckets, type Histogram } from '../lib/lifetime'
import ChartLegend, { LineKey } from './ChartLegend'

export interface Series {
  id: string
  label: string
  color: string
  hist: Histogram
  // Bucket layout of `hist`; daily by default.
  buckets?: Buckets
  // Exact last expiration, when coarse buckets would otherwise round the end up.
  lastEpoch?: number
  // Projection / what-if lines.
  dashed?: boolean
  // For a line that combines several entities: listed one by one in the legend.
  members?: string[]
}

interface Props {
  series: Series[]
  // Percent of each series' own starting count, so differently sized miners compare on one axis.
  normalize?: boolean
  // What a counted item is called in the hover readout.
  unit?: string
  height: number
  genesisTimestamp: number
}

const FONT = '10px system-ui, -apple-system, "Segoe UI", sans-serif'

function niceStep(max: number, count: number): number {
  const raw = Math.max(1e-9, max / count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
}

function SurvivalChart({ series, normalize = false, unit = 'live', height, genesisTimestamp }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const dark = useDarkMode()
  // Hovered epoch and the cursor's x within the plot area, or null when not hovering.
  const [hover, setHover] = useState<{ epoch: number; left: number } | null>(null)

  const curves = useMemo(
    () =>
      series.map((s) => {
        const points = survivalCurve(s.hist, height, s.buckets ?? DAILY)
        const last = points[points.length - 1]
        if (s.lastEpoch !== undefined && points.length > 1) {
          last.epoch = Math.max(points[points.length - 2].epoch, Math.min(last.epoch, s.lastEpoch))
        }
        return { ...s, points }
      }),
    [series, height],
  )
  const end = Math.max(...curves.map((c) => c.points[c.points.length - 1].epoch))
  // The end marker covers the real (solid) series; dashed what-if lines don't move it.
  const primaryEnd = Math.max(...curves.filter((c) => !c.dashed).map((c) => c.points[c.points.length - 1].epoch))
  const start = (c: (typeof curves)[number]) => Math.max(1, c.points[0].live)
  const value = (c: (typeof curves)[number], live: number) => (normalize ? (live / start(c)) * 100 : live)

  const toSec = (epoch: number) => genesisTimestamp + epoch * EPOCH_SECONDS
  const toEpoch = (sec: number) => (sec - genesisTimestamp) / EPOCH_SECONDS

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return

    // Shared x: every step epoch of every series. Values hold until the next x (step-after).
    const epochs = [...new Set(curves.flatMap((c) => c.points.map((p) => p.epoch)))].sort((a, b) => a - b)
    const data: uPlot.AlignedData = [
      epochs.map(toSec),
      ...curves.map((c) => epochs.map((e) => value(c, liveAt(c.points, e)))),
    ]

    const css = getComputedStyle(el)
    const muted = css.getPropertyValue('--muted').trim()
    const text = css.getPropertyValue('--text').trim()
    const grid = css.getPropertyValue('--grid').trim()
    const axis = css.getPropertyValue('--axis').trim()
    const stepped = uPlot.paths.stepped!({ align: 1 })

    const opts: uPlot.Options = {
      width: Math.max(1, el.clientWidth),
      height: Math.max(1, el.clientHeight),
      legend: { show: false },
      cursor: { x: true, y: false, points: { show: false }, drag: { x: false, y: false } },
      // Dates are UTC everywhere else on the page.
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), 'Etc/UTC'),
      scales: {
        x: { time: true, range: [toSec(height), toSec(end)] },
        y: { range: (_u, _min, max) => [0, normalize ? 100 : Math.max(1, max)] },
      },
      axes: [
        {
          stroke: muted,
          font: FONT,
          size: 20,
          space: 56,
          // Years once ticks are a year apart, otherwise year-month.
          values: (_u, splits, _ax, _space, incr) =>
            splits.map((s) => new Date(s * 1e3).toISOString().slice(0, incr >= 360 * 86400 ? 4 : 7)),
          grid: { show: false },
          ticks: { stroke: axis, size: 4 },
        },
        {
          stroke: muted,
          font: FONT,
          size: 40,
          gap: 4,
          splits: (_u, _ax, _min, max) => {
            const step = niceStep(max, 2)
            const out: number[] = []
            for (let v = 0; v <= max + 1e-9; v += step) out.push(v)
            return out
          },
          values: (_u, splits) => splits.map((v) => (normalize ? `${Math.round(v)}%` : formatCompact(v))),
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
        },
      ],
      series: [
        {},
        ...curves.map((c) => ({
          label: c.label,
          stroke: c.color,
          width: 2,
          dash: c.dashed ? [5, 3] : undefined,
          paths: stepped,
          points: { show: false },
        })),
      ],
      hooks: {
        setCursor: [
          (u) => {
            const left = u.cursor.left ?? -1
            setHover(left < 0 ? null : { epoch: toEpoch(u.posToVal(left, 'x')), left })
          },
        ],
        // "all expired" marker at the latest real end.
        draw: [
          (u) => {
            const ctx = u.ctx
            const x = Math.round(u.valToPos(toSec(primaryEnd), 'x', true))
            const { top, height: h } = u.bbox
            const dpr = uPlot.pxRatio
            ctx.save()
            ctx.setLineDash([])
            ctx.strokeStyle = muted
            ctx.lineWidth = dpr
            ctx.beginPath()
            ctx.moveTo(x, top)
            ctx.lineTo(x, top + h)
            ctx.stroke()
            ctx.fillStyle = text
            ctx.font = `${10 * dpr}px system-ui, -apple-system, "Segoe UI", sans-serif`
            ctx.textAlign = primaryEnd === end ? 'right' : 'center'
            ctx.textBaseline = 'bottom'
            ctx.fillText(`all expired ${epochDate(primaryEnd, genesisTimestamp)}`, x, top - 2 * dpr)
            ctx.restore()
          },
        ],
      },
      padding: [14, 12, 0, 0],
    }

    const u = new uPlot(opts, data, el)
    plotRef.current = u
    const ro = new ResizeObserver(() => u.setSize({ width: Math.max(1, el.clientWidth), height: Math.max(1, el.clientHeight) }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
      plotRef.current = null
    }
    // Rebuild on data, mode or theme changes; the helpers above derive from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curves, normalize, height, genesisTimestamp, dark])

  const readout =
    hover === null
      ? null
      : curves.map((c) => {
          const live = liveAt(c.points, hover.epoch)
          return { c, live, pct: (live / start(c)) * 100 }
        })
  const plotLeft = plotRef.current ? plotRef.current.over.offsetLeft : 0
  // The readout floats in viewport coordinates so long lists aren't clipped by the panel.
  let tipStyle: React.CSSProperties = {}
  if (hover && plotRef.current) {
    const r = plotRef.current.over.getBoundingClientRect()
    const x = r.left + hover.left
    tipStyle = x > r.left + r.width / 2 ? { right: window.innerWidth - x + 10 } : { left: x + 10 }
    if (r.top > window.innerHeight / 2) tipStyle.bottom = window.innerHeight - r.bottom
    else tipStyle.top = r.top
  }

  return (
    <div className="chart-wrap">
      {series.length > 1 && (
        <ChartLegend
          items={series.flatMap((s) =>
            s.members
              ? s.members.map((m) => ({ id: `${s.id}:${m}`, label: m, color: s.color, dashed: s.dashed }))
              : [{ id: s.id, label: s.label, color: s.color, dashed: s.dashed }],
          )}
        />
      )}
      <div className="chart">
        <div ref={wrapRef} className="chart-plot" />
        {hover && readout && plotRef.current && (
          <>
            {readout.map(({ c, live }) => (
              <i
                key={c.id}
                className="chart-dot"
                style={{
                  left: plotLeft + hover.left,
                  top: plotRef.current!.over.offsetTop + plotRef.current!.valToPos(value(c, live), 'y'),
                  background: c.color,
                }}
              />
            ))}
            <div className="chart-tip" style={tipStyle}>
              <div className="muted">{epochDate(hover.epoch, genesisTimestamp)}</div>
              {readout.map(({ c, live, pct }) => (
                <div key={c.id} className="chart-tip-row">
                  {readout.length > 1 && <LineKey color={c.color} dashed={c.dashed} />}
                  <strong>{normalize ? `${Math.round(pct)}%` : formatCount(live)}</strong>
                  <span className="muted">
                    {normalize ? `${formatCount(live)} ${unit}` : `${unit} (${Math.round(pct)}%)`}
                    {readout.length > 1 && ` · ${c.label}`}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default SurvivalChart
