import type { Runs } from './bitfield.ts'

export interface MinerSummary {
  id: string
  live: number
  active: number
  faulty: number
  recovering: number
  // Latest effective expiration among live sectors (early expiration for faulty ones):
  // when this miner's last sector dies.
  lastExpiration: number
  // What-if: last expiration if every sector (faulty ones recovered) is extended to its maximum lifetime.
  maxLastExpiration: number
  // Overview strip: live sectors by effective end, in STRIP_BUCKET_DAYS buckets from the
  // snapshot height ([bucket, count], see stripBuckets). Lets the overview and charts work
  // without loading the per-miner file.
  strip: [number, number][]
  // The faulty sectors' part of `strip` (bucketed by early expiry), so the overview can show them separately.
  faultyStrip: [number, number][]
}

// Index file: data/miners.json.
export interface MinerIndex {
  network: string
  height: number
  genesisTimestamp: number
  fetchedAt: string
  miners: MinerSummary[]
  totals: {
    lastExpiration: number
    // Sparse daily histogram of effective live sector expirations: [day, count], day = floor(epoch / EPOCHS_PER_DAY).
    expirations: [number, number][]
    // What-if: every live sector (faulty ones recovered) extended to its maximum lifetime.
    maxLastExpiration: number
    maxExpirations: [number, number][]
  }
}

// Per-miner file: data/miners/<id>.json.
export interface MinerData {
  id: string
  height: number
  sectors: {
    live: Runs
    faulty: Runs
    recovering: Runs
  }
  // Delta-coded epochs, aligned with the decoded live sectors.
  activation: number[]
  expiration: number[]
  // Delta-coded early expiration epochs, aligned with the decoded faulty sectors: when each
  // gets terminated if its fault isn't recovered.
  earlyExpiration: number[]
}
