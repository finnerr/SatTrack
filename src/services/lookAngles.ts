import * as satelliteJs from 'satellite.js'
import type { SatelliteDetail, GroundStation, LookAngles } from '../types/satellite'

const DEG = 180 / Math.PI

/**
 * Compute topocentric look angles from a ground station to a satellite at a
 * given sim time. Re-propagates from TLE so the result is always current.
 *
 * Returns null if propagation fails (stale / malformed TLE).
 */
export function computeLookAngles(
  sat: SatelliteDetail,
  station: GroundStation,
  timestampMs: number,
): LookAngles | null {
  try {
    const satrec = satelliteJs.twoline2satrec(sat.line1, sat.line2)
    if (satrec.error !== 0) return null

    const date  = new Date(timestampMs)
    const pv    = satelliteJs.propagate(satrec, date)
    if (!pv.position || typeof pv.position === 'boolean') return null

    const gmst   = satelliteJs.gstime(date)
    const posEcf = satelliteJs.eciToEcf(pv.position as satelliteJs.EciVec3<number>, gmst)

    const observerGd = {
      longitude: (station.lon * Math.PI) / 180,
      latitude:  (station.lat * Math.PI) / 180,
      height:    station.elevationM / 1000,   // satellite.js expects km
    }

    const la = satelliteJs.ecfToLookAngles(observerGd, posEcf)

    return {
      azimuthDeg:     la.azimuth  * DEG,
      elevationDeg:   la.elevation * DEG,
      rangeKm:        la.rangeSat,
      isAboveHorizon: la.elevation > 0,
    }
  } catch {
    return null
  }
}
