import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadScenarios, saveScenarios, type Scenario } from './scenarioStorage'

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

describe('scenarioStorage', () => {
  it('loadScenarios returns [] when nothing stored', () => {
    expect(loadScenarios()).toEqual([])
  })

  it('round-trips a single scenario', () => {
    const s: Scenario = {
      id:       'abc-123',
      label:    'ISS TCA over Guam',
      offsetMs: 3_600_000,
      savedAt:  1_700_000_000_000,
    }
    saveScenarios([s])
    const loaded = loadScenarios()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toEqual(s)
  })

  it('round-trips multiple scenarios preserving order', () => {
    const scenarios: Scenario[] = [
      { id: '1', label: 'First',  offsetMs: 0,         savedAt: 100 },
      { id: '2', label: 'Second', offsetMs: -3_600_000, savedAt: 200 },
      { id: '3', label: 'Third',  offsetMs: 7_200_000, savedAt: 300 },
    ]
    saveScenarios(scenarios)
    expect(loadScenarios()).toEqual(scenarios)
  })

  it('overwrites previous save', () => {
    saveScenarios([{ id: '1', label: 'Old', offsetMs: 0, savedAt: 0 }])
    saveScenarios([{ id: '2', label: 'New', offsetMs: 100, savedAt: 1 }])
    const loaded = loadScenarios()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].label).toBe('New')
  })

  it('saving empty array clears scenarios', () => {
    saveScenarios([{ id: '1', label: 'X', offsetMs: 0, savedAt: 0 }])
    saveScenarios([])
    expect(loadScenarios()).toEqual([])
  })

  it('handles corrupt JSON gracefully — returns []', () => {
    storage['sattrack_scenarios'] = '{{not-valid-json'
    expect(loadScenarios()).toEqual([])
  })

  it('preserves negative offsetMs (past sim time)', () => {
    const s: Scenario = { id: 'x', label: 'Past', offsetMs: -86_400_000, savedAt: 0 }
    saveScenarios([s])
    expect(loadScenarios()[0].offsetMs).toBe(-86_400_000)
  })
})
