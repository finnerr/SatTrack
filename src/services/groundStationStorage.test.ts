import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadGroundStations, saveGroundStations } from './groundStationStorage'
import type { GroundStation } from '../types/satellite'

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStation(overrides: Partial<GroundStation> = {}): GroundStation {
  return {
    id:          'gs-1',
    name:        'Test Station',
    lat:         21.3069,
    lon:         -157.8583,
    elevationM:  10,
    visible:     true,
    maskDeg:     5,
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('groundStationStorage', () => {
  it('loadGroundStations returns [] when nothing stored', () => {
    expect(loadGroundStations()).toEqual([])
  })

  it('round-trips a full station', () => {
    const gs = makeStation()
    saveGroundStations([gs])
    const loaded = loadGroundStations()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toEqual(gs)
  })

  it('round-trips multiple stations preserving order', () => {
    const stations = [
      makeStation({ id: 'a', name: 'Alpha' }),
      makeStation({ id: 'b', name: 'Bravo', lat: 35.6762, lon: 139.6503 }),
    ]
    saveGroundStations(stations)
    const loaded = loadGroundStations()
    expect(loaded).toHaveLength(2)
    expect(loaded[0].name).toBe('Alpha')
    expect(loaded[1].name).toBe('Bravo')
  })

  it('fills maskDeg = 0 for legacy records missing the field', () => {
    // Simulate a v1 station saved before maskDeg was introduced
    const legacyStation = {
      id: 'gs-old', name: 'Legacy', lat: 0, lon: 0, elevationM: 0, visible: true,
      // maskDeg intentionally absent
    }
    storage['sattrack_ground_stations'] = JSON.stringify({
      version: 1,
      stations: [legacyStation],
    })
    const loaded = loadGroundStations()
    expect(loaded[0].maskDeg).toBe(0)
  })

  it('preserves explicit maskDeg values', () => {
    saveGroundStations([makeStation({ maskDeg: 10 })])
    expect(loadGroundStations()[0].maskDeg).toBe(10)
  })

  it('preserves maskDeg = 0 (not replaced by default)', () => {
    saveGroundStations([makeStation({ maskDeg: 0 })])
    expect(loadGroundStations()[0].maskDeg).toBe(0)
  })

  it('returns [] for stored version < 1', () => {
    storage['sattrack_ground_stations'] = JSON.stringify({
      version: 0,
      stations: [makeStation()],
    })
    expect(loadGroundStations()).toEqual([])
  })

  it('handles corrupt JSON gracefully — returns []', () => {
    storage['sattrack_ground_stations'] = '{{not-valid-json'
    expect(loadGroundStations()).toEqual([])
  })

  it('handles missing stations key gracefully', () => {
    storage['sattrack_ground_stations'] = JSON.stringify({ version: 1 })
    expect(loadGroundStations()).toEqual([])
  })

  it('overwrites previous save', () => {
    saveGroundStations([makeStation({ id: 'a' })])
    saveGroundStations([makeStation({ id: 'b' }), makeStation({ id: 'c' })])
    expect(loadGroundStations()).toHaveLength(2)
  })
})
