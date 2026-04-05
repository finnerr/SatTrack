import type { SimClock } from '../types/satellite'

/** Returns the current simulation time as Unix ms. */
export function getSimTimeMs(clock: SimClock): number {
  return Date.now() + clock.offsetMs
}

/** Formats a Unix ms timestamp as a UTC string matching the StatusBar format. */
export function formatSimUtc(ms: number): string {
  const d   = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  )
}
