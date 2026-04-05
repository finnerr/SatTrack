/**
 * Loads satellite data from the bundled JSON files written by fetch-satellite-data.mjs.
 * Falls back to the hardcoded sample TLEs if no data has been fetched yet.
 */
import type { SatelliteMeta, OrbitClass } from '../types/satellite'
import { parseTleInclination, classifyInclination } from '../utils/tleUtils'
import { SAMPLE_TLES } from '../data/sampleTLEs'
import tleData from '../data/activeTLEs.json'

export interface LoadResult {
  satellites: SatelliteMeta[]
  fetchedAt: string | null
  source: 'bulk' | 'sample'
}

function reclassifyGeoHeo(sat: SatelliteMeta): SatelliteMeta {
  // Only re-examine satellites on the GEO/HEO boundary
  if (sat.orbitClass !== 'GEO' && sat.orbitClass !== 'HEO') return sat
  const line2 = sat.line2
  if (line2.length < 63) return sat
  const ecc        = parseFloat('0.' + line2.substring(26, 33))
  const meanMotion = parseFloat(line2.substring(52, 63))
  let orbitClass: OrbitClass
  if (meanMotion >= 0.9 && meanMotion <= 1.1 && ecc < 0.02) {
    orbitClass = 'GEO'
  } else {
    orbitClass = 'HEO'
  }
  return orbitClass === sat.orbitClass ? sat : { ...sat, orbitClass }
}

export function loadSatellites(): LoadResult {
  if (tleData.count > 0 && Array.isArray(tleData.satellites) && tleData.satellites.length > 0) {
    return {
      satellites: (tleData.satellites as SatelliteMeta[]).map(reclassifyGeoHeo),
      fetchedAt: tleData.fetchedAt,
      source: 'bulk',
    }
  }

  // Fallback: convert sample TLEs to SatelliteMeta format
  const sample: SatelliteMeta[] = SAMPLE_TLES.map((r) => {
    const inclinationDeg = parseTleInclination(r.line2)
    return {
      noradId:        r.line1.substring(2, 7).trim(),
      name:           r.name,
      objectType:     'PAYLOAD',
      country:        'US',
      orbitClass:     'LEO',
      line1:          r.line1,
      line2:          r.line2,
      inclinationDeg,
      inclinationBand: classifyInclination(inclinationDeg),
      rcsSize:        null,
      launchYear:     null,
      decayed:        false,
      userType:       null,
      purpose:        null,
    }
  })

  return {
    satellites: sample,
    fetchedAt: null,
    source: 'sample',
  }
}

/** Returns deduplicated, sorted list of country codes present in the dataset */
export function getCountries(satellites: SatelliteMeta[]): { code: string; count: number }[] {
  const counts: Record<string, number> = {}
  for (const s of satellites) {
    counts[s.country] = (counts[s.country] ?? 0) + 1
  }
  return Object.entries(counts)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
}
