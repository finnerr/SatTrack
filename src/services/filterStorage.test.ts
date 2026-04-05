import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadFilters, saveFilters } from './filterStorage'
import type { SatelliteFilters } from '../types/satellite'

// ── Mock localStorage ─────────────────────────────────────────────────────────

const storage: Record<string, string> = {}

beforeEach(() => {
  Object.keys(storage).forEach((k) => delete storage[k])
  vi.stubGlobal('localStorage', {
    getItem:  (k: string) => storage[k] ?? null,
    setItem:  (k: string, v: string) => { storage[k] = v },
    removeItem: (k: string) => { delete storage[k] },
  })
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('filterStorage', () => {
  it('loadFilters returns null when nothing stored', () => {
    expect(loadFilters()).toBeNull()
  })

  it('round-trips a full filter set', () => {
    const filters: SatelliteFilters = {
      countries:        new Set(['US', 'RU']),
      orbitClasses:     new Set(['LEO', 'GEO']),
      objectTypes:      new Set(['PAYLOAD']),
      maxRendered:      500,
      inclinationBands: new Set(['POLAR', 'SUN_SYNCHRONOUS']),
      rcsSizes:         new Set(['SMALL']),
      userTypes:        new Set(['MILITARY', 'COMMERCIAL']),
      purposes:         new Set(['COMMUNICATIONS', 'NAVIGATION']),
      tleAgeBands:      new Set(['FRESH']),
      watchListOnly:    true,
      nameSearch:       '',
    }

    saveFilters(filters)
    const loaded = loadFilters()

    expect(loaded).not.toBeNull()
    expect(loaded!.countries).toEqual(new Set(['US', 'RU']))
    // orbitClasses/inclinationBands/tleAgeBands no longer persisted (removed from UI)
    expect(loaded!.orbitClasses).toBeUndefined()
    expect(loaded!.objectTypes).toEqual(new Set(['PAYLOAD']))
    expect(loaded!.rcsSizes).toEqual(new Set(['SMALL']))
    expect(loaded!.userTypes).toEqual(new Set(['MILITARY', 'COMMERCIAL']))
    expect(loaded!.purposes).toEqual(new Set(['COMMUNICATIONS', 'NAVIGATION']))
    expect(loaded!.watchListOnly).toBe(true)
  })

  it('returns null when stored version does not match', () => {
    storage['sattrack_filters'] = JSON.stringify({
      version: 1,   // old version — should be rejected (current is 2)
      countries: ['US'],
      orbitClasses: [],
      objectTypes: [],
      inclinationBands: [],
      rcsSizes: [],
      userTypes: [],
      purposes: [],
      tleAgeBands: [],
      watchListOnly: false,
    })
    expect(loadFilters()).toBeNull()
  })

  it('missing optional keys default correctly', () => {
    // Store a v2 envelope missing some keys
    storage['sattrack_filters'] = JSON.stringify({
      version: 2,
      countries: ['US'],
      objectTypes: [],
      // intentionally omit rcsSizes, userTypes, purposes, watchListOnly
    })
    const loaded = loadFilters()
    expect(loaded).not.toBeNull()
    expect(loaded!.rcsSizes).toEqual(new Set())
    expect(loaded!.userTypes).toEqual(new Set())
    expect(loaded!.purposes).toEqual(new Set())
    expect(loaded!.watchListOnly).toBe(false)
  })

  it('handles corrupt JSON gracefully', () => {
    storage['sattrack_filters'] = 'not-valid-json{{'
    expect(loadFilters()).toBeNull()
  })
})
