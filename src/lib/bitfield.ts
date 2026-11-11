// Lotus encodes bitfields in JSON as run lengths, alternating unset/set and starting with an unset run.
export type Runs = number[]

export function decodeRuns(runs: Runs): number[] {
  const out: number[] = []
  let pos = 0
  let set = false
  for (const len of runs) {
    if (set) for (let i = 0; i < len; i++) out.push(pos + i)
    pos += len
    set = !set
  }
  return out
}

// Expects sorted, unique numbers.
export function encodeRuns(nums: number[]): Runs {
  if (nums.length === 0) return [0]
  const runs: Runs = []
  let pos = 0
  let i = 0
  while (i < nums.length) {
    const start = nums[i]
    let end = start + 1
    while (i + 1 < nums.length && nums[i + 1] === end) {
      i++
      end++
    }
    i++
    runs.push(start - pos, end - start)
    pos = end
  }
  return runs
}
