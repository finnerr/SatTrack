/**
 * Unit tests for classifier functions in fetch-satellite-data.mjs.
 * Runs via vitest (the file is picked up by the default glob).
 */
import { describe, it, expect } from 'vitest'

// ── Inline copies of classifier functions (from fetch-satellite-data.mjs) ────
// We duplicate rather than import to avoid pulling in the whole script.

function classifyOrbit(meanMotion, ecc) {
  if (meanMotion >= 11.25) return 'LEO'
  if (meanMotion >= 2.0)   return 'MEO'
  if (meanMotion >= 0.9 && meanMotion <= 1.1 && ecc < 0.02) return 'GEO'
  return 'HEO'
}

function classifyRcs(rcsValue) {
  if (rcsValue === null || isNaN(rcsValue)) return null
  if (rcsValue < 0.1)  return 'SMALL'
  if (rcsValue < 1.0)  return 'MEDIUM'
  return 'LARGE'
}

function mapUserType(raw) {
  if (!raw) return null
  const r = raw.toLowerCase()
  const hasMilitary   = r.includes('military')
  const hasGovernment = r.includes('government')
  const hasCivil      = r.includes('civil')
  const hasCommercial = r.includes('commercial')
  const count = [hasMilitary, hasGovernment, hasCivil, hasCommercial].filter(Boolean).length
  if (count > 1)      return 'MIXED'
  if (hasMilitary)    return 'MILITARY'
  if (hasGovernment)  return 'GOVERNMENT'
  if (hasCivil)       return 'CIVIL'
  if (hasCommercial)  return 'COMMERCIAL'
  return null
}

function mapPurpose(raw) {
  if (!raw) return null
  const r = raw.toLowerCase()
  if (r.includes('communications') || r.includes('communication')) return 'COMMUNICATIONS'
  if (r.includes('navigation') || r.includes('positioning'))       return 'NAVIGATION'
  if (r.includes('weather') || r.includes('meteorolog'))           return 'WEATHER'
  if (r.includes('earth observation') || r.includes('remote sens')) return 'EARTH_OBSERVATION'
  if (r.includes('space science') || r.includes('astrophysics'))   return 'SPACE_SCIENCE'
  if (r.includes('reconnaissance') || r.includes('surveillance') ||
      r.includes('intelligence') || r.includes('sigint') ||
      r.includes('elint') || r.includes('isr'))                    return 'RECONNAISSANCE'
  if (r.includes('technology'))                                     return 'TECHNOLOGY'
  return 'OTHER'
}

// ── classifyOrbit ─────────────────────────────────────────────────────────────

describe('classifyOrbit', () => {
  it('ISS (mean motion ~15.5) → LEO', () => {
    expect(classifyOrbit(15.5, 0.0007)).toBe('LEO')
  })
  it('boundary 11.25 → LEO', () => {
    expect(classifyOrbit(11.25, 0.0)).toBe('LEO')
  })
  it('MEO range (GPS ~2.0)', () => {
    expect(classifyOrbit(2.0, 0.01)).toBe('MEO')
  })
  it('GEO (mean motion ~1.0, low ecc)', () => {
    expect(classifyOrbit(1.002, 0.001)).toBe('GEO')
  })
  it('HEO (molniya: high ecc at ~2.0 motion boundary)', () => {
    expect(classifyOrbit(1.8, 0.74)).toBe('HEO')
  })
  it('HEO (below 0.9 mean motion)', () => {
    expect(classifyOrbit(0.5, 0.7)).toBe('HEO')
  })
})

// ── classifyRcs ───────────────────────────────────────────────────────────────

describe('classifyRcs', () => {
  it('null → null', () => expect(classifyRcs(null)).toBeNull())
  it('NaN → null', () => expect(classifyRcs(NaN)).toBeNull())
  it('0.05 → SMALL', () => expect(classifyRcs(0.05)).toBe('SMALL'))
  it('boundary 0.1 → MEDIUM', () => expect(classifyRcs(0.1)).toBe('MEDIUM'))
  it('0.5 → MEDIUM', () => expect(classifyRcs(0.5)).toBe('MEDIUM'))
  it('boundary 1.0 → LARGE', () => expect(classifyRcs(1.0)).toBe('LARGE'))
  it('100 → LARGE', () => expect(classifyRcs(100)).toBe('LARGE'))
})

// ── mapUserType ───────────────────────────────────────────────────────────────

describe('mapUserType', () => {
  it('null/empty → null', () => expect(mapUserType(null)).toBeNull())
  it('"Military" → MILITARY', () => expect(mapUserType('Military')).toBe('MILITARY'))
  it('"Government" → GOVERNMENT', () => expect(mapUserType('Government')).toBe('GOVERNMENT'))
  it('"Civil" → CIVIL', () => expect(mapUserType('Civil')).toBe('CIVIL'))
  it('"Commercial" → COMMERCIAL', () => expect(mapUserType('Commercial')).toBe('COMMERCIAL'))
  it('"Military/Government" → MIXED', () => expect(mapUserType('Military/Government')).toBe('MIXED'))
  it('"Commercial/Civil" → MIXED', () => expect(mapUserType('Commercial/Civil')).toBe('MIXED'))
  it('unknown string → null', () => expect(mapUserType('Academic')).toBeNull())
})

// ── mapPurpose ────────────────────────────────────────────────────────────────

describe('mapPurpose', () => {
  it('null/empty → null', () => expect(mapPurpose(null)).toBeNull())
  it('Communications', () => expect(mapPurpose('Communications')).toBe('COMMUNICATIONS'))
  it('Navigation/Positioning', () => expect(mapPurpose('Navigation/Positioning')).toBe('NAVIGATION'))
  it('Weather', () => expect(mapPurpose('Weather')).toBe('WEATHER'))
  it('Earth Observation', () => expect(mapPurpose('Earth Observation')).toBe('EARTH_OBSERVATION'))
  it('Space Science', () => expect(mapPurpose('Space Science')).toBe('SPACE_SCIENCE'))
  it('ISR → RECONNAISSANCE', () => expect(mapPurpose('ISR')).toBe('RECONNAISSANCE'))
  it('Technology Development', () => expect(mapPurpose('Technology Development')).toBe('TECHNOLOGY'))
  it('Education → OTHER', () => expect(mapPurpose('Education')).toBe('OTHER'))
})
