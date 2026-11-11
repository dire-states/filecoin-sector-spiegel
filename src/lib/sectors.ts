import { decodeRuns } from './bitfield.ts'
import { deltaDecode } from './delta.ts'
import type { MinerData } from './types.ts'

export const SectorState = { Active: 0, Faulty: 1, Recovering: 2 } as const
export type SectorState = (typeof SectorState)[keyof typeof SectorState]

// Live sectors in sector-number order; all arrays share the same index.
export interface DecodedMiner {
  id: string
  numbers: number[]
  states: Uint8Array
  activation: number[]
  expiration: number[]
  // 0 unless faulty.
  earlyExpiration: number[]
  // When the sector actually ends: early expiration for faulty sectors, on-time otherwise.
  endEpoch: number[]
}

export function decodeMiner(data: MinerData): DecodedMiner {
  const numbers = decodeRuns(data.sectors.live)
  const faultyNumbers = decodeRuns(data.sectors.faulty)
  const faulty = new Set(faultyNumbers)
  const earlyDecoded = deltaDecode(data.earlyExpiration)
  const earlyBySector = new Map(faultyNumbers.map((n, i) => [n, earlyDecoded[i]]))
  const recovering = new Set(decodeRuns(data.sectors.recovering))
  const states = new Uint8Array(numbers.length)
  numbers.forEach((n, i) => {
    if (recovering.has(n)) states[i] = SectorState.Recovering
    else if (faulty.has(n)) states[i] = SectorState.Faulty
  })
  const expiration = deltaDecode(data.expiration)
  const earlyExpiration = numbers.map((n) => earlyBySector.get(n) ?? 0)
  return {
    id: data.id,
    numbers,
    states,
    activation: deltaDecode(data.activation),
    expiration,
    earlyExpiration,
    endEpoch: expiration.map((e, i) => (earlyExpiration[i] ? Math.min(e, earlyExpiration[i]) : e)),
  }
}
