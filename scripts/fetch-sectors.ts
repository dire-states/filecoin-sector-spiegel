// Snapshot basic sector data of all miners with live sectors into a data repo:
// <out>/miners.json (index) and <out>/miners/<id>.json (one per miner).
// Usage: [LOTUS_API=http://host:1234/rpc/v1] node scripts/fetch-sectors.ts --out <data repo> [--commit]
import { execFileSync } from 'node:child_process'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { decodeRuns, encodeRuns, type Runs } from '../src/lib/bitfield.ts'
import { deltaEncode } from '../src/lib/delta.ts'
import { EPOCHS_PER_DAY } from '../src/lib/epochs.ts'
import { histogram, stripBuckets } from '../src/lib/lifetime.ts'
import type { MinerData, MinerIndex, MinerSummary } from '../src/lib/types.ts'

const { values: args } = parseArgs({
  options: { out: { type: 'string' }, commit: { type: 'boolean', default: false } },
})
if (!args.out) throw new Error('--out <data repo directory> is required')
const OUT_PATH = resolve(args.out)
const DATA_DIR = pathToFileURL(`${OUT_PATH}/`)
const MINERS_DIR = new URL('miners/', DATA_DIR)

// Each data repo declares its network; never write one network's data into another's repo.
const dataset = JSON.parse(await readFile(new URL('dataset.json', DATA_DIR), 'utf8')) as { network: string }
// The local calibnet node is the only default; any other network needs LOTUS_API set explicitly.
const API =
  process.env.LOTUS_API ??
  (dataset.network === 'calibrationnet'
    ? 'http://192.168.50.123:1234/rpc/v1'
    : (() => {
        throw new Error(`LOTUS_API must be set for ${dataset.network}`)
      })())
const CONCURRENCY = 32
// Per-miner parallelism for StateSectorExpiration lookups (runs inside the miner pool).
const EXPIRATION_BATCH = 8
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
      if (attempt >= attempts) throw err
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

async function fetchMiner(
  id: string,
  tsk: unknown,
  height: number,
): Promise<{ summary: MinerSummary; expirations: number[]; maxExpirations: number[] }> {
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
  return { summary, expirations: effective, maxExpirations }
}

const network = await rpc<string>('StateNetworkName', [])
if (network !== dataset.network) {
  throw new Error(`node at ${API} is on ${network}, but ${OUT_PATH} holds ${dataset.network} data`)
}
const head = await rpc<{ Cids: unknown; Height: number }>('ChainHead', [])
const genesis = await rpc<{ Blocks: { Timestamp: number }[] }>('ChainGetGenesis', [])
const tsk = head.Cids
console.log(`${network} @ ${head.Height}`)

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
await mkdir(MINERS_DIR, { recursive: true })
for (const f of await readdir(MINERS_DIR)) {
  if (f.endsWith('.json') && !withLive.includes(f.slice(0, -5))) await rm(new URL(f, MINERS_DIR))
}

const perDay = new Map<number, number>()
const maxPerDay = new Map<number, number>()
let maxLastExpiration = 0
let done = 0
const miners = await pool(withLive, async (id) => {
  const { summary, expirations, maxExpirations } = await fetchMiner(id, tsk, head.Height)
  addToHistogram(perDay, expirations)
  addToHistogram(maxPerDay, maxExpirations)
  maxLastExpiration = Math.max(maxLastExpiration, summary.maxLastExpiration)
  if (++done % 50 === 0) console.log(`  ${done}/${withLive.length}`)
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
console.log(`wrote ${OUT_PATH}/miners.json and ${miners.length} miner files`)

if (args.commit) {
  const git = (...a: string[]) => execFileSync('git', ['-C', OUT_PATH, ...a], { stdio: 'inherit' })
  git('add', '-A')
  git('commit', '-m', `snapshot ${network} @ ${head.Height} (${index.fetchedAt.slice(0, 10)})`)
}
