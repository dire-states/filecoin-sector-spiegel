import { useEffect, useMemo, useState } from 'react'
import './App.css'
import Header from './components/Header'
import LeftPane, { type SortKey } from './components/LeftPane'
import MainPane from './components/MainPane'
import BottomPane from './components/BottomPane'
import { NETWORKS, netFromUrl, type NetKey } from './lib/networks'
import { decodeMiner, type DecodedMiner } from './lib/sectors'
import type { MinerData, MinerIndex, MinerSummary } from './lib/types'

class NotFound extends Error {}

async function getJson<T>(base: string, path: string): Promise<T> {
  const res = await fetch(base + path)
  if (res.status === 404) throw new NotFound(path)
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

const SORTS: Record<SortKey, (a: MinerSummary, b: MinerSummary) => number> = {
  live: (a, b) => b.live - a.live,
  end: (a, b) => a.lastExpiration - b.lastExpiration,
  faulty: (a, b) => b.faulty - a.faulty || b.live - a.live,
}

// Holds the network choice; everything else lives in Dashboard, which remounts per network so
// selection, caches and color slots never leak between datasets.
function App() {
  const [net, setNet] = useState<NetKey>(netFromUrl)

  function switchNet(next: NetKey) {
    const url = new URL(window.location.href)
    if (next === 'calibnet') url.searchParams.delete('net')
    else url.searchParams.set('net', next)
    window.history.replaceState(null, '', url)
    setNet(next)
  }

  return <Dashboard key={net} net={net} onNet={switchNet} />
}

function Dashboard({ net, onNet }: { net: NetKey; onNet: (net: NetKey) => void }) {
  const base = NETWORKS[net].base
  const [index, setIndex] = useState<MinerIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('live')
  // Empty selection means all miners.
  const [selected, setSelected] = useState<string[]>([])
  // Chart color slot per selected miner. Kept stable while a miner stays selected, so changing
  // the selection never repaints the others; freed slots go to the next newly selected miner.
  const [slots, setSlots] = useState<Map<string, number>>(new Map())
  const [loaded, setLoaded] = useState<Map<string, DecodedMiner>>(new Map())

  function select(ids: string[]) {
    const next = new Map<string, number>()
    for (const id of ids) if (slots.has(id)) next.set(id, slots.get(id)!)
    const used = new Set(next.values())
    for (const id of ids) {
      if (next.has(id)) continue
      let slot = 0
      while (used.has(slot)) slot++
      next.set(id, slot)
      used.add(slot)
    }
    setSelected(ids)
    setSlots(next)
  }

  // Plain click selects just this miner (or clears when it's the only one);
  // Shift- or Ctrl/Cmd-click adds or removes it from the selection.
  function clickMiner(e: React.MouseEvent, id: string) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      select(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
    } else {
      select(selected.length === 1 && selected[0] === id ? [] : [id])
    }
  }

  useEffect(() => {
    getJson<MinerIndex>(base, 'miners.json')
      .then(setIndex)
      .catch((err: Error) => setError(err instanceof NotFound ? `No ${NETWORKS[net].label} data yet.` : err.message))
  }, [base, net])

  // Miners matching the search, in the chosen order: drives the list and the overview.
  const listed = useMemo(() => {
    if (!index) return []
    const q = search.trim().toLowerCase()
    return index.miners.filter((m) => m.id.toLowerCase().includes(q)).sort(SORTS[sort])
  }, [index, search, sort])

  const selectedMiners = useMemo(
    () => (index ? index.miners.filter((m) => selected.includes(m.id)).sort(SORTS[sort]) : []),
    [index, selected, sort],
  )

  // Per-sector files load only for selected miners; the overview works from the index alone.
  useEffect(() => {
    const missing = selectedMiners.filter((m) => !loaded.has(m.id))
    if (missing.length === 0) return
    let cancelled = false
    Promise.all(missing.map((m) => getJson<MinerData>(base, `miners/${m.id}.json`).then(decodeMiner)))
      .then((decoded) => {
        if (cancelled) return
        setLoaded((prev) => {
          const next = new Map(prev)
          for (const d of decoded) next.set(d.id, d)
          return next
        })
      })
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [base, selectedMiners, loaded])

  return (
    <div className="app">
      <Header index={index} net={net} onNet={onNet} />
      <LeftPane
        index={index}
        miners={listed}
        selected={selected}
        onMinerClick={clickMiner}
        onClear={() => select([])}
        search={search}
        onSearch={setSearch}
        sort={sort}
        onSort={setSort}
        error={error}
      />
      <MainPane
        index={index}
        listed={listed}
        selectedMiners={selectedMiners}
        loaded={loaded}
        slots={slots}
        onMinerClick={clickMiner}
      />
      <BottomPane index={index} />
    </div>
  )
}

export default App
