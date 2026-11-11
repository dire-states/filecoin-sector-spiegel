import { useEffect, useState } from 'react'

// Sequential blue ramp (steps 100 -> 700), light to dark.
const BLUE_RAMP = [
  '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
  '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b',
]

// Near-zero lifetime recedes toward the surface: light end on light, dark end on dark.
export function lifetimeRamp(dark: boolean): string[] {
  return dark ? [...BLUE_RAMP].reverse() : BLUE_RAMP
}

// t in [0, 1]: 0 = expires now, 1 = network's last expiration.
export function rampColor(ramp: string[], t: number): string {
  const i = Math.round(Math.min(1, Math.max(0, t)) * (ramp.length - 1))
  return ramp[i]
}

// Categorical slots in fixed order (validated for CVD separation); never cycled.
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
export const SERIES_SLOTS = SERIES_LIGHT.length
// Everything past the last slot folds into one "other" series.
export const OTHER_COLOR = '#898781'

export function seriesColor(slot: number, dark: boolean): string {
  return (dark ? SERIES_DARK : SERIES_LIGHT)[slot] ?? OTHER_COLOR
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(DARK_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = () => setDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return dark
}
