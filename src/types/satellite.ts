export type OrbitClass = 'LEO' | 'MEO' | 'GEO' | 'HEO' | 'UNKNOWN'
export type ObjectType = 'PAYLOAD' | 'ROCKET BODY' | 'DEBRIS' | 'UNKNOWN' | 'TBA'

/** Full satellite record as stored in activeTLEs.json */
export interface SatelliteMeta {
  noradId: string
  name: string
  objectType: ObjectType
  country: string      // CelesTrak SOURCE code: US, RU, CN, ESA, JPN, etc.
  orbitClass: OrbitClass  // pre-classified from mean motion
  line1: string
  line2: string

  // ── Phase 2 fields ─────────────────────────────────────────────────────────
  inclinationDeg: number        // parsed from TLE line 2 at build/load time
  inclinationBand: InclinationBand

  rcsSize: RcsSize | null       // from SATCAT CSV; null = not reported
  launchYear: number | null     // from SATCAT CSV; null = unknown
  decayed: boolean              // from SATCAT CSV decay date; always false in active catalog

  userType: SatelliteUserType | null   // from UCS DB; null = not in UCS
  purpose: SatellitePurpose | null     // from UCS DB; null = not in UCS
}

/** Faceted filter state — AND across dimensions, OR within each */
export interface SatelliteFilters {
  countries:        Set<string>           // empty = show nothing (gating dimension)
  orbitClasses:     Set<OrbitClass>       // empty = any orbit
  objectTypes:      Set<ObjectType>       // empty = any type
  maxRendered:      number

  // ── Phase 2 filter dimensions ───────────────────────────────────────────────
  inclinationBands: Set<InclinationBand>  // empty = any inclination
  rcsSizes:         Set<RcsSize>          // empty = any RCS size
  userTypes:        Set<SatelliteUserType> // empty = any user type
  purposes:         Set<SatellitePurpose> // empty = any purpose
  tleAgeBands:      Set<TleAgeBand>       // empty = any TLE age
  watchListOnly:    boolean               // false = all sats, true = watch list only
  nameSearch:       string                // wildcard name filter — '' = no filter (gating when non-empty)
}

/** Propagated real-time position — output from the SGP4 worker */
export interface SatellitePosition {
  noradId: string
  name: string
  lat: number
  lon: number
  alt: number        // km
  velocity: number   // km/s
  orbitClass: OrbitClass
  country: string
  objectType: ObjectType
  groupColor?: string   // hex color if satellite belongs to a constellation group
}

/** Selected satellite — position + TLE lines for ground track */
export interface SatelliteDetail extends SatellitePosition {
  line1: string
  line2: string
}

// Legacy — kept for the sample TLE fallback
export interface TLERecord {
  name: string
  line1: string
  line2: string
}

/** User-defined ground station, persisted to localStorage */
export interface GroundStation {
  id: string           // crypto.randomUUID()
  name: string
  lat: number          // decimal degrees
  lon: number          // decimal degrees
  elevationM: number   // metres above sea level
  visible: boolean     // toggled from the management UI
  maskDeg: number      // elevation mask angle in degrees (default 0)
}

/** Topocentric look angles from a ground station to a satellite */
export interface LookAngles {
  azimuthDeg: number
  elevationDeg: number
  rangeKm: number
  isAboveHorizon: boolean   // elevationDeg > 0
}

/** A single satellite pass over a ground station */
export interface SatellitePass {
  aosTime: number      // Unix ms — acquisition of signal
  aosAzDeg: number
  tcaTime: number      // Unix ms — time of closest approach (max elevation)
  tcaElDeg: number
  losTime: number      // Unix ms — loss of signal
  losAzDeg: number
  durationSec: number
}

/** Pass prediction results for one satellite × one ground station */
export interface PassPredictionResult {
  noradId: string
  stationId: string
  passes: SatellitePass[]
  computedAt: number   // Unix ms sim time when computed
}

/**
 * Simulation clock state.
 * Current sim time = Date.now() + offsetMs
 * offsetMs = 0 and isLive = true means real-time SA mode.
 */
export interface SimClock {
  isLive: boolean
  offsetMs: number
}

// ── Phase 2 types ─────────────────────────────────────────────────────────────

/**
 * Orbital inclination classification.
 * SUN_SYNCHRONOUS is flagged separately from POLAR — operationally distinct.
 */
export type InclinationBand =
  | 'EQUATORIAL'        // < 30°
  | 'MID_LATITUDE'      // 30–60°
  | 'HIGH_INCLINATION'  // 60–90°
  | 'POLAR'             // 90–96°
  | 'SUN_SYNCHRONOUS'   // 96–100° (SSO band)
  | 'RETROGRADE'        // > 100°

/** Radar cross-section size class from SATCAT */
export type RcsSize = 'SMALL' | 'MEDIUM' | 'LARGE'

/**
 * Operator/user category from the UCS Satellite Database.
 * MIXED = satellite listed under multiple user categories.
 */
export type SatelliteUserType = 'CIVIL' | 'COMMERCIAL' | 'GOVERNMENT' | 'MILITARY' | 'MIXED'

/** Mission purpose category from the UCS Satellite Database */
export type SatellitePurpose =
  | 'COMMUNICATIONS'
  | 'EARTH_OBSERVATION'
  | 'NAVIGATION'
  | 'SPACE_SCIENCE'
  | 'TECHNOLOGY'
  | 'RECONNAISSANCE'
  | 'WEATHER'
  | 'OTHER'

/** TLE data freshness band */
export type TleAgeBand = 'FRESH' | 'AGING' | 'STALE'  // < 7d, 7–14d, > 14d

/** Result of a conjunction / proximity check for a single nearby satellite */
export interface ConjunctionResult {
  noradId: string
  name: string
  distanceKm: number
  relativeVelocityKmS: number
}

/** Operator-defined named satellite group, persisted to IndexedDB */
export interface ConstellationGroup {
  id: string       // crypto.randomUUID()
  name: string
  color: string    // hex color for globe overlay
  noradIds: string[]
}
