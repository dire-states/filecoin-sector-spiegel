// First value absolute, then differences to the previous value.
export function deltaEncode(values: number[]): number[] {
  return values.map((v, i) => (i === 0 ? v : v - values[i - 1]))
}

export function deltaDecode(deltas: number[]): number[] {
  const out = new Array<number>(deltas.length)
  let acc = 0
  for (let i = 0; i < deltas.length; i++) out[i] = acc += deltas[i]
  return out
}
