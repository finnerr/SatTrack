import * as satellite from 'satellite.js'
import type {
  SatelliteMeta,
  SatellitePosition,
  OrbitClass,
  SatellitePass,
  ConjunctionResult,
} from '../types/satellite'

const DEG = 180 / Math.PI

// ── Message types ──────────────────────────────────────────────────────────────

interface PropagateRequest {
  type: 'propagate'
  records: SatelliteMeta[]
  cap: number
  timestampMs: number    // explicit sim time — replaces internal new Date()
}

interface PropagateResponse {
  type: 'result'
  positions: SatellitePosition[]
}

interface PredictPassesRequest {
  type: 'predict_passes'
  noradId: string
  line1: string
  line2: string
  stationId: string
  stationLat: number    // decimal degrees
  stationLon: number    // decimal degrees
  stationElevM: number  // metres
  maskDeg: number       // elevation mask angle (default 0)
  fromMs: number        // start of prediction window (sim time)
  toMs: number          // end of prediction window
  stepSec: number       // scan step, default 30
}

interface PredictPassesResponse {
  type: 'passes_result'
  noradId: string
  stationId: string
  passes: SatellitePass[]
  computedAt: number
}

interface CheckConjunctionsRequest {
  type: 'check_conjunctions'
  selectedNoradId: string
  selectedLine1: string
  selectedLine2: string
  positions: SatellitePosition[]
  thresholdKm: number
  timestampMs: number
}

interface CheckConjunctionsResponse {
  type: 'conjunctions_result'
  conjunctions: ConjunctionResult[]
}

interface WorkerLog {
  type: 'log'
  log: { level: 'debug' | 'warn' | 'error'; message: string }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relay(level: 'debug' | 'warn' | 'error', message: string) {
  self.postMessage({ type: 'log', log: { level, message } } as WorkerLog)
}

function classifyOrbit(altKm: number): OrbitClass {
  if (altKm < 2000)  return 'LEO'
  if (altKm < 35000) return 'MEO'
  if (altKm < 36800) return 'GEO'
  return 'HEO'
}

function sampleEvenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr
  const step = arr.length / n
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)])
}

// ── Propagation ───────────────────────────────────────────────────────────────

function propagateAll(records: SatelliteMeta[], cap: number, timestampMs: number): SatellitePosition[] {
  const source = records.length > cap ? sampleEvenly(records, cap) : records
  if (records.length > cap) {
    relay('debug', `Render budget: ${records.length} filtered → ${source.length} propagated`)
  }

  const now  = new Date(timestampMs)
  const gmst = satellite.gstime(now)
  const positions: SatellitePosition[] = []
  let failed = 0

  for (const rec of source) {
    try {
      const satrec = satellite.twoline2satrec(rec.line1, rec.line2)
      if (satrec.error !== 0) { failed++; continue }

      const pv = satellite.propagate(satrec, now)
      if (!pv.position || typeof pv.position === 'boolean') { failed++; continue }

      const geo = satellite.eciToGeodetic(pv.position as satellite.EciVec3<number>, gmst)

      const lat = satellite.degreesLat(geo.latitude)
      const lon = satellite.degreesLong(geo.longitude)
      const alt = geo.height

      const vel   = pv.velocity
      const speed = typeof vel === 'boolean'
        ? 0
        : Math.sqrt(
            (vel as satellite.EciVec3<number>).x ** 2 +
            (vel as satellite.EciVec3<number>).y ** 2 +
            (vel as satellite.EciVec3<number>).z ** 2,
          )

      positions.push({
        noradId:    rec.noradId,
        name:       rec.name,
        lat, lon, alt,
        velocity:   speed,
        orbitClass: classifyOrbit(alt),
        country:    rec.country,
        objectType: rec.objectType,
      })
    } catch {
      failed++
    }
  }

  if (failed > 0) relay('warn', `${failed} TLEs failed propagation (stale or malformed)`)
  relay('debug', `Propagated ${positions.length}/${source.length} satellites`)

  return positions
}

// ── Pass prediction ───────────────────────────────────────────────────────────

/**
 * Scans the prediction window in `stepSec` increments, detecting elevation
 * transitions above/below the horizon. Refines AOS and LOS by bisection.
 */
function predictPasses(req: PredictPassesRequest): SatellitePass[] {
  const satrec = satellite.twoline2satrec(req.line1, req.line2)
  if (satrec.error !== 0) return []

  const observerGd = {
    longitude: (req.stationLon * Math.PI) / 180,
    latitude:  (req.stationLat * Math.PI) / 180,
    height:    req.stationElevM / 1000,   // km
  }

  const stepMs = req.stepSec * 1000
  const passes: SatellitePass[] = []

  /** Compute elevation at a given ms timestamp (returns degrees). */
  function elevAt(ms: number): number | null {
    try {
      const date = new Date(ms)
      const pv   = satellite.propagate(satrec, date)
      if (!pv.position || typeof pv.position === 'boolean') return null
      const gmst   = satellite.gstime(date)
      const posEcf = satellite.eciToEcf(pv.position as satellite.EciVec3<number>, gmst)
      const la     = satellite.ecfToLookAngles(observerGd, posEcf)
      return la.elevation * DEG
    } catch {
      return null
    }
  }

  /** Compute full look angles at a given ms timestamp. */
  function lookAt(ms: number): { az: number; el: number; range: number } | null {
    try {
      const date = new Date(ms)
      const pv   = satellite.propagate(satrec, date)
      if (!pv.position || typeof pv.position === 'boolean') return null
      const gmst   = satellite.gstime(date)
      const posEcf = satellite.eciToEcf(pv.position as satellite.EciVec3<number>, gmst)
      const la     = satellite.ecfToLookAngles(observerGd, posEcf)
      return { az: la.azimuth * DEG, el: la.elevation * DEG, range: la.rangeSat }
    } catch {
      return null
    }
  }

  /** Bisect to find ms where elevation crosses the mask angle. */
  function bisectHorizon(msLow: number, msHigh: number): number {
    for (let i = 0; i < 12; i++) {
      const mid   = (msLow + msHigh) / 2
      const elMid = elevAt(mid) ?? 0
      if (elMid > mask) msHigh = mid
      else              msLow  = mid
    }
    return (msLow + msHigh) / 2
  }

  const mask   = req.maskDeg ?? 0

  let prevEl   = elevAt(req.fromMs) ?? 0
  let prevMs   = req.fromMs
  let inPass   = prevEl > mask
  let passStart = inPass ? req.fromMs : 0

  for (let ms = req.fromMs + stepMs; ms <= req.toMs; ms += stepMs) {
    const el = elevAt(ms) ?? 0

    if (!inPass && prevEl <= mask && el > mask) {
      // Crossed above mask — find AOS
      passStart = bisectHorizon(prevMs, ms)
      inPass = true
    } else if (inPass && prevEl > mask && el <= mask) {
      // Crossed below horizon — find LOS and record pass
      const losMs = bisectHorizon(prevMs, ms)

      // Find TCA by scanning within the pass window at finer resolution
      const tcaStepMs = Math.min(stepMs, 30_000)
      let   tcaMs     = passStart
      let   tcaEl     = -Infinity
      for (let t = passStart; t <= losMs; t += tcaStepMs) {
        const e = elevAt(t) ?? -Infinity
        if (e > tcaEl) { tcaEl = e; tcaMs = t }
      }

      const aosLook = lookAt(passStart)
      const losLook = lookAt(losMs)

      if (aosLook && losLook && tcaEl > mask) {
        passes.push({
          aosTime:     Math.round(passStart),
          aosAzDeg:    aosLook.az,
          tcaTime:     Math.round(tcaMs),
          tcaElDeg:    tcaEl,
          losTime:     Math.round(losMs),
          losAzDeg:    losLook.az,
          durationSec: Math.round((losMs - passStart) / 1000),
        })
      }

      inPass = false
    }

    prevEl = el
    prevMs = ms
  }

  // Flush any pass still open at the end of the window (e.g. GEO always above horizon,
  // or a LEO pass that started but hasn't set before toMs).
  if (inPass) {
    const losMs = req.toMs

    const tcaStepMs = Math.min(stepMs, 30_000)
    let   tcaMs     = passStart
    let   tcaEl     = -Infinity
    for (let t = passStart; t <= losMs; t += tcaStepMs) {
      const e = elevAt(t) ?? -Infinity
      if (e > tcaEl) { tcaEl = e; tcaMs = t }
    }

    const aosLook = lookAt(passStart)
    const losLook = lookAt(losMs)

    if (aosLook && losLook && tcaEl > mask) {
      passes.push({
        aosTime:     Math.round(passStart),
        aosAzDeg:    aosLook.az,
        tcaTime:     Math.round(tcaMs),
        tcaElDeg:    tcaEl,
        losTime:     Math.round(losMs),
        losAzDeg:    losLook.az,
        durationSec: Math.round((losMs - passStart) / 1000),
      })
    }
  }

  return passes
}

// ── Conjunction check ─────────────────────────────────────────────────────────

/**
 * Compute 3D Euclidean distance between two ECI vectors (km).
 * If either propagation fails, returns Infinity.
 */
function checkConjunctions(req: CheckConjunctionsRequest): ConjunctionResult[] {
  const satrec = satellite.twoline2satrec(req.selectedLine1, req.selectedLine2)
  if (satrec.error !== 0) return []

  const now    = new Date(req.timestampMs)
  const gmst   = satellite.gstime(now)
  const pv     = satellite.propagate(satrec, now)
  if (!pv.position || typeof pv.position === 'boolean') return []

  const selPos = pv.position as satellite.EciVec3<number>
  const selVel = typeof pv.velocity !== 'boolean' ? pv.velocity as satellite.EciVec3<number> : null

  const results: ConjunctionResult[] = []

  for (const pos of req.positions) {
    if (pos.noradId === req.selectedNoradId) continue

    // Convert geodetic position back to ECI for distance calculation
    // Use lat/lon/alt to derive approximate ECI (not perfect but good enough for proximity)
    const latRad = (pos.lat * Math.PI) / 180
    const lonRad = (pos.lon * Math.PI) / 180
    const r      = 6371 + pos.alt   // km from Earth center

    // ECI (vernal equinox aligned): apply GMST rotation
    const lstRad = lonRad + gmst
    const ex = r * Math.cos(latRad) * Math.cos(lstRad)
    const ey = r * Math.cos(latRad) * Math.sin(lstRad)
    const ez = r * Math.sin(latRad)

    const dx = ex - selPos.x
    const dy = ey - selPos.y
    const dz = ez - selPos.z
    const distKm = Math.sqrt(dx*dx + dy*dy + dz*dz)

    if (distKm > req.thresholdKm) continue

    // Approximate relative velocity from velocity vector difference
    // Use the position velocity for selected satellite if available
    let relVel = 0
    if (selVel) {
      // Approximate target velocity from orbital mechanics (circular orbit approximation)
      const mu  = 398600.4418  // km³/s²
      const vel = Math.sqrt(mu / r)   // approximate orbital speed
      // Use magnitude difference as rough estimate
      const selSpeed = Math.sqrt(selVel.x**2 + selVel.y**2 + selVel.z**2)
      relVel = Math.abs(selSpeed - vel) + 0.1   // minimum offset to avoid zero
    }

    results.push({ noradId: pos.noradId, name: pos.name, distanceKm: distKm, relativeVelocityKmS: relVel })
  }

  // Sort by distance ascending
  results.sort((a, b) => a.distanceKm - b.distanceKm)
  return results
}

// ── Message dispatch ──────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<PropagateRequest | PredictPassesRequest | CheckConjunctionsRequest>) => {
  const { type } = e.data

  if (type === 'propagate') {
    const { records, cap, timestampMs } = e.data as PropagateRequest
    relay('debug', `Propagation start — ${records.length} records, cap=${cap}, t=${timestampMs}`)
    const positions = propagateAll(records, cap, timestampMs)
    self.postMessage({ type: 'result', positions } as PropagateResponse)
    return
  }

  if (type === 'predict_passes') {
    const req = e.data as PredictPassesRequest
    relay('debug', `Pass prediction start — ${req.noradId} from station ${req.stationId}`)
    const passes = predictPasses(req)
    relay('debug', `Pass prediction done — ${passes.length} passes found`)
    self.postMessage({
      type:        'passes_result',
      noradId:     req.noradId,
      stationId:   req.stationId,
      passes,
      computedAt:  req.fromMs,
    } as PredictPassesResponse)
    return
  }

  if (type === 'check_conjunctions') {
    const req = e.data as CheckConjunctionsRequest
    const conjunctions = checkConjunctions(req)
    relay('debug', `Conjunctions: ${conjunctions.length} within ${req.thresholdKm} km of ${req.selectedNoradId}`)
    self.postMessage({ type: 'conjunctions_result', conjunctions } as CheckConjunctionsResponse)
  }
}
