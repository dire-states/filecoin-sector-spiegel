import type { History } from './types.ts'

// One miner's changes summed over the whole recorded history.
export interface MinerHistory {
  id: string
  extended: number
  extendedDays: number
  // Snapshots in which the miner extended at least one sector.
  extensionRuns: number
  // Height of the snapshot that last recorded an extension (0 if none).
  lastExtended: number
  // Height of the snapshot that last recorded any change.
  lastChanged: number
  expired: number
  terminated: number
  added: number
}

export function aggregateHistory(history: History): MinerHistory[] {
  const byMiner = new Map<string, MinerHistory>()
  for (const entry of history.entries) {
    for (const c of entry.changes) {
      let m = byMiner.get(c.id)
      if (!m) {
        m = { id: c.id, extended: 0, extendedDays: 0, extensionRuns: 0, lastExtended: 0, lastChanged: 0, expired: 0, terminated: 0, added: 0 }
        byMiner.set(c.id, m)
      }
      m.extended += c.extended
      m.extendedDays += c.extendedDays
      m.expired += c.expired
      m.terminated += c.terminated
      m.added += c.added
      m.lastChanged = Math.max(m.lastChanged, entry.height)
      if (c.extended > 0) {
        m.extensionRuns++
        m.lastExtended = Math.max(m.lastExtended, entry.height)
      }
    }
  }
  return [...byMiner.values()]
}
