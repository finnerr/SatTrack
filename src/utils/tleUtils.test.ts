import { describe, it, expect } from 'vitest'
import { classifyInclination, parseTleAge } from './tleUtils'

// ── classifyInclination ──────────────────────────────────────────────────────

describe('classifyInclination', () => {
  it('classifies 0° as EQUATORIAL', () => {
    expect(classifyInclination(0)).toBe('EQUATORIAL')
  })
  it('classifies 29.9° as EQUATORIAL', () => {
    expect(classifyInclination(29.9)).toBe('EQUATORIAL')
  })
  it('classifies 30° as MID_LATITUDE', () => {
    expect(classifyInclination(30)).toBe('MID_LATITUDE')
  })
  it('classifies 51.6° (ISS) as MID_LATITUDE', () => {
    expect(classifyInclination(51.6)).toBe('MID_LATITUDE')
  })
  it('classifies 60° as HIGH_INCLINATION', () => {
    expect(classifyInclination(60)).toBe('HIGH_INCLINATION')
  })
  it('classifies 89.9° as HIGH_INCLINATION', () => {
    expect(classifyInclination(89.9)).toBe('HIGH_INCLINATION')
  })
  it('classifies 90° as POLAR', () => {
    expect(classifyInclination(90)).toBe('POLAR')
  })
  it('classifies 95.9° as POLAR', () => {
    expect(classifyInclination(95.9)).toBe('POLAR')
  })
  it('classifies 96° as SUN_SYNCHRONOUS', () => {
    expect(classifyInclination(96)).toBe('SUN_SYNCHRONOUS')
  })
  it('classifies 98.2° (Sentinel) as SUN_SYNCHRONOUS', () => {
    expect(classifyInclination(98.2)).toBe('SUN_SYNCHRONOUS')
  })
  it('classifies 100° as SUN_SYNCHRONOUS', () => {
    expect(classifyInclination(100)).toBe('SUN_SYNCHRONOUS')
  })
  it('classifies 100.1° as RETROGRADE', () => {
    expect(classifyInclination(100.1)).toBe('RETROGRADE')
  })
  it('classifies 150° as RETROGRADE', () => {
    expect(classifyInclination(150)).toBe('RETROGRADE')
  })
})

// ── parseTleAge ───────────────────────────────────────────────────────────────

describe('parseTleAge', () => {
  // Build a minimal TLE line 1 with a known epoch
  // Field layout: cols 19-32 (1-indexed) = epoch
  // "1 25544U 98067A   24001.50000000  .00001234  00000+0  11111-4 0  9999"
  //  position:         18-31 (0-indexed)

  function makeLine1(epochStr: string): string {
    // Pad to fill the epoch field (14 chars from index 18)
    const padded = epochStr.padEnd(14, '0')
    return `1 25544U 98067A   ${padded}  .00001234  00000+0  11111-4 0  9999`
  }

  it('returns ~0 days for an epoch equal to nowMs', () => {
    // Use a known reference: Jan 1, 2024 = year 24, day 1.0
    const refMs = Date.UTC(2024, 0, 1)  // midnight Jan 1, 2024
    const line1 = makeLine1('24001.00000000')
    const result = parseTleAge(line1, refMs)
    expect(result.days).toBeCloseTo(0, 1)
  })

  it('returns ~7 days for a 7-day-old TLE', () => {
    const refMs = Date.UTC(2024, 0, 8)  // Jan 8, 2024
    const line1 = makeLine1('24001.00000000')  // epoch = Jan 1
    const result = parseTleAge(line1, refMs)
    expect(result.days).toBeCloseTo(7, 1)
  })

  it('handles year pivot: yy>=57 → 1900s, yy<57 → 2000s', () => {
    // yy=57 → 1957 (Sputnik era)
    const refMs = Date.UTC(1957, 9, 5)  // Oct 5, 1957
    const line1 = makeLine1('57278.00000000')  // day 278 of 1957
    const result = parseTleAge(line1, refMs)
    expect(result.days).toBeCloseTo(0, 0)
  })

  it('label shows "h old" for sub-day ages', () => {
    const refMs = Date.UTC(2024, 0, 1, 12)  // noon Jan 1
    const line1 = makeLine1('24001.00000000')  // midnight Jan 1
    const result = parseTleAge(line1, refMs)
    expect(result.label).toMatch(/h old/)
  })

  it('label shows "d old" for multi-day ages', () => {
    const refMs = Date.UTC(2024, 0, 15)
    const line1 = makeLine1('24001.00000000')
    const result = parseTleAge(line1, refMs)
    expect(result.label).toMatch(/d old/)
  })
})
