/**
 * Pure utility functions shared by ContactAlert and the PASSES tab.
 * No imports from the store or React — safe to unit-test in Node.
 */

/** Returns true when a pass's AOS falls within [now, now+leadMs). */
export function isAlertWindow(aosTime: number, now: number, leadMs: number): boolean {
  const timeUntil = aosTime - now
  return timeUntil > 0 && timeUntil <= leadMs
}

/** Formats a remaining-time duration for the contact-alert countdown. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

/** Formats a total contact duration (seconds) as a human-readable string. */
export function formatContactDuration(totalSec: number): string {
  if (totalSec >= 3600) {
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    return `${h}h ${m}m`
  }
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

/** Computes coverage % for a set of passes over a window. */
export function coveragePercent(passDurationsSec: number[], windowHours: number): number {
  if (windowHours <= 0) return 0
  const total = passDurationsSec.reduce((sum, d) => sum + d, 0)
  return (total / (windowHours * 3600)) * 100
}

/**
 * Merges overlapping [aosTime, losTime] intervals and returns total
 * covered seconds. Prevents double-counting when multiple stations
 * simultaneously see the same satellite.
 */
export function mergedContactSec(passes: { aosTime: number; losTime: number }[]): number {
  if (passes.length === 0) return 0
  const sorted = [...passes].sort((a, b) => a.aosTime - b.aosTime)
  let totalMs = 0
  let curStart = sorted[0].aosTime
  let curEnd   = sorted[0].losTime
  for (let i = 1; i < sorted.length; i++) {
    const { aosTime, losTime } = sorted[i]
    if (aosTime <= curEnd) {
      curEnd = Math.max(curEnd, losTime)   // extend current interval
    } else {
      totalMs += curEnd - curStart         // commit gap-free interval
      curStart = aosTime
      curEnd   = losTime
    }
  }
  totalMs += curEnd - curStart
  return totalMs / 1000                    // ms → seconds
}

/**
 * Coverage % using merged intervals — avoids double-counting overlapping
 * passes from multiple stations.
 */
export function mergedCoveragePercent(
  passes: { aosTime: number; losTime: number }[],
  windowHours: number,
): number {
  if (windowHours <= 0) return 0
  return (mergedContactSec(passes) / (windowHours * 3600)) * 100
}
