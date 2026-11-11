import { EPOCHS_PER_DAY, STRIP_BUCKET_EPOCHS } from './epochs.ts'

// Sparse counts per bucket: [bucket, count], bucket = floor((epoch - origin) / width).
export type Histogram = [bucket: number, count: number][]

// How a histogram's buckets map to epochs. Daily histograms use absolute days (origin 0);
// overview strips use 30-day buckets counted from the snapshot height.
export interface Buckets {
  width: number
  origin: number
}

export const DAILY: Buckets = { width: EPOCHS_PER_DAY, origin: 0 }

export function stripBuckets(height: number): Buckets {
  return { width: STRIP_BUCKET_EPOCHS, origin: height }
}

export function histogram(epochs: number[], buckets: Buckets = DAILY): Histogram {
  const counts = new Map<number, number>()
  for (const e of epochs) {
    const b = Math.floor((e - buckets.origin) / buckets.width)
    counts.set(b, (counts.get(b) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => a[0] - b[0])
}

// Epoch at which a bucket's sectors are all gone.
export function bucketEnd(bucket: number, buckets: Buckets): number {
  return buckets.origin + (bucket + 1) * buckets.width
}

// Live count over time: each point holds from its epoch until the next point.
export interface SurvivalPoint {
  epoch: number
  live: number
}

export function survivalCurve(hist: Histogram, startEpoch: number, buckets: Buckets = DAILY): SurvivalPoint[] {
  let live = hist.reduce((sum, [, c]) => sum + c, 0)
  const points: SurvivalPoint[] = [{ epoch: startEpoch, live }]
  for (const [b, count] of hist) {
    live -= count
    points.push({ epoch: Math.max(startEpoch, bucketEnd(b, buckets)), live })
  }
  return points
}

export function liveAt(points: SurvivalPoint[], epoch: number): number {
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (points[mid].epoch <= epoch) lo = mid
    else hi = mid - 1
  }
  return points[lo].live
}
