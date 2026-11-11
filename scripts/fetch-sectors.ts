// Snapshot basic sector data of all miners with live sectors into a data repo:
// <out>/miners.json (index) and <out>/miners/<id>.json (one per miner).
// Usage: [LOTUS_API=http://host:1234/rpc/v1] node scripts/fetch-sectors.ts --out <data repo> [--commit] [--allow-stale]
import { execFileSync } from 'node:child_process'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { decodeRuns, encodeRuns, type Runs } from '../src/lib/bitfield.ts'
import { deltaEncode } from '../src/lib/delta.ts'
import { EPOCHS_PER_DAY } from '../src/lib/epochs.ts'
import { histogram, stripBuckets } from '../src/lib/lifetime.ts'
import { decodeMiner } from '../src/lib/sectors.ts'
import type { History, MinerChange, MinerData, MinerIndex, MinerSummary } from '../src/lib/types.ts'

const { values: args } = parseArgs({
  options: {
    out: { type: 'string' },
    commit: { type: 'boolean', default: false },
    'allow-stale': { type: 'boolean', default: false },
  },
})
if (!args.out) throw new Error('--out <data repo directory> is required')
const OUT_PATH = resolve(args.out)
const DATA_DIR = pathToFileURL(`${OUT_PATH}/`)
const MINERS_DIR = new URL('miners/', DATA_DIR)

// Each data repo declares its network; never write one network's data into another's repo.
const dataset = JSON.parse(await readFile(new URL('dataset.json', DATA_DIR), 'utf8')) as { network: string }
// Local nodes per network; LOTUS_API overrides. The network-name check below catches a wrong port.
const DEFAULT_API: Record<string, string> = {
  calibrationnet: 'http://192.168.50.123:1234/rpc/v1',
  mainnet: 'http://192.168.50.123:1235/rpc/v1',
}
const API =
  process.env.LOTUS_API ??
  DEFAULT_API[dataset.network] ??
  (() => {
    throw new Error(`LOTUS_API must be set for ${dataset.network}`)
  })()
const CONCURRENCY = 32
// Per-miner parallelism for StateSectorExpiration lookups (runs inside the miner pool).
const EXPIRATION_BATCH = 32
// A head older than this means the node is still syncing; the snapshot height would be wrong.
const MAX_HEAD_LAG_SECONDS = 600
// Sectors per StateMinerSectors request.
const SECTORS_CHUNK = 50_000
const DEADLINES = 48

let rpcId = 0
async function rpc<T>(method: string, params: unknown[], attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: `Filecoin.${method}`, params, id: ++rpcId }),
      })
      const body = (await res.json()) as { result?: T; error?: { message: string } }
      if (body.error) throw new Error(`${method}: ${body.error.message}`)
      return body.result as T
    } catch (err) {
      if (attempt >= attempts) {
        const cause = (err as { cause?: { code?: string } }).cause?.code
        throw cause ? new Error(`${method}: cannot reach ${API} (${cause})`) : err
      }
    }
  }
}

async function pool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

interface Partition {
  LiveSectors: Runs
  FaultySectors: Runs
  RecoveringSectors: Runs
}

interface OnChainSector {
  SectorNumber: number
  SealProof: number
  Activation: number
  Expiration: number
}

// builtin-actors seal_proof_sector_maximum_lifetime: 540 days for V1 proofs (ids 0-4),
// 5 years for V1.1, SyntheticPoRep and NI-PoRep.
const EPOCHS_PER_YEAR = 365 * EPOCHS_PER_DAY + EPOCHS_PER_DAY / 4
function maxLifetime(sealProof: number): number {
  return sealProof < 5 ? 540 * EPOCHS_PER_DAY : 5 * EPOCHS_PER_YEAR
}

function addToHistogram(hist: Map<number, number>, epochs: number[]) {
  for (const [day, count] of histogram(epochs)) hist.set(day, (hist.get(day) ?? 0) + count)
}

async function readJson<T>(url: URL): Promise<T | null> {
  try {
    return JSON.parse(await readFile(url, 'utf8')) as T
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return null
    throw err
  }
}

// The previous snapshot's file for a miner, if it is older than this run (a re-run at the same
// head has nothing to compare against).
async function previousMiner(id: string, height: number): Promise<MinerData | null> {
  const old = await readJson<MinerData>(new URL(`${id}.json`, MINERS_DIR))
  return old && old.height < height ? old : null
}

// Compares a miner's live sectors with the previous snapshot by sector number.
function diffMiner(id: string, old: MinerData, numbers: number[], expiration: number[], height: number): MinerChange {
  const prev = decodeMiner(old)
  const before = new Map(prev.numbers.map((n, i) => [n, prev.expiration[i]]))
  const change: MinerChange = { id, extended: 0, extendedDays: 0, expired: 0, terminated: 0, added: 0 }
  numbers.forEach((n, i) => {
    const was = before.get(n)
    if (was === undefined) change.added++
    else if (expiration[i] > was) {
      change.extended++
      change.extendedDays += (expiration[i] - was) / EPOCHS_PER_DAY
    }
    before.delete(n)
  })
  // What's left is gone: on time if its expiration has passed, terminated early otherwise.
  for (const was of before.values()) {
    if (was <= height) change.expired++
    else change.terminated++
  }
  change.extendedDays = Math.round(change.extendedDays)
  return change
}

const hasChanges = (c: MinerChange) => c.extended + c.expired + c.terminated + c.added > 0

async function fetchMiner(
  id: string,
  tsk: unknown,
  height: number,
): Promise<{
  summary: MinerSummary
  expirations: number[]
  maxExpirations: number[]
  change: MinerChange | null
  seconds: number
}> {
  const started = Date.now()
  const live: number[] = []
  const faulty: number[] = []
  const recovering: number[] = []
  for (let dl = 0; dl < DEADLINES; dl++) {
    const parts = await rpc<Partition[] | null>('StateMinerPartitions', [id, dl, tsk])
    for (const p of parts ?? []) {
      live.push(...decodeRuns(p.LiveSectors))
      faulty.push(...decodeRuns(p.FaultySectors))
      recovering.push(...decodeRuns(p.RecoveringSectors))
    }
  }
  const sort = (a: number[]) => a.sort((x, y) => x - y)
  sort(live)

  // Ask for live sectors only, in chunks, so miners with hundreds of thousands of sectors
  // don't produce one huge response.
  const onChain = new Map<number, OnChainSector>()
  for (let i = 0; i < live.length; i += SECTORS_CHUNK) {
    const filter = encodeRuns(live.slice(i, i + SECTORS_CHUNK))
    for (const s of (await rpc<OnChainSector[] | null>('StateMinerSectors', [id, filter, tsk])) ?? []) onChain.set(s.SectorNumber, s)
  }
  const activation = live.map((n) => onChain.get(n)!.Activation)
  const expiration = live.map((n) => onChain.get(n)!.Expiration)

  // Faulty sectors sit in the early-expiration queue: they get terminated at Early unless recovered.
  sort(faulty)
  const early: number[] = []
  for (let i = 0; i < faulty.length; i += EXPIRATION_BATCH) {
    const batch = faulty.slice(i, i + EXPIRATION_BATCH)
    const res = await Promise.all(batch.map((n) => rpc<{ Early: number }>('StateSectorExpiration', [id, n, tsk])))
    early.push(...res.map((r, j) => r.Early || onChain.get(batch[j])!.Expiration))
  }
  const earlyBySector = new Map(faulty.map((n, i) => [n, early[i]]))
  const effective = live.map((n, i) => Math.min(expiration[i], earlyBySector.get(n) ?? Infinity))
  // Repeated extensions can push expiration up to activation + max lifetime (each single
  // extension is also capped at now + 1278 days, but that limit moves forward with time).
  const maxExpirations = live.map((n, i) => {
    const s = onChain.get(n)!
    return Math.max(expiration[i], s.Activation + maxLifetime(s.SealProof))
  })

  const data: MinerData = {
    id,
    height,
    sectors: { live: encodeRuns(live), faulty: encodeRuns(faulty), recovering: encodeRuns(sort(recovering)) },
    activation: deltaEncode(activation),
    expiration: deltaEncode(expiration),
    earlyExpiration: deltaEncode(early),
  }
  const old = await previousMiner(id, height)
  const change = old ? diffMiner(id, old, live, expiration, height) : null
  await writeFile(new URL(`${id}.json`, MINERS_DIR), JSON.stringify(data))

  const summary: MinerSummary = {
    id,
    live: live.length,
    active: live.length - faulty.length,
    faulty: faulty.length,
    recovering: recovering.length,
    lastExpiration: effective.reduce((a, b) => Math.max(a, b), 0),
    maxLastExpiration: maxExpirations.reduce((a, b) => Math.max(a, b), 0),
    strip: histogram(effective, stripBuckets(height)),
    faultyStrip: histogram(
      effective.filter((_, i) => earlyBySector.has(live[i])),
      stripBuckets(height),
    ),
  }
  return { summary, expirations: effective, maxExpirations, change, seconds: (Date.now() - started) / 1000 }
}

const network = await rpc<string>('StateNetworkName', [])
if (network !== dataset.network) {
  throw new Error(`node at ${API} is on ${network}, but ${OUT_PATH} holds ${dataset.network} data`)
}
const head = await rpc<{ Cids: unknown; Height: number; Blocks: { Timestamp: number }[] }>('ChainHead', [])
const genesis = await rpc<{ Blocks: { Timestamp: number }[] }>('ChainGetGenesis', [])
const tsk = head.Cids
const lag = Math.round(Date.now() / 1000 - head.Blocks[0].Timestamp)
console.log(`${network} @ ${head.Height} (head ${lag}s old)`)
if (lag > MAX_HEAD_LAG_SECONDS && !args['allow-stale']) {
  throw new Error(`node not synced: head ${head.Height} is ${Math.round(lag / 60)} min behind (--allow-stale to override)`)
}
const runStarted = Date.now()

// Extension history: the data repos keep only the latest snapshot, so changes against the
// previous one are recorded here before its files get overwritten.
const HISTORY_URL = new URL('history.json', DATA_DIR)
const history = (await readJson<History>(HISTORY_URL)) ?? { network, entries: [] }
const prevIndex = await readJson<MinerIndex>(new URL('miners.json', DATA_DIR))
const prevHeight = prevIndex && prevIndex.height < head.Height ? prevIndex.height : null
const changes: MinerChange[] = []

const all = await rpc<string[]>('StateListMiners', [tsk])
// Mainnet lists hundreds of thousands of miner actors; most have no sectors left.
let counted = 0
const counts = await pool(all, async (id) => {
  const c = await rpc<{ Live: number }>('StateMinerSectorCount', [id, tsk])
  if (++counted % 10_000 === 0) console.log(`  counted ${counted}/${all.length}`)
  return c
})
const withLive = all.filter((_, i) => counts[i].Live > 0)
console.log(`${all.length} miners, ${withLive.length} with live sectors`)

// Clear stale miner files but keep the directory, so a running dev server keeps serving it.
// A miner that dropped out lost all its sectors since the previous snapshot.
await mkdir(MINERS_DIR, { recursive: true })
const liveIds = new Set(withLive)
for (const f of await readdir(MINERS_DIR)) {
  const id = f.slice(0, -5)
  if (!f.endsWith('.json') || liveIds.has(id)) continue
  const old = await previousMiner(id, head.Height)
  if (old) changes.push(diffMiner(id, old, [], [], head.Height))
  await rm(new URL(f, MINERS_DIR))
}

const perDay = new Map<number, number>()
const maxPerDay = new Map<number, number>()
let maxLastExpiration = 0
// Progress by sector count, since miner sizes range from a handful of sectors to millions.
const totalSectors = counts.reduce((a, c) => a + c.Live, 0)
let done = 0
let doneSectors = 0
const fetchStarted = Date.now()
const miners = await pool(withLive, async (id) => {
  const { summary, expirations, maxExpirations, change, seconds } = await fetchMiner(id, tsk, head.Height)
  if (change && hasChanges(change)) changes.push(change)
  addToHistogram(perDay, expirations)
  addToHistogram(maxPerDay, maxExpirations)
  maxLastExpiration = Math.max(maxLastExpiration, summary.maxLastExpiration)
  doneSectors += summary.live
  const elapsed = (Date.now() - fetchStarted) / 1000
  const eta = Math.round((elapsed / doneSectors) * (totalSectors - doneSectors) / 60)
  console.log(
    `  ${++done}/${withLive.length} ${id}: ${summary.live} sectors, ${summary.faulty} faulty, ${seconds.toFixed(1)}s` +
      ` (${((100 * doneSectors) / totalSectors).toFixed(1)}%, ~${eta} min left)`,
  )
  return summary
})
miners.sort((a, b) => b.live - a.live)

const index: MinerIndex = {
  network,
  height: head.Height,
  genesisTimestamp: genesis.Blocks[0].Timestamp,
  fetchedAt: new Date().toISOString(),
  miners,
  totals: {
    lastExpiration: miners.reduce((a, m) => Math.max(a, m.lastExpiration), 0),
    expirations: [...perDay].sort((a, b) => a[0] - b[0]),
    maxLastExpiration,
    maxExpirations: [...maxPerDay].sort((a, b) => a[0] - b[0]),
  },
}
await writeFile(new URL('miners.json', DATA_DIR), JSON.stringify(index))

if (prevHeight !== null) {
  const recorded = changes.filter(hasChanges).sort((a, b) => b.extended - a.extended || a.id.localeCompare(b.id))
  history.entries.push({ height: head.Height, prevHeight, fetchedAt: index.fetchedAt, changes: recorded })
  await writeFile(HISTORY_URL, JSON.stringify(history))
  const sum = (k: keyof Omit<MinerChange, 'id'>) => recorded.reduce((a, c) => a + c[k], 0)
  console.log(
    `history: ${prevHeight} -> ${head.Height}: ${sum('extended')} extended (${recorded.filter((c) => c.extended).length} miners),` +
      ` ${sum('expired')} expired, ${sum('terminated')} terminated, ${sum('added')} added`,
  )
}
const faultyTotal = miners.reduce((a, m) => a + m.faulty, 0)
console.log(
  `wrote ${OUT_PATH}/miners.json and ${miners.length} miner files: ${doneSectors} sectors, ${faultyTotal} faulty,` +
    ` ${Math.round((Date.now() - runStarted) / 1000)}s`,
)

// One commit per snapshot keeps the full history locally; publish.sh pushes only the latest
// tree to GitHub, as a single parentless commit.
if (args.commit) {
  const git = (...a: string[]) => execFileSync('git', ['-C', OUT_PATH, ...a], { encoding: 'utf8' }).trim()
  git('add', '-A')
  const message = `snapshot ${network} @ ${head.Height} (${index.fetchedAt.slice(0, 10)})`
  git('commit', '--quiet', '-m', message)
  console.log(`committed ${git('rev-parse', '--short', 'HEAD')} ${message}`)
}
