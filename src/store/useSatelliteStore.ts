import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type {
  SatelliteMeta,
  SatellitePosition,
  SatelliteDetail,
  SatelliteFilters,
  OrbitClass,
  ObjectType,
  InclinationBand,
  RcsSize,
  SatelliteUserType,
  SatellitePurpose,
  TleAgeBand,
  GroundStation,
  LookAngles,
  PassPredictionResult,
  SimClock,
  ConstellationGroup,
  ConjunctionResult,
} from '../types/satellite'
import { loadGroundStations, saveGroundStations } from '../services/groundStationStorage'
import { loadFilters, saveFilters } from '../services/filterStorage'
import { saveCatalog, saveWatchList, saveGroups } from '../services/idb'

interface SatelliteStore {
  // ── Source data ──────────────────────────────────────────────────────────────
  allSatellites: SatelliteMeta[]
  dataInfo: { fetchedAt: string | null; count: number }
  setAllSatellites: (sats: SatelliteMeta[], fetchedAt: string | null) => void

  // ── Faceted filters ──────────────────────────────────────────────────────────
  filters: SatelliteFilters
  toggleCountry: (country: string) => void
  toggleOrbitClass: (oc: OrbitClass) => void
  toggleObjectType: (ot: ObjectType) => void
  setMaxRendered: (n: number) => void
  clearFilters: () => void
  // Phase 2 filter togglers
  toggleInclinationBand: (band: InclinationBand) => void
  toggleRcsSize: (size: RcsSize) => void
  toggleUserType: (ut: SatelliteUserType) => void
  togglePurpose: (p: SatellitePurpose) => void
  toggleTleAgeBand: (band: TleAgeBand) => void
  setWatchListOnly: (v: boolean) => void
  setNameSearch: (q: string) => void

  // ── Watch list ────────────────────────────────────────────────────────────────
  watchList: Set<string>
  toggleWatchList: (noradId: string) => void

  // ── Propagated positions ─────────────────────────────────────────────────────
  positions: SatellitePosition[]
  setPositions: (positions: SatellitePosition[]) => void

  // ── Satellite selection ──────────────────────────────────────────────────────
  selected: SatelliteDetail | null
  setSelected: (sat: SatelliteDetail | null) => void

  // ── Status ───────────────────────────────────────────────────────────────────
  loading: boolean
  setLoading: (b: boolean) => void

  // ── Pinned satellites (isolation mode) ───────────────────────────────────────
  pinnedIds: Set<string>
  pinnedMode: boolean
  togglePinned: (noradId: string) => void
  activatePinnedMode: () => void
  clearPinned: () => void

  // ── Ground stations ──────────────────────────────────────────────────────────
  groundStations: GroundStation[]
  selectedStationIds: string[]   // up to 2 stations; null arg clears all, string arg toggles
  addGroundStation: (station: Omit<GroundStation, 'id'>) => void
  updateGroundStation: (id: string, patch: Partial<Omit<GroundStation, 'id'>>) => void
  deleteGroundStation: (id: string) => void
  toggleStationVisible: (id: string) => void
  setSelectedStation: (id: string | null) => void

  // ── Look angles (live, updates each propagation tick) ────────────────────────
  lookAngles: LookAngles | null
  setLookAngles: (la: LookAngles | null) => void

  // ── Pass predictions ─────────────────────────────────────────────────────────
  passPredictions: PassPredictionResult[]   // one entry per stationId, merged on update
  passesLoading: boolean
  setPassPredictions: (result: PassPredictionResult) => void
  clearPassPredictions: () => void
  setPassesLoading: (b: boolean) => void

  // ── Catalog refresh ───────────────────────────────────────────────────────────
  isRefreshing: boolean
  refreshError: string | null
  setRefreshing: (v: boolean) => void
  setRefreshError: (msg: string | null) => void

  // ── Pass window ──────────────────────────────────────────────────────────────
  passWindowHours: number
  setPassWindowHours: (h: number) => void

  // ── Simulation clock ─────────────────────────────────────────────────────────
  simClock: SimClock
  setSimLive: () => void
  setSimOffset: (offsetMs: number) => void

  // ── Location picker (ground station map-click placement) ──────────────────
  pickingLocation: boolean
  pickedLocation: { lat: number; lon: number } | null
  setPickingLocation: (b: boolean) => void
  setPickedLocation: (loc: { lat: number; lon: number } | null) => void

  // ── Cursor lat/lon (live globe hover position) ────────────────────────────
  cursorLatLon: { lat: number; lon: number } | null
  setCursorLatLon: (ll: { lat: number; lon: number } | null) => void

  // ── Doppler / range-rate ──────────────────────────────────────────────────
  rangeRateKmS: number | null
  setRangeRate: (v: number | null) => void

  // ── Conjunctions ─────────────────────────────────────────────────────────
  conjunctions: ConjunctionResult[]
  setConjunctions: (c: ConjunctionResult[]) => void
  conjunctionThresholdKm: number
  setConjunctionThreshold: (km: number) => void

  // ── Constellation groups ──────────────────────────────────────────────────
  constellationGroups: ConstellationGroup[]
  selectedGroupIds: Set<string>   // group IDs active as filter
  addGroup: (name: string, color: string) => string   // returns new id
  updateGroup: (id: string, patch: Partial<Omit<ConstellationGroup, 'id'>>) => void
  addSatellitesToGroup: (id: string, noradIds: string[]) => void
  deleteGroup: (id: string) => void
  toggleGroupFilter: (id: string) => void
  clearGroupFilters: () => void
}

function defaultFilters(): SatelliteFilters {
  return {
    countries:        new Set(),
    orbitClasses:     new Set(),
    objectTypes:      new Set(),
    maxRendered:      1000,
    // Phase 2 dimensions — empty = any (non-gating)
    inclinationBands: new Set(),
    rcsSizes:         new Set(),
    userTypes:        new Set(),
    purposes:         new Set(),
    tleAgeBands:      new Set(),
    watchListOnly:    false,
    nameSearch:       '',
  }
}

export const useSatelliteStore = create<SatelliteStore>()(
  subscribeWithSelector((set) => ({

    // ── Source data ────────────────────────────────────────────────────────────
    allSatellites: [],
    dataInfo: { fetchedAt: null, count: 0 },
    setAllSatellites: (sats, fetchedAt) => {
      saveCatalog(sats)   // persist to IndexedDB (non-blocking, non-fatal)
      if (fetchedAt) localStorage.setItem('sattrack_catalog_fetchedAt', fetchedAt)
      return set({ allSatellites: sats, dataInfo: { fetchedAt, count: sats.length } })
    },

    // ── Filters ────────────────────────────────────────────────────────────────
    filters: { ...defaultFilters(), ...(loadFilters() ?? {}) },

    toggleCountry: (country) =>
      set((s) => {
        const next = new Set(s.filters.countries)
        next.has(country) ? next.delete(country) : next.add(country)
        const newFilters = { ...s.filters, countries: next }
        saveFilters(newFilters)
        return { filters: newFilters }
      }),

    toggleOrbitClass: (oc) =>
      set((s) => {
        const next = new Set(s.filters.orbitClasses)
        next.has(oc) ? next.delete(oc) : next.add(oc)
        const newFilters = { ...s.filters, orbitClasses: next }
        saveFilters(newFilters)
        return { filters: newFilters }
      }),

    toggleObjectType: (ot) =>
      set((s) => {
        const next = new Set(s.filters.objectTypes)
        next.has(ot) ? next.delete(ot) : next.add(ot)
        const newFilters = { ...s.filters, objectTypes: next }
        saveFilters(newFilters)
        return { filters: newFilters }
      }),

    setMaxRendered: (n) =>
      set((s) => ({ filters: { ...s.filters, maxRendered: n } })),

    clearFilters: () => {
      const f = defaultFilters()
      saveFilters(f)
      return set({ filters: f })
    },

    // Phase 2 filter togglers — same pattern as toggleCountry
    toggleInclinationBand: (band) =>
      set((s) => {
        const next = new Set(s.filters.inclinationBands)
        next.has(band) ? next.delete(band) : next.add(band)
        const newFilters = { ...s.filters, inclinationBands: next }
        saveFilters(newFilters)
        return { filters: newFilters }
      }),

    toggleRcsSize: (size) =>
      set((s) => {
        const next = new Set(s.filters.rcsSizes)
        next.has(size) ? next.delete(size) : next.add(size)
        const newFilters = { ...s.filters, rcsSizes: next }
        saveFilters(newFilters)
        return { filters: newFilters }
      }),

    toggleUserType: (ut) =>
      set((s) => {
        const next = new Set(s.filters.userTypes)
        next.has(ut) ? next.delete(ut) : next.add(ut)
        const newFilters = { ...s.filters, userTypes: next }
        saveFilters(newFilters)
        return { filters: newFilters }
      }),

    togglePurpose: (p) =>
      set((s) => {
        const next = new Set(s.filters.purposes)
        next.has(p) ? next.delete(p) : next.add(p)
        const newFilters = { ...s.filters, purposes: next }
        saveFilters(newFilters)
        return { filters: newFilters }
      }),

    toggleTleAgeBand: (band) =>
      set((s) => {
        const next = new Set(s.filters.tleAgeBands)
        next.has(band) ? next.delete(band) : next.add(band)
        const newFilters = { ...s.filters, tleAgeBands: next }
        saveFilters(newFilters)
        return { filters: newFilters }
      }),

    setWatchListOnly: (v) =>
      set((s) => {
        const newFilters = { ...s.filters, watchListOnly: v }
        saveFilters(newFilters)
        return { filters: newFilters }
      }),

    setNameSearch: (q) =>
      set((s) => ({ filters: { ...s.filters, nameSearch: q } })),
      // nameSearch is not persisted (transient)

    // ── Watch list ─────────────────────────────────────────────────────────────
    watchList: new Set<string>(),

    toggleWatchList: (noradId) =>
      set((s) => {
        const next = new Set(s.watchList)
        next.has(noradId) ? next.delete(noradId) : next.add(noradId)
        saveWatchList(Array.from(next))
        return { watchList: next }
      }),

    // ── Positions ──────────────────────────────────────────────────────────────
    positions: [],
    setPositions: (positions) => set({ positions }),

    // ── Selection ──────────────────────────────────────────────────────────────
    selected: null,
    setSelected: (selected) => set({ selected }),

    // ── Status ────────────────────────────────────────────────────────────────
    loading: false,
    setLoading: (loading) => set({ loading }),

    // ── Pinned ────────────────────────────────────────────────────────────────
    pinnedIds: new Set<string>(),
    pinnedMode: false,

    togglePinned: (noradId) =>
      set((s) => {
        const next = new Set(s.pinnedIds)
        next.has(noradId) ? next.delete(noradId) : next.add(noradId)
        return { pinnedIds: next }
      }),

    activatePinnedMode: () => set({ pinnedMode: true }),
    clearPinned: () => set({ pinnedIds: new Set(), pinnedMode: false }),

    // ── Ground stations ────────────────────────────────────────────────────────
    groundStations: loadGroundStations(),
    selectedStationIds: [],

    addGroundStation: (station) =>
      set((s) => {
        const next: GroundStation = { ...station, id: crypto.randomUUID() }
        const stations = [...s.groundStations, next]
        saveGroundStations(stations)
        return { groundStations: stations }
      }),

    updateGroundStation: (id, patch) =>
      set((s) => {
        const stations = s.groundStations.map((gs) =>
          gs.id === id ? { ...gs, ...patch } : gs
        )
        saveGroundStations(stations)
        return { groundStations: stations }
      }),

    deleteGroundStation: (id) =>
      set((s) => {
        const stations = s.groundStations.filter((gs) => gs.id !== id)
        saveGroundStations(stations)
        return {
          groundStations: stations,
          selectedStationIds: s.selectedStationIds.filter((sid) => sid !== id),
        }
      }),

    toggleStationVisible: (id) =>
      set((s) => {
        const stations = s.groundStations.map((gs) =>
          gs.id === id ? { ...gs, visible: !gs.visible } : gs
        )
        saveGroundStations(stations)
        return { groundStations: stations }
      }),

    // null = clear all; string = toggle in/out
    setSelectedStation: (id) =>
      set((s) => {
        if (id === null) return { selectedStationIds: [] }
        const ids = s.selectedStationIds
        if (ids.includes(id)) return { selectedStationIds: ids.filter((i) => i !== id) }
        const next = [...ids, id]
        return { selectedStationIds: next }
      }),

    // ── Look angles ───────────────────────────────────────────────────────────
    lookAngles: null,
    setLookAngles: (lookAngles) => set({ lookAngles }),

    // ── Pass predictions ──────────────────────────────────────────────────────
    passPredictions: [],
    passesLoading: false,

    setPassPredictions: (result) =>
      set((s) => {
        // Merge by (noradId, stationId) pair — replace existing entry, append if new
        const existing = s.passPredictions.filter(
          (p) => !(p.noradId === result.noradId && p.stationId === result.stationId)
        )
        return { passPredictions: [...existing, result] }
      }),

    clearPassPredictions: () => set({ passPredictions: [] }),

    setPassesLoading: (passesLoading) => set({ passesLoading }),

    // ── Catalog refresh ───────────────────────────────────────────────────────
    isRefreshing: false,
    refreshError: null,
    setRefreshing: (isRefreshing) => set({ isRefreshing }),
    setRefreshError: (refreshError) => set({ refreshError }),

    // ── Pass window ───────────────────────────────────────────────────────────
    passWindowHours: 24,
    setPassWindowHours: (passWindowHours) => set({ passWindowHours }),

    // ── Sim clock ─────────────────────────────────────────────────────────────
    simClock: { isLive: true, offsetMs: 0 },

    setSimLive: () => set({ simClock: { isLive: true, offsetMs: 0 } }),

    setSimOffset: (offsetMs) =>
      set({ simClock: { isLive: offsetMs === 0, offsetMs } }),

    // ── Location picker ───────────────────────────────────────────────────────
    pickingLocation: false,
    pickedLocation:  null,
    setPickingLocation: (pickingLocation) => set({ pickingLocation }),
    setPickedLocation:  (pickedLocation)  => set({ pickedLocation }),

    // ── Cursor lat/lon ────────────────────────────────────────────────────────
    cursorLatLon: null,
    setCursorLatLon: (cursorLatLon) => set({ cursorLatLon }),

    // ── Doppler / range-rate ──────────────────────────────────────────────────
    rangeRateKmS: null,
    setRangeRate: (rangeRateKmS) => set({ rangeRateKmS }),

    // ── Conjunctions ──────────────────────────────────────────────────────────
    conjunctions: [],
    setConjunctions: (conjunctions) => set({ conjunctions }),
    conjunctionThresholdKm: 100,
    setConjunctionThreshold: (conjunctionThresholdKm) => set({ conjunctionThresholdKm }),

    // ── Constellation groups ──────────────────────────────────────────────────
    constellationGroups: [],
    selectedGroupIds: new Set<string>(),

    addGroup: (name, color) => {
      const id = crypto.randomUUID()
      set((s) => {
        const groups = [...s.constellationGroups, { id, name, color, noradIds: [] }]
        saveGroups(groups)
        return { constellationGroups: groups }
      })
      return id
    },

    updateGroup: (id, patch) =>
      set((s) => {
        const groups = s.constellationGroups.map((g) => g.id === id ? { ...g, ...patch } : g)
        saveGroups(groups)
        return { constellationGroups: groups }
      }),

    addSatellitesToGroup: (id, noradIds) =>
      set((s) => {
        const groups = s.constellationGroups.map((g) =>
          g.id === id
            ? { ...g, noradIds: Array.from(new Set([...g.noradIds, ...noradIds])) }
            : g
        )
        saveGroups(groups)
        return { constellationGroups: groups }
      }),

    deleteGroup: (id) =>
      set((s) => {
        const groups = s.constellationGroups.filter((g) => g.id !== id)
        const selectedGroupIds = new Set(s.selectedGroupIds)
        selectedGroupIds.delete(id)
        saveGroups(groups)
        return { constellationGroups: groups, selectedGroupIds }
      }),

    toggleGroupFilter: (id) =>
      set((s) => {
        const next = new Set(s.selectedGroupIds)
        next.has(id) ? next.delete(id) : next.add(id)
        return { selectedGroupIds: next }
      }),

    clearGroupFilters: () => set({ selectedGroupIds: new Set() }),

  }))
)
