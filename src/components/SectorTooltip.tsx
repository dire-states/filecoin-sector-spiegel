import { useEffect, useState, type CSSProperties } from 'react'
import { SectorState } from '../lib/sectors'
import { epochDate, formatFil, formatSpan, sealProofName } from '../lib/format'
import { sectorDetail, type SectorDetail } from '../lib/glif'

const STATE_LABELS = { [SectorState.Active]: 'active', [SectorState.Faulty]: 'faulty', [SectorState.Recovering]: 'recovering' }
const OFFSET = 12
const WIDTH = 340
// Wait for the pointer to settle before asking Glif, so sweeping the matrix doesn't flood it.
const HOVER_DELAY_MS = 150

interface Props {
  network: string
  minerId: string
  number: number
  state: SectorState
  activation: number
  expiration: number
  // 0 unless faulty.
  earlyExpiration: number
  height: number
  genesisTimestamp: number
  x: number
  y: number
  pinned: boolean
}

type Remote = { sector: number; detail?: SectorDetail; error?: string }

function SectorTooltip(props: Props) {
  const { network, minerId, number, state, activation, expiration, earlyExpiration, height, genesisTimestamp, x, y, pinned } = props
  const [remote, setRemote] = useState<Remote | null>(null)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(
      () => {
        sectorDetail(network, minerId, number)
          .then((detail) => !cancelled && setRemote({ sector: number, detail }))
          .catch((err: Error) => !cancelled && setRemote({ sector: number, error: err.message }))
      },
      pinned ? 0 : HOVER_DELAY_MS,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [network, minerId, number, pinned])

  // Flip to the other side of the cursor near the right/bottom edges.
  const left = x + OFFSET + WIDTH > window.innerWidth ? x - OFFSET - WIDTH : x + OFFSET
  const style: CSSProperties = { left, width: WIDTH }
  if (y > window.innerHeight / 2) style.bottom = window.innerHeight - y + OFFSET
  else style.top = y + OFFSET

  const end = earlyExpiration > 0 ? Math.min(expiration, earlyExpiration) : expiration
  const date = (e: number) => `${epochDate(e, genesisTimestamp)} (${e})`
  const current = remote?.sector === number ? remote : null
  const info = current?.detail?.info

  return (
    <div className={pinned ? 'tooltip pinned' : 'tooltip'} style={style}>
      <div className="tooltip-title">
        Sector {number} <span className={`badge ${STATE_LABELS[state]}`}>{STATE_LABELS[state]}</span>
        {pinned && <span className="tooltip-hint">Esc to close</span>}
      </div>
      <dl>
        <dt>Activation</dt>
        <dd>{date(activation)}</dd>
        <dt>Expiration</dt>
        <dd>{date(expiration)}</dd>
        {earlyExpiration > 0 && (
          <>
            <dt>Early expiry</dt>
            <dd>
              {date(earlyExpiration)}
              <div className="muted">terminated then unless the fault is recovered</div>
            </dd>
          </>
        )}
        <dt>Lifetime left</dt>
        <dd>
          <strong>{formatSpan(end - height)}</strong> · age {formatSpan(height - activation)}
        </dd>
      </dl>
      <div className="tooltip-section">Live from Glif</div>
      {!current && <div className="tooltip-loading">Loading…</div>}
      {current?.error && <div className="error">{current.error}</div>}
      {current?.detail && !info && <div className="tooltip-loading">Sector not found at chain head</div>}
      {info && (
        <dl>
          <dt>Location</dt>
          <dd>
            deadline {current.detail!.deadline ?? '?'}, partition {current.detail!.partition ?? '?'}
          </dd>
          <dt>Seal proof</dt>
          <dd>{sealProofName(info.SealProof)}</dd>
          <dt>Sealed CID</dt>
          <dd className="mono">{info.SealedCID['/']}</dd>
          {info.SectorKeyCID && (
            <>
              <dt>Sector key</dt>
              <dd className="mono">{info.SectorKeyCID['/']}</dd>
            </>
          )}
          {info.Expiration !== expiration && (
            <>
              <dt>Expiration now</dt>
              <dd>{date(info.Expiration)}</dd>
            </>
          )}
          <dt>Power base</dt>
          <dd>{date(info.PowerBaseEpoch)}</dd>
          <dt>Deal weight</dt>
          <dd>{info.DealWeight}</dd>
          <dt>Verified weight</dt>
          <dd>{info.VerifiedDealWeight}</dd>
          <dt>Initial pledge</dt>
          <dd>{formatFil(info.InitialPledge)}</dd>
          <dt>Daily fee</dt>
          <dd>{formatFil(info.DailyFee ?? '0', 8)}</dd>
        </dl>
      )}
    </div>
  )
}

export default SectorTooltip
