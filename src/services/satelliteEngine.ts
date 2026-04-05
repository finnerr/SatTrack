/**
 * Satellite propagation engine.
 * - Filters the full catalog, dispatches to the Web Worker every 10 seconds.
 * - Threads sim time so time-scrubbing works without breaking live SA mode.
 * - Computes look angles on the main thread after each propagation tick.
 * - Dispatches pass predictions to the worker when satellite + station are both selected.
 */
import { useSatelliteStore } from '../store/useSatelliteStore'
import { logger } from './logger'
import { computeLookAngles } from './lookAngles'
import { getSimTimeMs } from '../utils/simTime'
import type {
  SatelliteMeta,
  SatelliteFilters,
  SatellitePosition,
  PassPredictionResult,
  TleAgeBand,
} from '../types/satellite'
import { parseTleAge } from '../utils/tleUtils'
import { matchesGlob } from '../utils/searchUtils'
import * as satellite from 'satellite.js'

const SRC        = 'Engine'
const REFRESH_MS = 10_000

let worker:      Worker | null = null
let interval:    ReturnType<typeof setInterval> | null = null
let inFlight:    boolean = false
const unsubscribers: Array<() => void> = []

// ── Worker factory ────────────────────────────────────────────────────────────

function createWorker() {
  const w = new Worker(
    new URL('../workers/propagation.worker.ts', import.meta.url),
    { type: 'module' },
  )

  w.onerror = (e) => {
    logger.error(SRC, `Worker uncaught error: ${e.message}`)
    inFlight = false
  }

  w.onmessage = (
    e: MessageEvent<
      | { type: 'result';               positions: SatellitePosition[] }
      | { type: 'passes_result';        noradId: string; stationId: string; passes: unknown[]; computedAt: number }
      | { type: 'conjunctions_result';  conjunctions: unknown[] }
      | { type: 'log';                  log: { level: string; message: string } }
    >,
  ) => {
    if (e.data.type === 'log') {
      const { level, message } = e.data.log
      if (level === 'warn')  logger.warn('Worker', message)
      else if (level === 'error') logger.error('Worker', message)
      else logger.debug('Worker', message)
      return
    }

    if (e.data.type === 'result') {
      inFlight = false
      const store = useSatelliteStore.getState()

      // Apply group color overlay if any groups exist
      let positions = e.data.positions
      const { constellationGroups: groups } = store
      if (groups.length > 0) {
        // Build noradId → color map
        const colorMap = new Map<string, string>()
        for (const g of groups) {
          for (const id of g.noradIds) colorMap.set(id, g.color)
        }
        if (colorMap.size > 0) {
          positions = positions.map((p) => {
            const c = colorMap.get(p.noradId)
            return c ? { ...p, groupColor: c } : p
          })
        }
      }
      store.setPositions(positions)
      store.setLoading(false)

      // Deselect satellite if it was filtered out of the rendered set
      if (store.selected) {
        const stillVisible = e.data.positions.some((p) => p.noradId === store.selected!.noradId)
        if (!stillVisible) store.setSelected(null)
      }

      // Recompute look angles, range-rate, and conjunctions after positions update
      updateLookAngles()
      updateRangeRate()
      requestConjunctionCheck(useSatelliteStore.getState().conjunctionThresholdKm)
      return
    }

    if (e.data.type === 'passes_result') {
      const { noradId, stationId, passes, computedAt } = e.data
      const result: PassPredictionResult = {
        noradId,
        stationId,
        passes: passes as PassPredictionResult['passes'],
        computedAt,
      }
      useSatelliteStore.getState().setPassPredictions(result)
      useSatelliteStore.getState().setPassesLoading(false)
      logger.debug(SRC, `Passes received: ${passes.length} passes for station ${stationId}`)
      return
    }

    if (e.data.type === 'conjunctions_result') {
      const { conjunctions } = e.data
      useSatelliteStore.getState().setConjunctions(conjunctions as import('../types/satellite').ConjunctionResult[])
    }
  }

  return w
}

// ── Doppler / range-rate ──────────────────────────────────────────────────────

/**
 * Compute radial range-rate (km/s) from the selected station to the selected satellite.
 * Uses two SGP4 evaluations 1 second apart; positive = receding, negative = approaching.
 */
function updateRangeRate() {
  const state = useSatelliteStore.getState()
  const { selected, selectedStationIds, groundStations, simClock } = state

  if (!selected?.line1 || selectedStationIds.length === 0) {
    state.setRangeRate(null)
    return
  }

  const station = groundStations.find((s) => s.id === selectedStationIds[0])
  if (!station) { state.setRangeRate(null); return }

  try {
    const satrec = satellite.twoline2satrec(selected.line1, selected.line2)
    if (satrec.error !== 0) { state.setRangeRate(null); return }

    const t0 = getSimTimeMs(simClock)
    const t1 = t0 + 1000

    const observerGd = {
      longitude: (station.lon * Math.PI) / 180,
      latitude:  (station.lat * Math.PI) / 180,
      height:    station.elevationM / 1000,
    }

    function rangeAt(ms: number): number | null {
      const date  = new Date(ms)
      const pv    = satellite.propagate(satrec, date)
      if (!pv.position || typeof pv.position === 'boolean') return null
      const gmst  = satellite.gstime(date)
      const posEcf = satellite.eciToEcf(pv.position as satellite.EciVec3<number>, gmst)
      const la    = satellite.ecfToLookAngles(observerGd, posEcf)
      return la.rangeSat
    }

    const r0 = rangeAt(t0)
    const r1 = rangeAt(t1)
    if (r0 === null || r1 === null) { state.setRangeRate(null); return }

    state.setRangeRate(r1 - r0)   // km/s  (positive = receding)
  } catch {
    state.setRangeRate(null)
  }
}

// ── Look angles ───────────────────────────────────────────────────────────────

function updateLookAngles() {
  const state = useSatelliteStore.getState()
  const { selected, selectedStationIds, groundStations, simClock } = state

  if (!selected || selectedStationIds.length === 0) {
    state.setLookAngles(null)
    return
  }

  // Compute look angles for the primary (first) selected station
  const station = groundStations.find((s) => s.id === selectedStationIds[0])
  if (!station) { state.setLookAngles(null); return }

  const la = computeLookAngles(selected, station, getSimTimeMs(simClock))
  state.setLookAngles(la)
}

// ── Conjunction check dispatch ─────────────────────────────────────────────────

export function requestConjunctionCheck(thresholdKm: number) {
  const state = useSatelliteStore.getState()
  const { selected, positions, simClock } = state
  if (!selected?.line1 || positions.length === 0) return

  worker!.postMessage({
    type:             'check_conjunctions',
    selectedNoradId:  selected.noradId,
    selectedLine1:    selected.line1,
    selectedLine2:    selected.line2,
    positions,
    thresholdKm,
    timestampMs:      getSimTimeMs(simClock),
  })
}

// ── Pass predictions ──────────────────────────────────────────────────────────

export function requestPassPredictions() {
  const state = useSatelliteStore.getState()
  const {
    selected, selectedStationIds, groundStations, simClock,
    selectedGroupIds, constellationGroups, watchList, filters, allSatellites,
    passWindowHours,
  } = state

  if (selectedStationIds.length === 0) return

  // Derive active satellite ID set
  let satIdSet: string[]
  if (selectedGroupIds.size > 0) {
    const ids = new Set<string>()
    for (const gid of selectedGroupIds) {
      const g = constellationGroups.find((g) => g.id === gid)
      g?.noradIds.forEach((id) => ids.add(id))
    }
    satIdSet = Array.from(ids)
  } else if (filters.watchListOnly && watchList.size > 0) {
    satIdSet = Array.from(watchList)
  } else if (selected) {
    satIdSet = [selected.noradId]
  } else {
    return
  }

  // Cap at 15; resolve TLE data from allSatellites (or fall back to selected for single-sat)
  const validSats = satIdSet.slice(0, 15).reduce<SatelliteMeta[]>((acc, noradId) => {
    const meta = allSatellites.find((s) => s.noradId === noradId && s.line1 && s.line2)
    if (meta) acc.push(meta)
    else if (selected && selected.noradId === noradId && selected.line1 && selected.line2) {
      acc.push(selected as unknown as SatelliteMeta)
    }
    return acc
  }, [])

  if (validSats.length === 0) return

  const fromMs = getSimTimeMs(simClock)
  const toMs   = fromMs + passWindowHours * 3_600_000

  for (const sat of validSats) {
    for (const stationId of selectedStationIds) {
      const station = groundStations.find((s) => s.id === stationId)
      if (!station) continue

      logger.debug(SRC, `Requesting passes: ${sat.noradId} × ${station.name}`)
      state.setPassesLoading(true)

      worker!.postMessage({
        type:         'predict_passes',
        noradId:      sat.noradId,
        line1:        sat.line1,
        line2:        sat.line2,
        stationId:    station.id,
        stationLat:   station.lat,
        stationLon:   station.lon,
        stationElevM: station.elevationM,
        maskDeg:      station.maskDeg ?? 0,
        fromMs,
        toMs,
        stepSec:      30,
      })
    }
  }
}

// ── TLE age band helper ───────────────────────────────────────────────────────

function tleAgeBand(line1: string): TleAgeBand {
  const { days } = parseTleAge(line1)
  if (days < 7)  return 'FRESH'
  if (days < 14) return 'AGING'
  return 'STALE'
}

// ── Filter logic ──────────────────────────────────────────────────────────────

export function applyFilters(
  all: SatelliteMeta[],
  filters: SatelliteFilters,
  watchList?: Set<string>,
  groupMemberIds?: Set<string>,
): SatelliteMeta[] {
  const hasAny =
    filters.countries.size > 0 ||
    filters.orbitClasses.size > 0 ||
    filters.objectTypes.size > 0 ||
    filters.nameSearch.length > 0 ||
    filters.inclinationBands.size > 0 ||
    filters.rcsSizes.size > 0 ||
    filters.userTypes.size > 0 ||
    filters.purposes.size > 0 ||
    filters.tleAgeBands.size > 0 ||
    filters.watchListOnly ||
    (groupMemberIds !== undefined && groupMemberIds.size > 0)

  if (!hasAny) return []

  return all.filter((sat) => {
    if (filters.nameSearch.length > 0 &&
        !matchesGlob(sat.name, filters.nameSearch) &&
        !matchesGlob(sat.noradId, filters.nameSearch)) return false
    if (filters.countries.size > 0    && !filters.countries.has(sat.country))        return false
    if (filters.orbitClasses.size > 0 && !filters.orbitClasses.has(sat.orbitClass))  return false
    if (filters.objectTypes.size > 0  && !filters.objectTypes.has(sat.objectType))   return false

    // Phase 2 dimensions (empty set = any, non-gating)
    if (filters.inclinationBands.size > 0 && !filters.inclinationBands.has(sat.inclinationBand)) return false
    if (filters.rcsSizes.size > 0         && (sat.rcsSize === null || !filters.rcsSizes.has(sat.rcsSize))) return false
    if (filters.userTypes.size > 0        && (sat.userType === null || !filters.userTypes.has(sat.userType))) return false
    if (filters.purposes.size > 0         && (sat.purpose === null || !filters.purposes.has(sat.purpose))) return false
    if (filters.tleAgeBands.size > 0      && !filters.tleAgeBands.has(tleAgeBand(sat.line1))) return false
    if (filters.watchListOnly) {
      if (!watchList || !watchList.has(sat.noradId)) return false
    }

    // Group filter (non-empty selectedGroupIds → only members)
    if (groupMemberIds && groupMemberIds.size > 0) {
      if (!groupMemberIds.has(sat.noradId)) return false
    }

    return true
  })
}

// ── Propagation ───────────────────────────────────────────────────────────────

function propagate() {
  if (inFlight) return

  const { allSatellites, filters, pinnedIds, pinnedMode, simClock, watchList, constellationGroups, selectedGroupIds } = useSatelliteStore.getState()

  // Build a set of NORAD IDs that are members of any selected group
  let groupMemberIds: Set<string> | undefined
  if (selectedGroupIds.size > 0) {
    groupMemberIds = new Set<string>()
    for (const g of constellationGroups) {
      if (selectedGroupIds.has(g.id)) {
        for (const id of g.noradIds) groupMemberIds.add(id)
      }
    }
  }

  let filtered: SatelliteMeta[]
  if (pinnedMode && pinnedIds.size > 0) {
    filtered = allSatellites.filter((s) => pinnedIds.has(s.noradId))
  } else {
    filtered = applyFilters(allSatellites, filters, watchList, groupMemberIds)
  }

  if (filtered.length === 0) {
    useSatelliteStore.getState().setPositions([])
    return
  }

  const timestampMs = getSimTimeMs(simClock)
  logger.debug(SRC, `Propagating ${filtered.length} satellites (cap: ${filters.maxRendered}, t=${timestampMs})`)
  inFlight = true
  useSatelliteStore.getState().setLoading(true)
  worker!.postMessage({ type: 'propagate', records: filtered, cap: filters.maxRendered, timestampMs })
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function initEngine() {
  if (worker) return

  logger.info(SRC, 'Engine started — 10s refresh interval')
  worker = createWorker()

  unsubscribers.push(
    // Re-propagate on filter change
    useSatelliteStore.subscribe(
      (s) => s.filters,
      () => { inFlight = false; logger.info(SRC, 'Filters changed — re-propagating'); propagate() },
    ),
    // Re-propagate on pin mode change
    useSatelliteStore.subscribe(
      (s) => s.pinnedMode,
      () => { inFlight = false; logger.info(SRC, 'Pin mode changed — re-propagating'); propagate() },
    ),
    useSatelliteStore.subscribe(
      (s) => s.pinnedIds,
      () => { if (useSatelliteStore.getState().pinnedMode) { inFlight = false; propagate() } },
    ),
    // Recompute look angles when satellite or station selection changes
    useSatelliteStore.subscribe(
      (s) => s.selected?.noradId,
      () => {
        updateLookAngles()
        updateRangeRate()
        useSatelliteStore.getState().clearPassPredictions()
        useSatelliteStore.getState().setConjunctions([])
        requestPassPredictions()
      },
    ),
    useSatelliteStore.subscribe(
      (s) => s.selectedStationIds,
      () => {
        updateLookAngles()
        updateRangeRate()
        useSatelliteStore.getState().clearPassPredictions()
        requestPassPredictions()
      },
    ),
    // Re-propagate and recompute when sim time changes
    useSatelliteStore.subscribe(
      (s) => s.simClock.offsetMs,
      () => {
        inFlight = false
        propagate()
        updateLookAngles()
        updateRangeRate()
        requestPassPredictions()
      },
    ),
    // Re-request passes when window length changes
    useSatelliteStore.subscribe(
      (s) => s.passWindowHours,
      () => {
        useSatelliteStore.getState().clearPassPredictions()
        requestPassPredictions()
      },
    ),
    // Re-propagate on group filter change
    useSatelliteStore.subscribe(
      (s) => s.selectedGroupIds,
      () => { inFlight = false; propagate() },
    ),
    // Re-request passes when active group filter changes
    useSatelliteStore.subscribe(
      (s) => s.selectedGroupIds,
      () => { useSatelliteStore.getState().clearPassPredictions(); requestPassPredictions() },
    ),
    // Re-request passes when watch-list-only mode changes
    useSatelliteStore.subscribe(
      (s) => s.filters.watchListOnly,
      () => { useSatelliteStore.getState().clearPassPredictions(); requestPassPredictions() },
    ),
  )

  interval = setInterval(propagate, REFRESH_MS)
  propagate()
}

export function stopEngine() {
  if (interval) { clearInterval(interval); interval = null }
  if (worker)   { worker.terminate(); worker = null }
  unsubscribers.forEach((u) => u())
  unsubscribers.length = 0
  inFlight = false
  logger.info(SRC, 'Engine stopped')
}
