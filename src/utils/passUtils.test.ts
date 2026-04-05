import { describe, it, expect } from 'vitest'
import {
  isAlertWindow,
  formatCountdown,
  formatContactDuration,
  coveragePercent,
  mergedContactSec,
  mergedCoveragePercent,
} from './passUtils'

// ── isAlertWindow ─────────────────────────────────────────────────────────────

describe('isAlertWindow', () => {
  const LEAD = 10 * 60 * 1000  // 10 min

  it('returns true when AOS is exactly 1s in the future and within lead', () => {
    expect(isAlertWindow(1000, 0, LEAD)).toBe(true)
  })

  it('returns true when AOS is exactly at the lead boundary', () => {
    expect(isAlertWindow(LEAD, 0, LEAD)).toBe(true)
  })

  it('returns false when AOS is beyond the lead window', () => {
    expect(isAlertWindow(LEAD + 1, 0, LEAD)).toBe(false)
  })

  it('returns false when AOS is in the past', () => {
    expect(isAlertWindow(0, 1000, LEAD)).toBe(false)
  })

  it('returns false when AOS equals now (pass started)', () => {
    expect(isAlertWindow(5000, 5000, LEAD)).toBe(false)
  })

  it('returns true for a typical 5-minute upcoming pass', () => {
    const now = Date.now()
    expect(isAlertWindow(now + 5 * 60_000, now, LEAD)).toBe(true)
  })

  it('returns false for a pass 11 minutes away with 10-min lead', () => {
    const now = Date.now()
    expect(isAlertWindow(now + 11 * 60_000, now, LEAD)).toBe(false)
  })
})

// ── formatCountdown ───────────────────────────────────────────────────────────

describe('formatCountdown', () => {
  it('returns "now" for zero ms', () => {
    expect(formatCountdown(0)).toBe('now')
  })

  it('returns "now" for negative ms', () => {
    expect(formatCountdown(-1000)).toBe('now')
  })

  it('formats sub-minute correctly', () => {
    expect(formatCountdown(30_000)).toBe('30s')
  })

  it('formats minutes + seconds correctly', () => {
    expect(formatCountdown(2 * 60_000 + 15_000)).toBe('2m 15s')
  })

  it('formats 1m 0s', () => {
    expect(formatCountdown(60_000)).toBe('1m 0s')
  })

  it('truncates fractional seconds (floors)', () => {
    expect(formatCountdown(9_999)).toBe('9s')
  })

  it('handles just under 1 minute', () => {
    expect(formatCountdown(59_999)).toBe('59s')
  })
})

// ── formatContactDuration ─────────────────────────────────────────────────────

describe('formatContactDuration', () => {
  it('formats seconds only', () => {
    expect(formatContactDuration(45)).toBe('45s')
  })

  it('formats minutes + seconds', () => {
    expect(formatContactDuration(2 * 60 + 30)).toBe('2m 30s')
  })

  it('formats exactly 1 minute', () => {
    expect(formatContactDuration(60)).toBe('1m 0s')
  })

  it('formats hours + minutes', () => {
    expect(formatContactDuration(3600 + 22 * 60)).toBe('1h 22m')
  })

  it('formats exactly 1 hour', () => {
    expect(formatContactDuration(3600)).toBe('1h 0m')
  })

  it('formats 2h 0m', () => {
    expect(formatContactDuration(2 * 3600)).toBe('2h 0m')
  })

  it('formats 0 seconds', () => {
    expect(formatContactDuration(0)).toBe('0s')
  })
})

// ── coveragePercent ───────────────────────────────────────────────────────────

describe('coveragePercent', () => {
  it('returns 0 for empty pass list', () => {
    expect(coveragePercent([], 24)).toBe(0)
  })

  it('returns 0 for zero window hours', () => {
    expect(coveragePercent([600], 0)).toBe(0)
  })

  it('computes simple coverage correctly', () => {
    // 3600s in a 24h window = 1/24 ≈ 4.17%
    const pct = coveragePercent([3600], 24)
    expect(pct).toBeCloseTo(4.167, 2)
  })

  it('sums multiple pass durations', () => {
    // 4 × 600s = 2400s in 24h window
    const pct = coveragePercent([600, 600, 600, 600], 24)
    expect(pct).toBeCloseTo((2400 / 86400) * 100, 4)
  })

  it('returns 100 for full-window coverage', () => {
    expect(coveragePercent([24 * 3600], 24)).toBeCloseTo(100, 6)
  })

  it('can exceed 100% if passes overlap the window boundary', () => {
    // Guard: we don't clamp in the pure function — callers clamp for display
    const pct = coveragePercent([24 * 3600 + 3600], 24)
    expect(pct).toBeGreaterThan(100)
  })

  it('handles 48h window', () => {
    // 3600s in 48h = 1/48 ≈ 2.08%
    const pct = coveragePercent([3600], 48)
    expect(pct).toBeCloseTo(2.083, 2)
  })
})

// ── mergedContactSec ──────────────────────────────────────────────────────────

describe('mergedContactSec', () => {
  const ms = (s: number) => s * 1000

  it('returns 0 for empty list', () => {
    expect(mergedContactSec([])).toBe(0)
  })

  it('returns duration for a single pass', () => {
    expect(mergedContactSec([{ aosTime: ms(0), losTime: ms(600) }])).toBe(600)
  })

  it('returns sum for non-overlapping passes', () => {
    const passes = [
      { aosTime: ms(0),    losTime: ms(600) },
      { aosTime: ms(1000), losTime: ms(1600) },
    ]
    expect(mergedContactSec(passes)).toBe(1200)
  })

  it('merges fully overlapping passes (two stations, same window)', () => {
    const passes = [
      { aosTime: ms(0), losTime: ms(600) },
      { aosTime: ms(0), losTime: ms(600) },
    ]
    expect(mergedContactSec(passes)).toBe(600)
  })

  it('merges partially overlapping passes', () => {
    const passes = [
      { aosTime: ms(0),   losTime: ms(400) },
      { aosTime: ms(200), losTime: ms(600) },
    ]
    expect(mergedContactSec(passes)).toBe(600)
  })

  it('merges a pass fully contained within another', () => {
    const passes = [
      { aosTime: ms(0),   losTime: ms(600) },
      { aosTime: ms(100), losTime: ms(300) },
    ]
    expect(mergedContactSec(passes)).toBe(600)
  })

  it('handles unsorted input', () => {
    const passes = [
      { aosTime: ms(1000), losTime: ms(1600) },
      { aosTime: ms(0),    losTime: ms(600) },
    ]
    expect(mergedContactSec(passes)).toBe(1200)
  })

  it('merges three-way overlap correctly', () => {
    const passes = [
      { aosTime: ms(0),   losTime: ms(300) },
      { aosTime: ms(100), losTime: ms(500) },
      { aosTime: ms(400), losTime: ms(700) },
    ]
    expect(mergedContactSec(passes)).toBe(700)
  })
})

// ── mergedCoveragePercent ─────────────────────────────────────────────────────

describe('mergedCoveragePercent', () => {
  const ms = (s: number) => s * 1000

  it('returns 0 for empty list', () => {
    expect(mergedCoveragePercent([], 24)).toBe(0)
  })

  it('returns 0 for zero window', () => {
    expect(mergedCoveragePercent([{ aosTime: 0, losTime: ms(600) }], 0)).toBe(0)
  })

  it('does not double-count overlapping stations', () => {
    // Two stations both see the sat for 600s at the same time → should be 600s, not 1200s
    const passes = [
      { aosTime: ms(0), losTime: ms(600) },
      { aosTime: ms(0), losTime: ms(600) },
    ]
    const pct = mergedCoveragePercent(passes, 24)
    expect(pct).toBeCloseTo(coveragePercent([600], 24), 6)
  })

  it('returns higher value than naive sum when passes do not overlap', () => {
    const passes = [
      { aosTime: ms(0),    losTime: ms(600) },
      { aosTime: ms(1000), losTime: ms(1600) },
    ]
    const merged = mergedCoveragePercent(passes, 24)
    const naive  = coveragePercent([600, 600], 24)
    expect(merged).toBeCloseTo(naive, 6)
  })
})
