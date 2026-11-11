import { useEffect, useRef, useState } from 'react'

export interface LegendItem {
  id: string
  label: string
  color: string
  dashed?: boolean
}

// Room kept free at the end of the row for the "+N more" label.
const MORE_WIDTH = 64

export function LineKey({ color, dashed }: { color: string; dashed?: boolean }) {
  return <i className={dashed ? 'line-key dashed' : 'line-key'} style={{ color, background: dashed ? undefined : color }} />
}

// One legend row: shows as many items as fit the width, then "+N more".
function ChartLegend({ items }: { items: LegendItem[] }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(items.length)

  useEffect(() => {
    const row = rowRef.current
    const measure = measureRef.current
    if (!row || !measure) return
    // Measure the full, hidden copy of the row against the visible row's width.
    const fit = () => {
      const width = row.clientWidth
      const children = [...measure.children] as HTMLElement[]
      const end = (i: number) => children[i].offsetLeft + children[i].offsetWidth
      if (children.length === 0 || end(children.length - 1) <= width) return setVisible(children.length)
      let n = 0
      while (n < children.length && end(n) <= width - MORE_WIDTH) n++
      setVisible(n)
    }
    const ro = new ResizeObserver(fit)
    ro.observe(row)
    ro.observe(measure)
    return () => ro.disconnect()
  }, [items])

  const hidden = items.length - visible

  return (
    <div ref={rowRef} className="chart-legend">
      <div ref={measureRef} className="chart-legend-measure" aria-hidden>
        {items.map((it) => (
          <span key={it.id}>
            <LineKey color={it.color} dashed={it.dashed} />
            {it.label}
          </span>
        ))}
      </div>
      {items.slice(0, visible).map((it) => (
        <span key={it.id}>
          <LineKey color={it.color} dashed={it.dashed} />
          {it.label}
        </span>
      ))}
      {hidden > 0 && (
        <span className="muted" title={items.slice(visible).map((it) => it.label).join(', ')}>
          +{hidden} more
        </span>
      )}
    </div>
  )
}

export default ChartLegend
