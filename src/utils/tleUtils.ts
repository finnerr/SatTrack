import type { InclinationBand } from '../types/satellite'

/**
 * Parse TLE epoch from Line 1 and return age relative to a reference time.
 * @param line1  - TLE Line 1 string
 * @param nowMs  - Reference time in Unix ms (default: Date.now())
 */
export function parseTleAge(line1: string, nowMs = Date.now()): { days: number; label: string } {
  const epochStr = line1.substring(18, 32).trim()
  const yy = parseInt(epochStr.substring(0, 2), 10)
  const fullYear = yy >= 57 ? 1900 + yy : 2000 + yy
  const dayFrac = parseFloat(epochStr.substring(2))
  const epoch = new Date(Date.UTC(fullYear, 0, 1))
  epoch.setUTCDate(epoch.getUTCDate() + Math.floor(dayFrac) - 1)
  epoch.setUTCMilliseconds(epoch.getUTCMilliseconds() + (dayFrac % 1) * 86_400_000)
  const days = (nowMs - epoch.getTime()) / 86_400_000
  const label = days < 1 ? `${Math.round(days * 24)}h old` : `${days.toFixed(1)}d old`
  return { days, label }
}

/**
 * Parse inclination in degrees from TLE Line 2 (cols 9–16, 1-indexed).
 */
export function parseTleInclination(line2: string): number {
  return parseFloat(line2.substring(8, 16))
}

/**
 * Classify inclination angle into an InclinationBand.
 * SUN_SYNCHRONOUS is checked before POLAR since SSO is a subset of 90–100°.
 */
export function classifyInclination(incDeg: number): InclinationBand {
  if (incDeg > 100)              return 'RETROGRADE'
  if (incDeg >= 96)              return 'SUN_SYNCHRONOUS'   // SSO band ~96–100°
  if (incDeg >= 90)              return 'POLAR'
  if (incDeg >= 60)              return 'HIGH_INCLINATION'
  if (incDeg >= 30)              return 'MID_LATITUDE'
  return 'EQUATORIAL'
}
