import { EPOCH_SECONDS, EPOCHS_PER_DAY } from './epochs.ts'

const SECTOR_SIZES = ['2KiB', '8MiB', '512MiB', '32GiB', '64GiB']
// Seal proof ids come in blocks of five sizes per proof version.
const PROOF_VERSIONS = ['V1', 'V1.1', 'V1.1 SyntheticPoRep', 'V1.2 NI-PoRep']

export function sealProofName(proof: number): string {
  const version = PROOF_VERSIONS[Math.floor(proof / 5)]
  return version ? `${SECTOR_SIZES[proof % 5]} ${version}` : `unknown (${proof})`
}

export function epochTime(epoch: number, genesisTimestamp: number): Date {
  return new Date((genesisTimestamp + epoch * EPOCH_SECONDS) * 1000)
}

export function epochDate(epoch: number, genesisTimestamp: number): string {
  return epochTime(epoch, genesisTimestamp).toISOString().slice(0, 10)
}

// Duration between epochs as days below a year, years above.
export function formatSpan(epochs: number): string {
  const days = epochs / EPOCHS_PER_DAY
  if (Math.abs(days) < 365) return `${Math.round(days)} d`
  return `${(days / 365.25).toFixed(1)} y`
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function formatFil(atto: string, decimals = 4): string {
  const v = BigInt(atto)
  const whole = v / 10n ** 18n
  const frac = (v % 10n ** 18n).toString().padStart(18, '0').slice(0, decimals).replace(/0+$/, '')
  return `${whole}${frac ? `.${frac}` : ''} FIL`
}
