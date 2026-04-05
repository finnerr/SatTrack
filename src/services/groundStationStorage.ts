import type { GroundStation } from '../types/satellite'

const KEY     = 'sattrack_ground_stations'
const VERSION = 1

interface StorageEnvelope {
  version: number
  stations: GroundStation[]
}

export function loadGroundStations(): GroundStation[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StorageEnvelope
    if (parsed.version < 1) return []   // too old — start fresh
    // Backwards compat: fill fields added in later phases
    return (parsed.stations ?? []).map((s) => ({
      ...s,
      maskDeg: s.maskDeg ?? 0,
    }))
  } catch {
    return []
  }
}

export function saveGroundStations(stations: GroundStation[]): void {
  try {
    const envelope: StorageEnvelope = { version: VERSION, stations }
    localStorage.setItem(KEY, JSON.stringify(envelope))
  } catch {
    // localStorage may be unavailable (private browsing, storage quota)
  }
}
