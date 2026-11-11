// Live per-sector details straight from Glif's public Lotus nodes (CORS-enabled).
const ENDPOINTS: Record<string, string> = {
  calibrationnet: 'https://api.calibration.node.glif.io/rpc/v1',
  mainnet: 'https://api.node.glif.io/rpc/v1',
}

export interface GlifSector {
  SectorNumber: number
  SealProof: number
  SealedCID: { '/': string }
  SectorKeyCID: { '/': string } | null
  Activation: number
  Expiration: number
  PowerBaseEpoch: number
  DealWeight: string
  VerifiedDealWeight: string
  InitialPledge: string
  DailyFee: string | null
}

export interface SectorDetail {
  info: GlifSector | null
  deadline: number | null
  partition: number | null
}

interface RpcResponse {
  id: number
  result?: unknown
  error?: { message: string }
}

const cache = new Map<string, Promise<SectorDetail>>()

async function load(endpoint: string, miner: string, sector: number): Promise<SectorDetail> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { jsonrpc: '2.0', method: 'Filecoin.StateSectorGetInfo', params: [miner, sector, null], id: 0 },
      { jsonrpc: '2.0', method: 'Filecoin.StateSectorPartition', params: [miner, sector, null], id: 1 },
    ]),
  })
  if (!res.ok) throw new Error(`Glif ${res.status}`)
  const body = (await res.json()) as RpcResponse[]
  const byId = new Map(body.map((r) => [r.id, r]))
  const info = byId.get(0)
  if (info?.error) throw new Error(info.error.message)
  const loc = byId.get(1)?.result as { Deadline: number; Partition: number } | null | undefined
  return { info: (info?.result as GlifSector | null) ?? null, deadline: loc?.Deadline ?? null, partition: loc?.Partition ?? null }
}

export function sectorDetail(network: string, miner: string, sector: number): Promise<SectorDetail> {
  const endpoint = ENDPOINTS[network]
  if (!endpoint) return Promise.reject(new Error(`no Glif endpoint for ${network}`))
  const key = `${network}:${miner}:${sector}`
  let p = cache.get(key)
  if (!p) {
    p = load(endpoint, miner, sector)
    // Don't cache failures, so a later hover retries.
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}
