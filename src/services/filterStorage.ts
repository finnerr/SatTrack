import type {
  SatelliteFilters,
  ObjectType,
  RcsSize,
  SatelliteUserType,
  SatellitePurpose,
} from '../types/satellite'

const KEY     = 'sattrack_filters'
const VERSION = 2   // bumped: removed orbit/inclination/tleAge dimensions from UI

interface StorageEnvelope {
  version:       number
  countries:     string[]
  objectTypes:   ObjectType[]
  rcsSizes:      RcsSize[]
  userTypes:     SatelliteUserType[]
  purposes:      SatellitePurpose[]
  watchListOnly: boolean
  // nameSearch intentionally not persisted (transient search state)
}

export function loadFilters(): Partial<SatelliteFilters> | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StorageEnvelope
    if (parsed.version !== VERSION) return null
    return {
      countries:    new Set(parsed.countries    ?? []),
      objectTypes:  new Set(parsed.objectTypes  ?? []),
      rcsSizes:     new Set(parsed.rcsSizes     ?? []),
      userTypes:    new Set(parsed.userTypes    ?? []),
      purposes:     new Set(parsed.purposes     ?? []),
      watchListOnly: parsed.watchListOnly        ?? false,
    }
  } catch {
    return null
  }
}

export function saveFilters(filters: SatelliteFilters): void {
  try {
    const envelope: StorageEnvelope = {
      version:      VERSION,
      countries:    Array.from(filters.countries),
      objectTypes:  Array.from(filters.objectTypes),
      rcsSizes:     Array.from(filters.rcsSizes),
      userTypes:    Array.from(filters.userTypes),
      purposes:     Array.from(filters.purposes),
      watchListOnly: filters.watchListOnly,
    }
    localStorage.setItem(KEY, JSON.stringify(envelope))
  } catch {
    // localStorage may be unavailable (private browsing, storage quota)
  }
}
