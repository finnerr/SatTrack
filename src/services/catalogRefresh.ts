import type { SatelliteMeta, OrbitClass, ObjectType } from '../types/satellite'
import { parseTleInclination, classifyInclination } from '../utils/tleUtils'

export interface RefreshResult {
  satellites: SatelliteMeta[]
  fetchedAt: string   // ISO string
  count: number
}

// In dev: Vite proxy at /celestrak rewrites to https://celestrak.org (see vite.config.ts)
// In prod: set VITE_CELESTRAK_BASE to your proxy URL (e.g. https://your-proxy.example.com/celestrak)
const CELESTRAK_BASE    = import.meta.env.VITE_CELESTRAK_BASE ?? '/celestrak'
// GP JSON omits TLE_LINE1/TLE_LINE2 — use 3-line TLE format instead
const CELESTRAK_TLE_URL = `${CELESTRAK_BASE}/NORAD/elements/gp.php?GROUP=active&FORMAT=TLE`
const SATCAT_CSV_URL    = `${CELESTRAK_BASE}/pub/satcat.csv`

function classifyOrbit(meanMotion: number, ecc: number): OrbitClass {
  if (meanMotion >= 11.25) return 'LEO'
  if (meanMotion >= 2.0)   return 'MEO'
  if (meanMotion >= 0.9 && meanMotion <= 1.1 && ecc < 0.02) return 'GEO'
  return 'HEO'
}

/**
 * Fetch SATCAT CSV and return a map of noradId → country code for the given IDs.
 * Only fetches when there are unknown IDs; always returns an empty map on failure.
 */
async function resolveCountriesFromSatcat(noradIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (noradIds.length === 0) return result
  try {
    const res = await fetch(SATCAT_CSV_URL, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return result
    const text = await res.text()
    const lines = text.trim().split('\n')
    if (lines.length < 2) return result

    const headers = lines[0].split(',').map((h) => h.trim().toUpperCase())
    const noradIdx  = headers.indexOf('NORAD_CAT_ID')
    const sourceIdx = headers.indexOf('SOURCE')
    if (noradIdx === -1 || sourceIdx === -1) return result

    const wanted = new Set(noradIds)
    for (let i = 1; i < lines.length; i++) {
      const cols    = lines[i].split(',')
      const noradId = cols[noradIdx]?.trim()
      if (!noradId || !wanted.has(noradId)) continue
      const country = cols[sourceIdx]?.trim()
      if (country) result.set(noradId, country)
    }
  } catch {
    // Non-fatal — callers fall back to 'UNKNOWN'
  }
  return result
}

export async function fetchActiveCatalog(
  currentSatellites: SatelliteMeta[]
): Promise<RefreshResult> {
  // Build lookup maps from current data to preserve metadata not in TLE format
  const countryMap    = new Map<string, string>()
  const objectTypeMap = new Map<string, ObjectType>()
  const rcsMap        = new Map<string, SatelliteMeta['rcsSize']>()
  const launchYrMap   = new Map<string, number | null>()
  const userTypeMap   = new Map<string, SatelliteMeta['userType']>()
  const purposeMap    = new Map<string, SatelliteMeta['purpose']>()

  for (const sat of currentSatellites) {
    countryMap.set(sat.noradId,    sat.country)
    objectTypeMap.set(sat.noradId, sat.objectType)
    rcsMap.set(sat.noradId,        sat.rcsSize)
    launchYrMap.set(sat.noradId,   sat.launchYear)
    userTypeMap.set(sat.noradId,   sat.userType)
    purposeMap.set(sat.noradId,    sat.purpose)
  }

  const res = await fetch(CELESTRAK_TLE_URL, {
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    throw new Error(`CelesTrak returned ${res.status} ${res.statusText}`)
  }

  const text  = await res.text()
  const lines = text.split('\n').map((l) => l.trimEnd())

  const satellites: SatelliteMeta[] = []

  // Parse 3-line TLE blocks: name / line1 / line2
  let i = 0
  while (i < lines.length - 2) {
    const name  = lines[i].trim()
    const line1 = lines[i + 1]?.trim() ?? ''
    const line2 = lines[i + 2]?.trim() ?? ''

    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
      i++
      continue
    }

    i += 3  // consume the full 3-line block

    if (line1.length < 69 || line2.length < 69) continue
    if (line2[0] !== '2') continue

    const noradId    = line1.substring(2, 7).trim()
    const meanMotion = parseFloat(line2.substring(52, 63))
    const eccStr     = line2.substring(26, 33).trim()
    const ecc        = parseFloat('0.' + eccStr)

    if (!noradId || isNaN(meanMotion) || isNaN(ecc)) continue

    const inclinationDeg = parseTleInclination(line2)

    satellites.push({
      noradId,
      name:            name || noradId,
      objectType:      objectTypeMap.get(noradId) ?? 'UNKNOWN',
      country:         countryMap.get(noradId)    ?? 'UNKNOWN',
      orbitClass:      classifyOrbit(meanMotion, ecc),
      line1,
      line2,
      inclinationDeg,
      inclinationBand: classifyInclination(inclinationDeg),
      rcsSize:         rcsMap.get(noradId)        ?? null,
      launchYear:      launchYrMap.get(noradId)   ?? null,
      decayed:         false,   // active catalog only
      userType:        userTypeMap.get(noradId)   ?? null,
      purpose:         purposeMap.get(noradId)    ?? null,
    })
  }

  if (satellites.length === 0) {
    throw new Error('No valid satellites found in CelesTrak response')
  }

  // Resolve country codes for any new NORAD IDs not found in the existing catalog
  const unknownIds = satellites.filter((s) => s.country === 'UNKNOWN').map((s) => s.noradId)
  if (unknownIds.length > 0) {
    const resolved = await resolveCountriesFromSatcat(unknownIds)
    if (resolved.size > 0) {
      for (const sat of satellites) {
        if (sat.country === 'UNKNOWN' && resolved.has(sat.noradId)) {
          sat.country = resolved.get(sat.noradId)!
        }
      }
    }
  }

  return {
    satellites,
    fetchedAt: new Date().toISOString(),
    count:     satellites.length,
  }
}
