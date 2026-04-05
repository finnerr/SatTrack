import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useSatelliteStore } from '../../store/useSatelliteStore'
import { formatContactDuration, mergedContactSec, mergedCoveragePercent } from '../../utils/passUtils'
import { getSimTimeMs } from '../../utils/simTime'
import { countryName } from '../../utils/countryNames'
import type { SatellitePass, SatelliteDetail, SatellitePosition } from '../../types/satellite'
import { fetchActiveCatalog } from '../../services/catalogRefresh'
import { parseTleAge } from '../../utils/tleUtils'
import { requestConjunctionCheck } from '../../services/satelliteEngine'
import FilterPanel from '../FilterPanel/FilterPanel'
import GroundStationManager from '../GroundStationManager/GroundStationManager'
import ConstellationManager from '../ConstellationManager/ConstellationManager'
import { clearCatalog } from '../../services/idb'

// ── Types ──────────────────────────────────────────────────────────────────

type Tab = 'sat' | 'passes' | 'filters' | 'stations' | 'groups' | 'settings'

// ── Shared utilities ────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatTimeShort(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`
}

function formatAos(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`
}

function formatLos(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatDur(sec: number): string {
  if (sec >= 60) return `${Math.floor(sec / 60)}m ${String(Math.floor(sec) % 60).padStart(2,'0')}s`
  return `${Math.floor(sec)}s`
}

function elColor(deg: number): string {
  if (deg >= 45) return 'text-emerald-400'
  if (deg >= 15) return 'text-cyan-400'
  if (deg >= 5)  return 'text-amber-400'
  return 'text-slate-400'
}

function passColor(tcaEl: number): string {
  if (tcaEl >= 45) return '#22c55e'
  if (tcaEl >= 15) return '#06b6d4'
  if (tcaEl >= 5)  return '#f59e0b'
  return '#64748b'
}

function makePct(now: number, windowMs: number) {
  return (ms: number) => Math.max(0, Math.min(100, ((ms - now) / windowMs) * 100))
}


const ORBIT_COLOR: Record<string, string> = {
  LEO: 'text-cyan-400',
  MEO: 'text-amber-400',
  GEO: 'text-emerald-400',
  HEO: 'text-orange-400',
  UNKNOWN: 'text-slate-400',
}

// ── Shared sub-components ───────────────────────────────────────────────────

function InfoRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4">
      <span className="text-slate-500 text-xs uppercase tracking-wide flex-shrink-0">{label}</span>
      <span className={`text-xs font-mono text-right ${valueClass ?? 'text-white'}`}>{value}</span>
    </div>
  )
}

function elevColor(deg: number): string {
  if (deg <= 0)  return 'text-red-400'
  if (deg < 10)  return 'text-amber-400'
  return 'text-emerald-400'
}

function DrawerHeader({ title, subtitle, onClose }: {
  title: string
  subtitle?: string
  onClose: () => void
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-space-700 flex-shrink-0">
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase">{title}</div>
        {subtitle && <div className="text-sm font-semibold text-white truncate mt-0.5">{subtitle}</div>}
      </div>
      <button
        onClick={onClose}
        className="text-slate-500 hover:text-white transition-colors text-lg leading-none flex-shrink-0"
      >
        ×
      </button>
    </div>
  )
}

// ── SAT Tab ─────────────────────────────────────────────────────────────────

// Thin guard: early return before any hooks, delegates to SatTabInner when selected.
function SatTab({ onClose }: { onClose: () => void }) {
  const selected = useSatelliteStore((s) => s.selected)
  if (!selected) return (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-xs text-slate-600">No satellite selected</p>
    </div>
  )
  return <SatTabInner selected={selected} onClose={onClose} />
}

function SatTabInner({ selected, onClose }: { selected: NonNullable<ReturnType<typeof useSatelliteStore.getState>['selected']>; onClose: () => void }) {
  const setSelected        = useSatelliteStore((s) => s.setSelected)
  const positions          = useSatelliteStore((s) => s.positions)
  const lookAngles         = useSatelliteStore((s) => s.lookAngles)
  const selectedStationIds = useSatelliteStore((s) => s.selectedStationIds)
  const groundStations     = useSatelliteStore((s) => s.groundStations)
  const passPredictions    = useSatelliteStore((s) => s.passPredictions)
  const simClock           = useSatelliteStore((s) => s.simClock)
  const rangeRateKmS          = useSatelliteStore((s) => s.rangeRateKmS)
  const conjunctions          = useSatelliteStore((s) => s.conjunctions)
  const conjunctionThreshold  = useSatelliteStore((s) => s.conjunctionThresholdKm)
  const setConjunctionThreshold = useSatelliteStore((s) => s.setConjunctionThreshold)
  const watchList             = useSatelliteStore((s) => s.watchList)
  const toggleWatchList       = useSatelliteStore((s) => s.toggleWatchList)
  const [showTle, setShowTle] = useState(false)
  const [dopplerMHz, setDopplerMHz] = useState(437.000)
  const [dopplerDraft, setDopplerDraft] = useState('437.000')

  const livePos        = positions.find((p) => p.noradId === selected.noradId) ?? selected
  const selectedStation = groundStations.find((s) => s.id === selectedStationIds[0])
  const tleAge         = selected.line1 ? parseTleAge(selected.line1) : null
  const ageColor       = !tleAge ? 'text-slate-500'
    : tleAge.days < 7  ? 'text-emerald-400'
    : tleAge.days < 14 ? 'text-amber-400'
    : 'text-red-400'
  const orbitClass = selected.orbitClass ?? 'UNKNOWN'

  const handleClose = () => {
    setSelected(null)
    onClose()
  }

  return (
    <>
      <div className="flex items-center gap-1 px-4 py-3 border-b border-space-700 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase">Satellite</div>
          <div className="text-sm font-semibold text-white truncate mt-0.5">{selected.name}</div>
        </div>
        {/* Watch list star (2c) */}
        <button
          onClick={() => toggleWatchList(selected.noradId)}
          title={watchList.has(selected.noradId) ? 'Remove from watch list' : 'Add to watch list'}
          className={`text-lg leading-none transition-colors flex-shrink-0 ${
            watchList.has(selected.noradId)
              ? 'text-amber-400 hover:text-amber-300'
              : 'text-slate-600 hover:text-amber-400'
          }`}
        >
          {watchList.has(selected.noradId) ? '★' : '☆'}
        </button>
        <button
          onClick={handleClose}
          className="text-slate-500 hover:text-white transition-colors text-lg leading-none flex-shrink-0 ml-1"
        >
          ×
        </button>
      </div>
      <div className="overflow-y-auto flex-1 p-4">

        {/* Orbit + type */}
        <div className="flex items-center gap-2 mb-4">
          <span className={`text-xs font-mono ${ORBIT_COLOR[orbitClass]}`}>{orbitClass}</span>
          {selected.objectType && selected.objectType !== 'UNKNOWN' && (
            <>
              <span className="text-slate-600 text-xs">·</span>
              <span className="text-xs text-slate-400">{selected.objectType}</span>
            </>
          )}
        </div>

        {/* Info rows */}
        <div className="flex flex-col gap-1.5">
          <InfoRow label="NORAD ID"  value={selected.noradId} />
          <InfoRow label="Country"   value={countryName(selected.country)} />
          <InfoRow label="Latitude"  value={`${livePos.lat.toFixed(4)}°`} />
          <InfoRow label="Longitude" value={`${livePos.lon.toFixed(4)}°`} />
          <InfoRow label="Altitude"  value={`${livePos.alt.toFixed(1)} km`} />
          <InfoRow label="Velocity"  value={`${livePos.velocity.toFixed(2)} km/s`} />
        </div>

        <p className="text-slate-600 text-xs mt-3">
          {selected.orbitClass === 'GEO'
            ? 'GEO satellites are stationary — no track shown'
            : 'White line = full orbital track'}
        </p>

        {/* Look angles */}
        {lookAngles && selectedStation && (
          <div className="mt-3 border-t border-space-700/50 pt-2">
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">
              Look Angles · <span className="text-emerald-400 normal-case font-normal">{selectedStation.name}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-baseline gap-4">
                <span className="text-slate-500 text-xs uppercase tracking-wide flex-shrink-0">Azimuth</span>
                <span className="text-xs font-mono text-white">{lookAngles.azimuthDeg.toFixed(1)}°</span>
              </div>
              <div className="flex justify-between items-baseline gap-4">
                <span className="text-slate-500 text-xs uppercase tracking-wide flex-shrink-0">Elevation</span>
                <span className={`text-xs font-mono ${elevColor(lookAngles.elevationDeg)}`}>
                  {lookAngles.elevationDeg.toFixed(1)}°
                </span>
              </div>
              <div className="flex justify-between items-baseline gap-4">
                <span className="text-slate-500 text-xs uppercase tracking-wide flex-shrink-0">Range</span>
                <span className="text-xs font-mono text-white">{lookAngles.rangeKm.toFixed(0)} km</span>
              </div>
              <div className={`text-[10px] font-mono text-center mt-0.5 py-0.5 rounded ${
                lookAngles.isAboveHorizon
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : 'text-red-400 bg-red-500/10'
              }`}>
                {lookAngles.isAboveHorizon ? '▲ ABOVE HORIZON' : '▼ BELOW HORIZON'}
              </div>
            </div>
          </div>
        )}
        {selectedStation && !lookAngles && (
          <div className="mt-3 border-t border-space-700/50 pt-2 text-xs text-slate-600 text-center">
            Computing look angles…
          </div>
        )}

        {/* Doppler shift (3g) */}
        {lookAngles && selectedStation && rangeRateKmS !== null && (() => {
          const C = 299792.458   // km/s
          const f0Hz = dopplerMHz * 1e6
          // Δf = -f0 * (rangeRate / c) — negative rangeRate = approaching → positive shift
          const deltaHz = -f0Hz * (rangeRateKmS / C)
          const sign = deltaHz >= 0 ? '+' : ''
          return (
            <div className="mt-3 border-t border-space-700/50 pt-2">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">Doppler</div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-xs text-slate-500 flex-1">Freq (MHz)</label>
                <input
                  type="number"
                  step="0.001"
                  min="1"
                  max="10000"
                  value={dopplerDraft}
                  onChange={(e) => setDopplerDraft(e.target.value)}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value)
                    if (!isNaN(v) && v >= 1 && v <= 10000) {
                      setDopplerMHz(v)
                      setDopplerDraft(String(v))
                    } else {
                      setDopplerDraft(String(dopplerMHz))
                    }
                  }}
                  className="w-24 bg-space-800 border border-space-700 rounded px-2 py-0.5 text-xs text-white text-right focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <div className="flex justify-between items-baseline gap-4">
                <span className="text-slate-500 text-xs uppercase tracking-wide">Shift</span>
                <span className={`text-xs font-mono ${deltaHz >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {sign}{Math.abs(deltaHz) >= 1000
                    ? `${(deltaHz / 1000).toFixed(1)} kHz`
                    : `${deltaHz.toFixed(0)} Hz`}
                </span>
              </div>
              <div className="flex justify-between items-baseline gap-4 mt-1">
                <span className="text-slate-500 text-xs uppercase tracking-wide">Range Rate</span>
                <span className="text-xs font-mono text-white">
                  {rangeRateKmS >= 0 ? '+' : ''}{rangeRateKmS.toFixed(3)} km/s
                </span>
              </div>
            </div>
          )
        })()}

        {/* Proximity warnings (5a) */}
        <div className="mt-3 border-t border-space-700/50 pt-2">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Proximity</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="range"
                  min="10"
                  max="500"
                  step="10"
                  value={conjunctionThreshold}
                  onChange={(e) => {
                    const km = parseInt(e.target.value)
                    setConjunctionThreshold(km)
                    requestConjunctionCheck(km)
                  }}
                  className="w-20 accent-cyan-400"
                  title="Threshold distance"
                />
                <span className="text-[10px] text-slate-500 font-mono w-10 text-right">{conjunctionThreshold} km</span>
              </div>
            </div>
            {conjunctions.length === 0 ? (
              <div className="text-xs text-slate-600">No objects within {conjunctionThreshold} km</div>
            ) : (
              <div className="flex flex-col gap-1">
                {conjunctions.slice(0, 10).map((c) => (
                  <div key={c.noradId} className="flex items-center gap-2 text-xs">
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        c.distanceKm < 10 ? 'bg-red-400' : c.distanceKm < 50 ? 'bg-amber-400' : 'bg-slate-500'
                      }`}
                    />
                    <span className={`flex-1 font-mono truncate ${
                      c.distanceKm < 10 ? 'text-red-300' : c.distanceKm < 50 ? 'text-amber-300' : 'text-slate-400'
                    }`}>
                      {c.name}
                    </span>
                    <span className={`font-mono text-[10px] ${
                      c.distanceKm < 10 ? 'text-red-400' : c.distanceKm < 50 ? 'text-amber-400' : 'text-slate-500'
                    }`}>
                      {c.distanceKm.toFixed(0)} km
                    </span>
                  </div>
                ))}
                {conjunctions.length > 10 && (
                  <div className="text-[10px] text-slate-600">+{conjunctions.length - 10} more</div>
                )}
              </div>
            )}
            <div className="mt-2 text-[9px] text-slate-600 italic">
              Based on TLE propagation — not authoritative conjunction data.
            </div>
          </div>

        {/* Next-pass countdown (3f) */}
        {selectedStationIds.length > 0 && (() => {
          const now = getSimTimeMs(simClock)
          const stationId = selectedStationIds[0]
          const pred = passPredictions.find(
            (p) => p.noradId === selected.noradId && p.stationId === stationId
          )
          const nextPass = pred?.passes.find((p) => p.losTime > now)
          const station  = groundStations.find((s) => s.id === stationId)
          if (!nextPass || !station) return null
          const isActive = nextPass.aosTime <= now
          return (
            <div className="mt-3 border-t border-space-700/50 pt-2">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">
                Next Pass · <span className="text-emerald-400 normal-case font-normal">{station.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-mono ${isActive ? 'text-emerald-400' : 'text-cyan-400'}`}>
                  {isActive ? '▲ IN PASS' : `in ${formatCountdown(nextPass.aosTime - now)}`}
                </span>
                <span className="text-slate-600 text-xs">·</span>
                <span className={`text-xs ${elColor(nextPass.tcaElDeg)}`}>max {nextPass.tcaElDeg.toFixed(1)}°</span>
              </div>
            </div>
          )
        })()}

        {/* TLE */}
        {selected.line1 && (
          <div className="mt-3 border-t border-space-700/50 pt-2">
            <button
              onClick={() => setShowTle((v) => !v)}
              className="w-full flex items-center justify-between text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              <span>TLE DATA</span>
              <span className="flex items-center gap-2">
                {tleAge && <span className={ageColor}>{tleAge.label}</span>}
                <span>{showTle ? '▾' : '▴'}</span>
              </span>
            </button>
            {showTle && (
              <pre className="mt-1.5 text-[9px] font-mono text-slate-500 leading-4 break-all whitespace-pre-wrap">
                {selected.line1}{'\n'}{selected.line2}
              </pre>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ── PASSES Tab ───────────────────────────────────────────────────────────────

const PASSES_GRID_SINGLE = '4.5rem 6rem 2.5rem 2rem 2.5rem 1fr'          // GS|AOS|El°|AOSAz|Dur|bar
const PASSES_GRID_MULTI  = '2.5rem 3.5rem 5.5rem 2.5rem 2rem 2.5rem 1fr' // Sat|GS|AOS|El°|AOSAz|Dur|bar
const MAX_PASS_DURATION_SEC = 900  // 15 min — bar-width reference (typical LEO max pass)

interface FlatPassEntry {
  pass: SatellitePass
  noradId: string
  satName: string
  stationId: string
  stationName: string
}

function PassRow({ entry, isNext, isPast, now, showSat, grid }: {
  entry: FlatPassEntry
  isNext: boolean
  isPast: boolean
  now: number
  showSat: boolean
  grid: string
}) {
  const { pass, satName, stationName } = entry
  const isCurrent = pass.aosTime <= now && now <= pass.losTime
  const barWidth  = Math.min((pass.durationSec / MAX_PASS_DURATION_SEC) * 100, 100)
  return (
    <div
      className={`
        grid gap-x-2 px-3 py-2 rounded text-xs font-mono border
        ${isCurrent  ? 'bg-cyan-500/10 border-cyan-500/30' :
          isNext     ? 'bg-space-800/60 border-space-700/80' :
          isPast     ? 'opacity-40 border-transparent' :
                       'border-transparent hover:bg-space-800/40'}
      `}
      style={{ gridTemplateColumns: grid }}
    >
      {showSat && <span className="text-slate-400 truncate">{satName}</span>}
      <span className="text-slate-500 truncate">{stationName}</span>
      <span className="text-slate-300 text-sm">{formatAos(pass.aosTime)}</span>
      <span className={elColor(pass.tcaElDeg)}>
        {pass.tcaElDeg.toFixed(1)}°{pass.tcaElDeg >= 45 && <span className="ml-0.5 text-amber-400">★</span>}
      </span>
      <span className="text-slate-500 font-mono text-right">{pass.aosAzDeg.toFixed(0)}°</span>
      <span className="text-slate-400 text-right">{formatDur(pass.durationSec)}</span>
      <div className="relative h-3 self-center bg-space-800 rounded overflow-hidden">
        <div
          className="absolute top-0 bottom-0 rounded-sm"
          style={{ left: 0, width: `${barWidth}%`, background: passColor(pass.tcaElDeg) }}
        />
      </div>
    </div>
  )
}

const TIME_GROUPS = [
  { key: 'next6h',  label: 'Next 6h',  start: 0,  end: 6  },
  { key: '6to12h',  label: '6–12h',    start: 6,  end: 12 },
  { key: '12to24h', label: '12–24h',   start: 12, end: 24 },
  { key: '24to48h', label: '24–48h',   start: 24, end: 48 },
  { key: '48to72h', label: '48–72h',   start: 48, end: 72 },
] as const

const EL_TIERS = [
  { key: 'excellent', label: '★ Excellent  ≥45°', min: 45 },
  { key: 'good',      label: 'Good  ≥15°',        min: 15 },
  { key: 'marginal',  label: 'Marginal  ≥5°',     min: 5  },
  { key: 'poor',      label: 'Poor  <5°',          min: 0  },
] as const

// ── PassScheduleModal ────────────────────────────────────────────────────────

interface PassScheduleModalProps {
  cappedSatIds: string[]
  allFlatPasses: FlatPassEntry[]
  allSatellites: ReturnType<typeof useSatelliteStore.getState>['allSatellites']
  positions: SatellitePosition[]
  now: number
  passWindowHours: number
  setPassWindowHours: (h: 24 | 48 | 72) => void
  setSimOffset: (ms: number) => void
  setSelected: (sat: SatelliteDetail | null) => void
  selectedStationIds: string[]
  groundStations: ReturnType<typeof useSatelliteStore.getState>['groundStations']
  onClose: () => void
}

function PassScheduleModal({
  cappedSatIds,
  allFlatPasses,
  allSatellites,
  positions,
  now,
  passWindowHours,
  setPassWindowHours,
  setSimOffset,
  setSelected,
  selectedStationIds,
  groundStations,
  onClose,
}: PassScheduleModalProps) {
  const [modalGsFilter, setModalGsFilter] = useState<string | 'all'>('all')
  const windowMs = passWindowHours * 3_600_000
  const pct = makePct(now, windowMs)

  const panelRef  = useRef<HTMLDivElement>(null)
  const prevFocus = useRef<Element | null>(null)
  const [tooltip, setTooltip] = useState<{ entry: FlatPassEntry; x: number; y: number } | null>(null)

  // A2: Save triggering element, focus first focusable on mount, restore on unmount
  useEffect(() => {
    prevFocus.current = document.activeElement
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    focusable?.[0]?.focus()
    return () => { (prevFocus.current as HTMLElement | null)?.focus?.() }
  }, [])

  // A2: Escape closes + Tab traps focus within panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last  = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleBarClick = (entry: FlatPassEntry) => {
    // offset is relative to wall clock, not sim time — do not substitute 'now' here
    setSimOffset(entry.pass.aosTime - Date.now())
    const meta = allSatellites.find((s) => s.noradId === entry.noradId)
    const pos  = positions.find((p) => p.noradId === entry.noradId)
    if (meta) {
      setSelected({
        noradId: meta.noradId, name: meta.name,
        lat: pos?.lat ?? 0, lon: pos?.lon ?? 0,
        alt: pos?.alt ?? 400, velocity: pos?.velocity ?? 7.5,
        orbitClass: meta.orbitClass, country: meta.country,
        objectType: meta.objectType,
        line1: meta.line1, line2: meta.line2,
      })
    }
    onClose()
  }

  // Apply GS filter
  const filteredPasses = modalGsFilter === 'all'
    ? allFlatPasses
    : allFlatPasses.filter((e) => e.stationId === modalGsFilter)

  // Build sat rows sorted by first pass AOS; hide zero-pass rows when filtered
  const satRows = cappedSatIds
    .map((noradId) => ({
      noradId,
      name: allSatellites.find((s) => s.noradId === noradId)?.name ?? noradId,
      passes: filteredPasses.filter((e) => e.noradId === noradId),
    }))
    .sort((a, b) => {
      const aFirst = a.passes[0]?.pass.aosTime ?? Infinity
      const bFirst = b.passes[0]?.pass.aosTime ?? Infinity
      return aFirst - bFirst
    })

  // Tick marks every 4h
  const tickCount = Math.floor(passWindowHours / 4)
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => i * 4)

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* A1: dialog role, aria-modal, aria-labelledby */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pass-schedule-title"
        className="w-full max-w-5xl bg-space-900 border border-space-700 rounded-lg flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-col flex-shrink-0 border-b border-space-700">
          <div className="flex items-center gap-3 px-4 py-3">
            {/* A1: id for aria-labelledby */}
            <span id="pass-schedule-title" className="text-xs font-semibold tracking-widest text-slate-300 uppercase flex-1">
              Pass Schedule
            </span>
            {/* A5: toggle group with role + aria-pressed */}
            <div role="group" aria-label="Pass window" className="flex gap-1">
              {([24, 48, 72] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setPassWindowHours(h)}
                  aria-pressed={passWindowHours === h}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                    passWindowHours === h
                      ? 'border-cyan-500/50 text-cyan-400 bg-cyan-500/10'
                      : 'border-space-700 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
            {/* A4: labeled close button */}
            <button
              onClick={onClose}
              aria-label="Close pass schedule"
              className="text-slate-500 hover:text-white transition-colors text-lg leading-none ml-2"
            >
              ×
            </button>
          </div>
          {/* GS filter chips — only shown when >1 station selected */}
          {selectedStationIds.length > 1 && (
            <div role="group" aria-label="Ground station filter" className="flex gap-1 px-4 pb-2 flex-wrap">
              <button
                onClick={() => setModalGsFilter('all')}
                aria-pressed={modalGsFilter === 'all'}
                className={`text-xs px-2.5 py-0.5 rounded border transition-colors ${
                  modalGsFilter === 'all'
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                    : 'border-space-700 text-slate-500 hover:text-slate-300'
                }`}
              >All</button>
              {selectedStationIds.map((id) => {
                const gs = groundStations.find((s) => s.id === id)
                if (!gs) return null
                return (
                  <button
                    key={id}
                    onClick={() => setModalGsFilter(id)}
                    aria-pressed={modalGsFilter === id}
                    className={`text-xs px-2.5 py-0.5 rounded border transition-colors ${
                      modalGsFilter === id
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                        : 'border-space-700 text-slate-500 hover:text-slate-300'
                    }`}
                  >{gs.name}</button>
                )
              })}
            </div>
          )}
        </div>

        {/* Time axis header */}
        <div className="flex flex-shrink-0 border-b border-space-700/50 bg-space-900/80" aria-hidden="true">
          <div className="w-40 flex-shrink-0 px-3 py-1" />
          <div className="flex-1 relative h-6">
            <div className="absolute inset-y-0 w-0.5 bg-cyan-400/50 pointer-events-none" style={{ left: '0%' }} aria-hidden="true" />
            <span className="absolute top-1 text-[9px] text-cyan-400/70 font-mono pointer-events-none" style={{ left: '3px' }} aria-hidden="true">NOW</span>
            {ticks.map((h) => (
              <div
                key={h}
                className="absolute top-0 bottom-0 flex flex-col items-center"
                style={{ left: `${(h / passWindowHours) * 100}%` }}
              >
                <div className="w-px h-2 bg-space-600 mt-1" />
                <span className="text-[11px] text-slate-500 font-mono mt-0.5">
                  {formatTimeShort(now + h * 3_600_000)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Satellite rows */}
        <div className="overflow-y-auto flex-1" onMouseLeave={() => setTooltip(null)}>
          {satRows.map((row) => (
            <div key={row.noradId} className="flex items-center border-b border-space-700/30 hover:bg-space-800/20">
              {/* Sat name */}
              <div className="w-40 flex-shrink-0 px-3 py-1.5">
                <span className="text-[11px] text-slate-300 font-mono truncate block" title={row.name}>
                  {row.name}
                </span>
              </div>
              {/* Timeline */}
              <div className="flex-1 relative h-8 mx-1">
                {/* Grid lines at ticks */}
                {ticks.map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 bottom-0 w-px bg-space-700/40"
                    style={{ left: `${(h / passWindowHours) * 100}%` }}
                    aria-hidden="true"
                  />
                ))}
                {/* NOW line */}
                <div className="absolute top-0 bottom-0 w-0.5 bg-cyan-400/50 z-20 pointer-events-none" style={{ left: '0%' }} aria-hidden="true" />
                {/* A3: Pass bars as buttons with aria-label + keyboard access */}
                {row.passes.map((entry) => {
                  const left    = pct(entry.pass.aosTime)
                  const right   = pct(entry.pass.losTime)
                  const width   = right - left
                  if (width <= 0) return null
                  const isPast  = entry.pass.losTime < now  // B2: elapsed pass dimming
                  const barLabel = `${entry.satName} pass over ${entry.stationName} — AOS ${formatAos(entry.pass.aosTime)}, max elevation ${entry.pass.tcaElDeg.toFixed(1)}°${isPast ? ' (elapsed)' : ', click to jump'}`
                  return (
                    <button
                      type="button"
                      key={`${entry.noradId}-${entry.stationId}-${entry.pass.aosTime}`}
                      aria-label={barLabel}
                      className={`absolute top-1.5 bottom-1.5 rounded-sm transition-opacity flex items-center overflow-hidden focus:outline-none focus:ring-1 focus:ring-white/50 ${isPast ? 'opacity-40 cursor-default' : 'hover:opacity-80 cursor-pointer'}`}
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(width, 0.5)}%`,
                        background: passColor(entry.pass.tcaElDeg),
                        minWidth: '3px',
                      }}
                      onMouseEnter={(e) => {
                        setTooltip({ entry, x: e.clientX, y: e.clientY })
                      }}
                      onMouseLeave={() => setTooltip(null)}
                      onFocus={(e) => {
                        setTooltip({ entry, x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().top })
                      }}
                      onBlur={() => setTooltip(null)}
                      onClick={isPast ? undefined : () => handleBarClick(entry)}
                    >
                      {width > 3 && (
                        <span className="text-[10px] text-black/70 font-semibold px-0.5 truncate leading-none" aria-hidden="true">
                          {entry.stationName}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer legend */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-space-700/50 flex-shrink-0 text-xs text-slate-500">
          {[
            { color: '#22c55e', label: '≥45° ★' },
            { color: '#06b6d4', label: '≥15°' },
            { color: '#f59e0b', label: '≥5°' },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1" aria-hidden="true">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: color }} />
              {label}
            </span>
          ))}
          <span className="flex-1" />
          <span className="text-slate-600">Click a pass to jump</span>
        </div>
      </div>

      {/* B4: Tooltip clamped to viewport */}
      {tooltip && (
        <div
          className="fixed z-[60] pointer-events-none bg-space-900 border border-space-700 rounded px-3 py-2 text-xs shadow-xl"
          style={{
            left: Math.min(tooltip.x + 12, window.innerWidth - 200),
            top:  Math.max(8, tooltip.y - 100),
          }}
          role="tooltip"
        >
          <div className="font-semibold text-cyan-400 mb-0.5">{tooltip.entry.satName}</div>
          <div className="font-semibold text-white mb-1">{tooltip.entry.stationName}</div>
          <div className="text-slate-400">AOS: <span className="text-white font-mono">{formatAos(tooltip.entry.pass.aosTime)}</span></div>
          <div className="text-slate-400">TCA: <span className="text-white font-mono">{formatTimeShort(tooltip.entry.pass.tcaTime)}</span></div>
          <div className="text-slate-400">Az: <span className="text-white font-mono">{tooltip.entry.pass.aosAzDeg.toFixed(0)}°→{tooltip.entry.pass.losAzDeg.toFixed(0)}°</span></div>
          <div className="text-slate-400">Max El: <span className="font-mono" style={{ color: passColor(tooltip.entry.pass.tcaElDeg) }}>{tooltip.entry.pass.tcaElDeg.toFixed(1)}°</span></div>
          <div className="text-slate-400">LOS: <span className="text-white font-mono">{formatLos(tooltip.entry.pass.losTime)}</span></div>
          <div className="text-slate-400">Dur: <span className="text-white font-mono">{formatDur(tooltip.entry.pass.durationSec)}</span></div>
        </div>
      )}
    </div>,
    document.body
  )
}

function PassesTab({ onClose, onNavigate }: { onClose: () => void; onNavigate: (tab: Tab) => void }) {
  const selected            = useSatelliteStore((s) => s.selected)
  const selectedStationIds  = useSatelliteStore((s) => s.selectedStationIds)
  const groundStations      = useSatelliteStore((s) => s.groundStations)
  const passPredictions     = useSatelliteStore((s) => s.passPredictions)
  const passesLoading       = useSatelliteStore((s) => s.passesLoading)
  const simClock            = useSatelliteStore((s) => s.simClock)
  const passWindowHours     = useSatelliteStore((s) => s.passWindowHours)
  const setPassWindowHours  = useSatelliteStore((s) => s.setPassWindowHours)
  const setSimOffset        = useSatelliteStore((s) => s.setSimOffset)
  const positions           = useSatelliteStore((s) => s.positions)
  const setSelected         = useSatelliteStore((s) => s.setSelected)
  const selectedGroupIds    = useSatelliteStore((s) => s.selectedGroupIds)
  const constellationGroups = useSatelliteStore((s) => s.constellationGroups)
  const watchList           = useSatelliteStore((s) => s.watchList)
  const filters             = useSatelliteStore((s) => s.filters)
  const allSatellites       = useSatelliteStore((s) => s.allSatellites)

  const [activeGsFilter, setActiveGsFilter] = useState<string | 'all'>('all')
  const [minElDeg, setMinElDeg] = useState(0)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showSchedule, setShowSchedule] = useState(false)
  const [sortByEl, setSortByEl] = useState(false)
  const handleCloseSchedule = useCallback(() => setShowSchedule(false), [])
  const [tooltip, setTooltip] = useState<{
    pass: SatellitePass; satName: string; stationName: string; x: number; y: number
  } | null>(null)

  // Keep activeGsFilter valid when selectedStationIds changes
  useEffect(() => {
    if (activeGsFilter !== 'all' && !selectedStationIds.includes(activeGsFilter)) {
      setActiveGsFilter('all')
    }
  }, [selectedStationIds, activeGsFilter])

  // Arrow keys step sim time by 1 minute (only when no input focused)
  useEffect(() => {
    const STEP_MS = 60_000
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      // Read fresh simClock from store — the closure-captured value would be stale
      const { simClock: clock } = useSatelliteStore.getState()
      const currentOffset = clock.isLive ? 0 : clock.offsetMs
      const delta = e.key === 'ArrowRight' ? STEP_MS : -STEP_MS
      setSimOffset(currentOffset + delta)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setSimOffset])

  // Derive active satellite set
  const { activeSatIds, cappedSatIds, isCapped } = useMemo(() => {
    let ids: string[]
    if (selectedGroupIds.size > 0) {
      const set = new Set<string>()
      for (const gid of selectedGroupIds) {
        const g = constellationGroups.find((g) => g.id === gid)
        g?.noradIds.forEach((id) => set.add(id))
      }
      ids = Array.from(set)
    } else if (filters.watchListOnly && watchList.size > 0) {
      ids = Array.from(watchList)
    } else if (selected) {
      ids = [selected.noradId]
    } else {
      ids = []
    }
    const capped = ids.length > 15
    return { activeSatIds: ids, cappedSatIds: ids.slice(0, 15), isCapped: capped }
  }, [selectedGroupIds, constellationGroups, filters.watchListOnly, watchList, selected])  // eslint-disable-line react-hooks/exhaustive-deps

  const isMultiSat  = activeSatIds.length > 1
  const passesGrid  = isMultiSat ? PASSES_GRID_MULTI : PASSES_GRID_SINGLE

  // Active set label
  const activeSatLabel = useMemo(() => {
    if (selectedGroupIds.size > 0) {
      const groupNames = Array.from(selectedGroupIds)
        .map((gid) => constellationGroups.find((g) => g.id === gid)?.name)
        .filter((n): n is string => Boolean(n))
      const total = activeSatIds.length
      const base  = groupNames.length === 1
        ? `Group: ${groupNames[0]} (${total} sat${total !== 1 ? 's' : ''})`
        : `${groupNames.length} Groups (${total} sat${total !== 1 ? 's' : ''})`
      return isCapped ? `${base} — first 15` : base
    }
    if (filters.watchListOnly && watchList.size > 0) {
      const n    = activeSatIds.length
      const base = `Watch List (${n} sat${n !== 1 ? 's' : ''})`
      return isCapped ? `${base} — first 15` : base
    }
    return selected?.name ?? ''
  }, [selectedGroupIds, constellationGroups, filters.watchListOnly, watchList, activeSatIds, isCapped, selected])  // eslint-disable-line react-hooks/exhaustive-deps

  // Drive 'now' from state so countdown timers update every second in live mode.
  // Also re-syncs immediately whenever simClock changes (user scrub / sim jump).
  const [now, setNow] = useState(() => getSimTimeMs(simClock))
  useEffect(() => {
    setNow(getSimTimeMs(simClock))
    if (!simClock.isLive) return
    const id = setInterval(
      () => setNow(getSimTimeMs(useSatelliteStore.getState().simClock)),
      1000,
    )
    return () => clearInterval(id)
  }, [simClock])

  const windowMs = passWindowHours * 3_600_000
  const pct      = makePct(now, windowMs)

  // Flatten predictions → filter to active sat set → resolve names → sort by AOS
  const allFlatPasses = useMemo(() => {
    const result: FlatPassEntry[] = []
    for (const pred of passPredictions) {
      if (!cappedSatIds.includes(pred.noradId)) continue
      const gs = groundStations.find((s) => s.id === pred.stationId)
      if (!gs) continue
      const satMeta = allSatellites.find((s) => s.noradId === pred.noradId)
      const satName = satMeta?.name ?? (selected?.noradId === pred.noradId ? selected.name : pred.noradId)
      for (const pass of pred.passes) {
        result.push({ pass, noradId: pred.noradId, satName, stationId: pred.stationId, stationName: gs.name })
      }
    }
    return result.sort((a, b) => a.pass.aosTime - b.pass.aosTime)
  }, [passPredictions, cappedSatIds, groundStations, allSatellites, selected])  // eslint-disable-line react-hooks/exhaustive-deps

  // Apply GS filter
  const gsFilteredPasses = useMemo(() =>
    activeGsFilter === 'all'
      ? allFlatPasses
      : allFlatPasses.filter((e) => e.stationId === activeGsFilter),
    [allFlatPasses, activeGsFilter]
  )

  // Coverage metrics — use merged intervals to avoid double-counting overlapping stations.
  const totalContactSec = mergedContactSec(gsFilteredPasses.map((e) => e.pass))
  const coveragePct     = mergedCoveragePercent(gsFilteredPasses.map((e) => e.pass), passWindowHours)

  // Apply minElDeg filter
  const passes = minElDeg > 0
    ? gsFilteredPasses.filter((e) => e.pass.tcaElDeg >= minElDeg)
    : gsFilteredPasses

  // Time-grouped passes
  const groupedPasses = TIME_GROUPS
    .filter((g) => g.start < passWindowHours)
    .map((g) => {
      const from    = now + g.start * 3_600_000
      const to      = now + Math.min(g.end, passWindowHours) * 3_600_000
      const entries = passes.filter((e) => e.pass.aosTime >= from && e.pass.aosTime < to)
      return { key: g.key, label: g.label, from, to, entries }
    })
    .filter((g) => g.entries.length > 0)

  const elGroupedPasses = EL_TIERS.map(({ key, label, min }, i) => {
    const maxEl = EL_TIERS[i - 1]?.min ?? Infinity
    const entries = passes
      .filter(e => e.pass.losTime > now && e.pass.tcaElDeg >= min && e.pass.tcaElDeg < maxEl)
      .sort((a, b) => b.pass.tcaElDeg - a.pass.tcaElDeg)
    return { key, label, entries }
  }).filter(g => g.entries.length > 0)

  const nextEntry = passes.find((e) => e.pass.losTime > now)
  const nextPassIsActive = !!nextEntry && nextEntry.pass.aosTime <= now

  const bestEntry = passes
    .filter(e => e.pass.losTime > now)
    .sort((a, b) => b.pass.tcaElDeg - a.pass.tcaElDeg)[0] ?? null

  const showBestCard = !sortByEl && !!bestEntry && !!nextEntry &&
    bestEntry.pass.aosTime !== nextEntry.pass.aosTime

  const toggleCollapsed = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const timelineStations = groundStations.filter(
    (gs) => gs.visible && selectedStationIds.includes(gs.id)
  )

  if (activeSatIds.length === 0) return (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-xs text-slate-600">No satellite selected</p>
    </div>
  )

  return (
    <>
      {showSchedule && (
        <PassScheduleModal
          cappedSatIds={cappedSatIds}
          allFlatPasses={allFlatPasses}
          allSatellites={allSatellites}
          positions={positions}
          now={now}
          passWindowHours={passWindowHours}
          setPassWindowHours={setPassWindowHours}
          setSimOffset={setSimOffset}
          setSelected={setSelected}
          selectedStationIds={selectedStationIds}
          groundStations={groundStations}
          onClose={handleCloseSchedule}
        />
      )}
      <DrawerHeader title="Pass Predictions" subtitle={activeSatLabel} onClose={onClose} />

      {/* Pass window + min El controls */}
      <div className="px-3 py-2 border-b border-space-700/50 flex items-center gap-2 flex-shrink-0">
        {/* A5: toggle group with role + aria-pressed */}
        <div role="group" aria-label="Pass window" className="flex gap-1">
          {([24, 48, 72] as const).map((h) => (
            <button
              key={h}
              onClick={() => setPassWindowHours(h)}
              aria-pressed={passWindowHours === h}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                passWindowHours === h
                  ? 'border-cyan-500/50 text-cyan-400 bg-cyan-500/10'
                  : 'border-space-700 text-slate-500 hover:text-slate-300'
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
        {/* A4: aria-label; B3: also disabled while loading with no computed passes */}
        <button
          onClick={() => setShowSchedule(true)}
          disabled={cappedSatIds.length === 0 || selectedStationIds.length === 0 || (passesLoading && allFlatPasses.length === 0)}
          aria-label="Open full pass schedule"
          title="Open full pass schedule"
          className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-cyan-700/60 text-cyan-400 hover:bg-cyan-500/10 transition-colors disabled:opacity-30 disabled:border-space-700 disabled:text-slate-500"
        >
          <span aria-hidden="true" className="text-sm leading-none">⤢</span>
          <span>Schedule</span>
        </button>
        <button
          onClick={() => setSortByEl(v => !v)}
          aria-pressed={sortByEl}
          title={sortByEl ? 'Sort by time' : 'Sort by elevation'}
          className={`text-[10px] border rounded px-1.5 py-0.5 transition-colors ${
            sortByEl ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10'
                     : 'border-space-700 text-slate-500 hover:text-slate-300'
          }`}
        >↕ El°</button>
        <div className="flex-1" />
        <label className="text-[10px] text-slate-500 uppercase tracking-wide">Min El</label>
        <input
          type="number"
          min="0"
          max="45"
          step="1"
          value={minElDeg}
          onChange={(e) => setMinElDeg(Math.max(0, Math.min(45, parseInt(e.target.value) || 0)))}
          className="w-12 bg-space-800 border border-space-700 rounded px-1 py-0.5 text-xs text-white text-right focus:outline-none focus:border-cyan-500/50"
        />
        <span className="text-[10px] text-slate-500">°</span>
      </div>

      {/* SIM mode indicator */}
      {!simClock.isLive && (
        <div className="px-4 py-1.5 border-b border-space-700/50 flex items-center gap-2 flex-shrink-0 bg-amber-500/5">
          <span className="text-[10px] font-semibold text-amber-400 tracking-widest">SIM</span>
          <span className="text-[10px] text-slate-500 font-mono">
            Passes from {formatAos(now)}
          </span>
        </div>
      )}

      {/* Stale TLE warning — single-sat mode only */}
      {!isMultiSat && selected?.line1 && (() => {
        const age = parseTleAge(selected.line1)
        return age.days >= 14 ? (
          <div role="alert" aria-atomic="true" aria-live="assertive"
               className="px-4 py-2 flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 flex-shrink-0">
            <span aria-hidden="true" className="text-amber-400 text-xs">⚠</span>
            <span className="text-xs text-amber-400/80">
              TLE is {Math.floor(age.days)} days old — pass times may be inaccurate
            </span>
          </div>
        ) : null
      })()}

      {/* Next-pass sticky banner */}
      {nextEntry && selectedStationIds.length > 0 && (
        <div className={`px-4 py-2 flex items-center justify-between gap-3 border-b flex-shrink-0 ${
          nextPassIsActive ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-space-800/40 border-space-700/50'
        }`}>
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-[10px] font-semibold tracking-widest uppercase flex-shrink-0 ${
              nextPassIsActive ? 'text-emerald-400' : 'text-slate-500'
            }`}>{nextPassIsActive ? '▲ IN PASS' : 'NEXT'}</span>
            <span className={`text-xs font-semibold font-mono flex-shrink-0 ${elColor(nextEntry.pass.tcaElDeg)}`}>
              {nextEntry.pass.tcaElDeg.toFixed(1)}°{nextEntry.pass.tcaElDeg >= 45 && <span className="text-amber-400"> ★</span>}
            </span>
            <span className="text-xs text-slate-400 truncate">{nextEntry.stationName}</span>
            <span className="text-[10px] text-slate-600 font-mono flex-shrink-0">
              {nextEntry.pass.aosAzDeg.toFixed(0)}°→{nextEntry.pass.losAzDeg.toFixed(0)}°
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className={`text-sm font-bold font-mono ${nextPassIsActive ? 'text-emerald-400' : 'text-cyan-400'}`}>
              {nextPassIsActive ? formatCountdown(nextEntry.pass.losTime - now) : formatCountdown(nextEntry.pass.aosTime - now)}
            </span>
            <span className="text-[10px] text-slate-600">{nextPassIsActive ? 'to LOS' : 'to AOS'}</span>
          </div>
        </div>
      )}

      {/* Mini-gantt timeline — all sats × all selected GSs */}
      {timelineStations.length > 0 && (
        <div className="px-4 pt-3 pb-2 border-b border-space-700/50 flex-shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">{passWindowHours}h Access</span>
            <div className="flex items-center gap-2 text-[10px] text-slate-600 font-mono">
              <span>{formatTimeShort(now)}</span>
              <span>→</span>
              <span>{formatTimeShort(now + windowMs)}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {timelineStations.map((gs) => {
              const stPasses = allFlatPasses.filter((e) => e.stationId === gs.id)
              return (
                <div key={gs.id} className="flex items-center gap-2 h-7">
                  <div className="text-xs font-mono text-slate-500 truncate flex-shrink-0 w-24">
                    {gs.name}
                  </div>
                  <div className="relative flex-1 h-5 bg-space-800 rounded overflow-hidden">
                    <div className="absolute top-0 bottom-0 w-px bg-white/20 z-10" style={{ left: '0%' }} />
                    {stPasses.map((entry) => {
                      const left  = pct(entry.pass.aosTime)
                      const right = pct(entry.pass.losTime)
                      const width = right - left
                      if (width <= 0) return null
                      return (
                        <button
                          type="button"
                          key={`${entry.noradId}-${entry.pass.aosTime}`}
                          aria-label={`${entry.satName} pass over ${gs.name} — AOS ${formatAos(entry.pass.aosTime)}, max elevation ${entry.pass.tcaElDeg.toFixed(1)}°, click to jump`}
                          className="absolute top-0.5 bottom-0.5 rounded-sm hover:opacity-80 transition-opacity focus:outline-none focus:ring-1 focus:ring-white/40"
                          style={{
                            left:       `${left}%`,
                            width:      `${Math.max(width, 1)}%`,
                            background: passColor(entry.pass.tcaElDeg),
                          }}
                          onClick={() => setSimOffset(entry.pass.aosTime - Date.now())}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect()
                            setTooltip({ pass: entry.pass, satName: entry.satName, stationName: gs.name, x: e.clientX, y: rect.top - 4 })
                          }}
                          onMouseLeave={() => setTooltip(null)}
                        />
                      )
                    })}
                    {stPasses.length === 0 && passesLoading && (
                      <div className="absolute inset-0 bg-space-700/30 animate-pulse" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {/* Color legend */}
          <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-600">
            {[{ color: '#22c55e', label: '≥45°' }, { color: '#06b6d4', label: '≥15°' }, { color: '#f59e0b', label: '≥5°' }].map(({ color, label }) => (
              <span key={label} className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* No station CTA */}
      {selectedStationIds.length === 0 && (
        <div className="px-4 py-5 text-center flex-shrink-0 border-b border-space-700/50">
          <p className="text-xs text-slate-400">No ground station selected.</p>
          <button
            onClick={() => onNavigate('stations')}
            className="mt-2 text-xs px-3 py-1.5 rounded border border-emerald-700/50 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
          >
            ⊕ Open Stations tab
          </button>
        </div>
      )}

      {/* GS filter chips — shown when >1 station selected */}
      {selectedStationIds.length > 1 && (
        <div className="flex gap-1 px-3 pt-2 pb-1 border-b border-space-700/50 flex-shrink-0 flex-wrap">
          <button
            onClick={() => setActiveGsFilter('all')}
            className={`text-xs px-2.5 py-0.5 rounded border transition-colors ${
              activeGsFilter === 'all'
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                : 'border-space-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'
            }`}
          >
            All
          </button>
          {selectedStationIds.map((id) => {
            const gs = groundStations.find((s) => s.id === id)
            if (!gs) return null
            return (
              <button
                key={id}
                onClick={() => setActiveGsFilter(id)}
                className={`text-xs px-2.5 py-0.5 rounded border transition-colors ${
                  activeGsFilter === id
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                    : 'border-space-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'
                }`}
              >
                {gs.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Single station label */}
      {selectedStationIds.length === 1 && (
        <div className="px-4 py-1 text-[10px] text-slate-500 flex-shrink-0">
          {groundStations.find((s) => s.id === selectedStationIds[0])?.name}
        </div>
      )}

      {/* Coverage bar */}
      {selectedStationIds.length > 0 && (
        <div className="px-4 pb-2 border-b border-space-700/50 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-slate-600 uppercase tracking-wide">Coverage</span>
            <span className="text-[10px] font-mono text-slate-400">
              {coveragePct.toFixed(1)}%
              {totalContactSec > 0 && (
                <span className="text-slate-600 ml-1">
                  · {formatContactDuration(totalContactSec)} / {passWindowHours}h
                </span>
              )}
            </span>
          </div>
          <div className="h-1 bg-space-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(coveragePct, 100)}%`,
                background: coveragePct >= 20 ? '#22d3ee' : coveragePct >= 5 ? '#06b6d4' : '#f59e0b',
              }}
            />
          </div>
        </div>
      )}

      {/* Best pass card */}
      {showBestCard && bestEntry && (
        <div className="mx-3 my-1 px-3 py-1.5 rounded border border-emerald-700/40 bg-emerald-500/5 flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide flex-shrink-0">Best</span>
          <span className={`text-xs font-bold font-mono flex-shrink-0 ${elColor(bestEntry.pass.tcaElDeg)}`}>
            {bestEntry.pass.tcaElDeg.toFixed(1)}°{bestEntry.pass.tcaElDeg >= 45 && <span className="text-amber-400"> ★</span>}
          </span>
          <span className="text-xs text-slate-300 truncate min-w-0">{bestEntry.satName}</span>
          <span className="text-slate-600 text-[10px] flex-shrink-0">·</span>
          <span className="text-xs text-slate-400 flex-shrink-0 truncate">{bestEntry.stationName}</span>
          <div className="flex-1" />
          <span className="text-[10px] font-mono text-slate-500 flex-shrink-0">{formatAos(bestEntry.pass.aosTime)}</span>
        </div>
      )}

      {/* Column headers */}
      {selectedStationIds.length > 0 && (
        <div
          className="grid gap-x-2 px-3 py-1 border-b border-space-700/50 text-[10px] text-slate-600 uppercase tracking-wide flex-shrink-0"
          style={{ gridTemplateColumns: passesGrid }}
        >
          {isMultiSat && <span>Sat</span>}
          <span>GS</span>
          <span>AOS (UTC)</span>
          <span>Max El</span>
          <span className="text-right">AOS Az</span>
          <span className="text-right">Dur</span>
          <span />
        </div>
      )}

      {/* Pass list — time-grouped, collapsible */}
      {selectedStationIds.length > 0 && (
        <div className="overflow-y-auto flex flex-col flex-1">
          {passesLoading && passes.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-slate-500 animate-pulse">
              Computing passes…
            </div>
          )}
          {!passesLoading && passes.length === 0 && (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-slate-500">
                No passes in the next {passWindowHours}h{minElDeg > 0 ? ` above ${minElDeg}°` : ''}.
              </p>
              <p className="text-[10px] text-slate-600 mt-1">Satellite may be below horizon for this station.</p>
            </div>
          )}
          {sortByEl
            ? elGroupedPasses.map((group) => {
                const isCollapsed = collapsed.has(group.key)
                return (
                  <div key={group.key}>
                    <button
                      onClick={() => toggleCollapsed(group.key)}
                      className="w-full flex items-center justify-between px-3 py-1 text-[10px] text-slate-500 uppercase tracking-widest hover:text-slate-300 transition-colors bg-space-900/50 sticky top-0 z-10"
                    >
                      <span>{group.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="normal-case text-slate-600">
                          {group.entries.length} pass{group.entries.length !== 1 ? 'es' : ''}
                        </span>
                        <span>{isCollapsed ? '▴' : '▾'}</span>
                      </span>
                    </button>
                    {!isCollapsed && group.entries.map((entry) => (
                      <PassRow
                        key={`${entry.noradId}-${entry.pass.aosTime}`}
                        entry={entry}
                        isNext={nextEntry === entry}
                        isPast={false}
                        now={now}
                        showSat={isMultiSat}
                        grid={passesGrid}
                      />
                    ))}
                  </div>
                )
              })
            : groupedPasses.map((group) => {
                const isCollapsed = collapsed.has(group.key)
                return (
                  <div key={group.key}>
                    <button
                      onClick={() => toggleCollapsed(group.key)}
                      className="w-full flex items-center justify-between px-3 py-1 text-[10px] text-slate-500 uppercase tracking-widest hover:text-slate-300 transition-colors bg-space-900/50 sticky top-0 z-10"
                    >
                      <span>{group.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-[9px] text-slate-600 normal-case font-mono ml-1.5">
                          {formatTimeShort(group.from)}–{formatTimeShort(group.to)}
                        </span>
                        <span className="normal-case text-slate-600">
                          {group.entries.length} pass{group.entries.length !== 1 ? 'es' : ''}
                        </span>
                        <span>{isCollapsed ? '▴' : '▾'}</span>
                      </span>
                    </button>
                    {!isCollapsed && group.entries.map((entry) => (
                      <PassRow
                        key={`${entry.noradId}-${entry.pass.aosTime}`}
                        entry={entry}
                        isNext={nextEntry === entry}
                        isPast={entry.pass.losTime < now}
                        now={now}
                        showSat={isMultiSat}
                        grid={passesGrid}
                      />
                    ))}
                  </div>
                )
              })
          }
        </div>
      )}

      {/* Footer */}
      {passes.length > 0 && (
        <div className="px-4 py-2 border-t border-space-700/50 text-[10px] text-slate-600 flex items-center justify-between flex-shrink-0">
          <span>{passes.length} passes in {passWindowHours}h</span>
          <div className="flex items-center gap-3">
            {nextEntry && (
              <span className="text-cyan-400">
                Next in {formatCountdown(nextEntry.pass.aosTime - now)}
              </span>
            )}
            {/* Export CSV */}
            <button
              onClick={() => {
                const pad = (n: number) => String(n).padStart(2, '0')
                const fmtUtc = (ms: number) => {
                  const d = new Date(ms)
                  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ` +
                         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
                }
                const header = 'Satellite,Station,AOS (UTC),AOS Az (°),Max El (°),LOS (UTC),LOS Az (°),Duration (s)'
                const rows = passes.map((e) =>
                  [e.satName, e.stationName, fmtUtc(e.pass.aosTime), e.pass.aosAzDeg.toFixed(1),
                   e.pass.tcaElDeg.toFixed(1), fmtUtc(e.pass.losTime), e.pass.losAzDeg.toFixed(1),
                   e.pass.durationSec].join(',')
                )
                const csv  = [header, ...rows].join('\n')
                const blob = new Blob([csv], { type: 'text/csv' })
                const url  = URL.createObjectURL(blob)
                const a    = document.createElement('a')
                a.href     = url
                a.download = `passes_${activeSatLabel.replace(/[^\w]/g, '_')}.csv`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(url)
              }}
              className="text-slate-500 hover:text-emerald-400 transition-colors"
              title="Export passes as CSV"
            >
              ↓ CSV
            </button>
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-space-900 border border-space-700 rounded px-3 py-2 text-xs shadow-xl"
          style={{ left: Math.min(tooltip.x + 12, window.innerWidth - 200), top: Math.max(8, tooltip.y - 80) }}
        >
          {isMultiSat && <div className="font-semibold text-cyan-400 mb-0.5">{tooltip.satName}</div>}
          <div className="font-semibold text-white mb-1">{tooltip.stationName}</div>
          <div className="text-slate-400">
            AOS: <span className="text-white font-mono">{formatTimeShort(tooltip.pass.aosTime)}</span>
          </div>
          <div className="text-slate-400">
            TCA: <span className="text-white font-mono">{formatTimeShort(tooltip.pass.tcaTime)}</span>
          </div>
          <div className="text-slate-400">
            Az: <span className="text-white font-mono">{tooltip.pass.aosAzDeg.toFixed(0)}°→{tooltip.pass.losAzDeg.toFixed(0)}°</span>
          </div>
          <div className="text-slate-400">
            Max El: <span className="font-mono" style={{ color: passColor(tooltip.pass.tcaElDeg) }}>
              {tooltip.pass.tcaElDeg.toFixed(1)}°
            </span>
          </div>
          <div className="text-slate-400">
            LOS: <span className="text-white font-mono">{formatTimeShort(tooltip.pass.losTime)}</span>
          </div>
          <div className="text-slate-400">
            Duration: <span className="text-white font-mono">{formatDur(tooltip.pass.durationSec)}</span>
          </div>
        </div>
      )}
    </>
  )
}

// ── Shared catalog-refresh hook ──────────────────────────────────────────────

function useCatalogRefresh() {
  const allSatellites        = useSatelliteStore((s) => s.allSatellites)
  const setAllSatellites     = useSatelliteStore((s) => s.setAllSatellites)
  const clearPassPredictions = useSatelliteStore((s) => s.clearPassPredictions)
  const isRefreshing         = useSatelliteStore((s) => s.isRefreshing)
  const refreshError         = useSatelliteStore((s) => s.refreshError)
  const setRefreshing        = useSatelliteStore((s) => s.setRefreshing)
  const setRefreshError      = useSatelliteStore((s) => s.setRefreshError)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshError(null)
    try {
      const result = await fetchActiveCatalog(allSatellites)
      setAllSatellites(result.satellites, result.fetchedAt)
      clearPassPredictions()
      setRefreshedAt(Date.now())
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  return { isRefreshing, refreshError, refreshedAt, handleRefresh }
}

// ── FILTERS Tab ─────────────────────────────────────────────────────────────

function relativeTime(ms: number): string {
  const diffMin = Math.floor((Date.now() - ms) / 60_000)
  if (diffMin < 1)  return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  return `${Math.floor(diffMin / 60)}h ago`
}

function FiltersTab({ onClose }: { onClose: () => void }) {
  const dataInfo = useSatelliteStore((s) => s.dataInfo)
  const { isRefreshing, refreshError, refreshedAt, handleRefresh } = useCatalogRefresh()

  const sourceLabel = refreshedAt
    ? `refreshed ${relativeTime(refreshedAt)}`
    : dataInfo.fetchedAt
    ? `fetched ${relativeTime(new Date(dataInfo.fetchedAt).getTime())}`
    : 'bundled data'

  return (
    <>
      <DrawerHeader title="Filters" onClose={onClose} />

      {/* Catalog status */}
      <div className="px-4 py-2 border-b border-space-700/50 flex-shrink-0 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500 font-mono truncate">
          <span className="text-slate-300">{dataInfo.count.toLocaleString()}</span> sats · {sourceLabel}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {refreshError && (
            <span className="text-[10px] text-red-400 truncate max-w-[120px]" title={refreshError}>
              {refreshError}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh TLE data from CelesTrak"
            className={`text-sm leading-none transition-colors ${
              isRefreshing
                ? 'text-slate-600 cursor-default animate-spin'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            ↻
          </button>
        </div>
      </div>

      <FilterPanel embedded />
    </>
  )
}

// ── STATIONS Tab ─────────────────────────────────────────────────────────────

function StationsTab({ onClose, onNavigate }: { onClose: () => void; onNavigate: (tab: Tab) => void }) {
  const passesEnabled      = useSatelliteStore((s) =>
    Boolean(s.selected) || s.selectedGroupIds.size > 0 || (s.filters.watchListOnly && s.watchList.size > 0)
  )
  const selectedStationIds = useSatelliteStore((s) => s.selectedStationIds)
  const ready = passesEnabled && selectedStationIds.length > 0
  return (
    <>
      <DrawerHeader title="Ground Stations" onClose={onClose} />
      <GroundStationManager embedded />
      {ready && (
        <div className="px-4 py-3 border-t border-space-700/50 flex-shrink-0">
          <button
            onClick={() => onNavigate('passes')}
            className="w-full text-xs py-1.5 rounded border border-cyan-700/60 text-cyan-400 hover:bg-cyan-500/10 transition-colors"
          >
            ≡ View Pass Predictions →
          </button>
        </div>
      )}
    </>
  )
}

// ── GROUPS Tab ────────────────────────────────────────────────────────────────

function GroupsTab({ onClose, onNavigate }: { onClose: () => void; onNavigate: (tab: Tab) => void }) {
  const selectedGroupIds   = useSatelliteStore((s) => s.selectedGroupIds)
  const selectedStationIds = useSatelliteStore((s) => s.selectedStationIds)
  const hasGroup   = selectedGroupIds.size > 0
  const hasStation = selectedStationIds.length > 0
  return (
    <>
      <DrawerHeader title="Constellation Groups" onClose={onClose} />
      <ConstellationManager embedded />
      {hasGroup && (
        <div className="px-4 py-3 border-t border-space-700/50 flex-shrink-0">
          {hasStation ? (
            <button
              onClick={() => onNavigate('passes')}
              className="w-full text-xs py-1.5 rounded border border-cyan-700/60 text-cyan-400 hover:bg-cyan-500/10 transition-colors"
            >
              ≡ View Pass Predictions →
            </button>
          ) : (
            <button
              onClick={() => onNavigate('stations')}
              className="w-full text-xs py-1.5 rounded border border-emerald-700/50 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            >
              ⊕ Select a ground station to compute passes →
            </button>
          )}
        </div>
      )}
    </>
  )
}

// ── SETTINGS Tab ─────────────────────────────────────────────────────────────

function SettingsTab({ onClose }: { onClose: () => void }) {
  const dataInfo       = useSatelliteStore((s) => s.dataInfo)
  const filters        = useSatelliteStore((s) => s.filters)
  const setMaxRendered = useSatelliteStore((s) => s.setMaxRendered)
  const setRefreshError = useSatelliteStore((s) => s.setRefreshError)
  const { isRefreshing, refreshError, refreshedAt, handleRefresh } = useCatalogRefresh()

  const [clearing, setClearing] = useState(false)
  const [cleared,  setCleared]  = useState(false)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => { if (clearTimerRef.current) clearTimeout(clearTimerRef.current) }
  }, [])

  const handleClearCache = async () => {
    setClearing(true)
    try {
      await clearCatalog()
      setCleared(true)
      clearTimerRef.current = setTimeout(() => setCleared(false), 3000)
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Failed to clear cache')
    } finally {
      setClearing(false)
    }
  }

  const sourceLabel = refreshedAt
    ? `refreshed ${relativeTime(refreshedAt)}`
    : dataInfo.fetchedAt
    ? `fetched ${relativeTime(new Date(dataInfo.fetchedAt).getTime())}`
    : 'bundled data'

  return (
    <>
      <DrawerHeader title="Settings" onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-4 space-y-6">

        {/* ── Catalog ── */}
        <section>
          <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">Catalog</h3>
          <div className="bg-space-800/60 rounded-lg p-3 space-y-3">
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-slate-400">Satellites</span>
              <span className="text-xs font-mono text-white">{dataInfo.count.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-slate-400">Last updated</span>
              <span className="text-xs font-mono text-slate-300">{sourceLabel}</span>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors border
                  ${isRefreshing
                    ? 'border-space-600 text-slate-600 cursor-default'
                    : 'border-cyan-700 text-cyan-400 hover:bg-cyan-900/30'}`}
              >
                {isRefreshing ? '↻ Refreshing…' : '↻ Refresh from CelesTrak'}
              </button>
            </div>
            {refreshError && (
              <p className="text-xs text-red-400">{refreshError}</p>
            )}
            <div className="pt-1 border-t border-space-700/50">
              <p className="text-[10px] text-slate-500 mb-2">
                Clear cached catalog from IndexedDB. The bundled snapshot will be used on next load.
              </p>
              <button
                onClick={handleClearCache}
                disabled={clearing || cleared}
                className={`w-full py-1.5 rounded text-xs font-medium transition-colors border
                  ${cleared
                    ? 'border-emerald-700 text-emerald-400 cursor-default'
                    : clearing
                    ? 'border-space-600 text-slate-600 cursor-default'
                    : 'border-space-600 text-slate-400 hover:border-red-700/60 hover:text-red-400'}`}
              >
                {cleared ? '✓ Cache cleared' : clearing ? 'Clearing…' : 'Clear catalog cache'}
              </button>
            </div>
          </div>
        </section>

        {/* ── Display ── */}
        <section>
          <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">Display</h3>
          <div className="bg-space-800/60 rounded-lg p-3 space-y-4">
            <div>
              <div className="flex justify-between items-baseline mb-2">
                <span className="text-xs text-slate-400">Max satellites rendered</span>
                <span className="text-xs font-mono text-white">{filters.maxRendered.toLocaleString()}</span>
              </div>
              <input
                type="range"
                min={100}
                max={10000}
                step={100}
                value={filters.maxRendered}
                onChange={(e) => setMaxRendered(Number(e.target.value))}
                className="w-full h-1.5 bg-space-700 rounded-full appearance-none cursor-pointer accent-cyan-400"
              />
              <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                <span>100</span>
                <span>10,000</span>
              </div>
            </div>
          </div>
        </section>

      </div>
    </>
  )
}

// ── Tab icon button ──────────────────────────────────────────────────────────

function TabIcon({ icon, label, active, disabled, disabledTitle, onClick }: {
  icon: string
  label: string
  active: boolean
  disabled?: boolean
  disabledTitle?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled && disabledTitle ? disabledTitle : label}
      className={`
        flex flex-col items-center justify-center w-12 h-14 gap-0.5 transition-colors
        ${disabled
          ? 'text-slate-700 cursor-default'
          : active
          ? 'text-cyan-400 bg-space-800/80'
          : 'text-slate-500 hover:text-slate-300 hover:bg-space-800/40'}
      `}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="text-[9px] uppercase tracking-wide">{label}</span>
    </button>
  )
}

// ── Main drawer ──────────────────────────────────────────────────────────────

export default function RightDrawer() {
  const [tab, setTab] = useState<Tab | null>(null)
  const selected         = useSatelliteStore((s) => s.selected)
  const selectedGroupIds = useSatelliteStore((s) => s.selectedGroupIds)
  const watchList        = useSatelliteStore((s) => s.watchList)
  const watchListOnly    = useSatelliteStore((s) => s.filters.watchListOnly)
  const selectedNoradId  = selected?.noradId

  const passesEnabled      = Boolean(selected) || selectedGroupIds.size > 0 || (watchListOnly && watchList.size > 0)
  const selectedStationIds = useSatelliteStore((s) => s.selectedStationIds)

  // Auto-open SAT tab on new selection — only when the panel is idle or on passes.
  // Respect user's choice if they're already on Filters/Stations/Groups/Settings.
  useEffect(() => {
    if (selectedNoradId) {
      setTab((prev) => (prev === null || prev === 'passes') ? 'sat' : prev)
    } else {
      setTab((prev) => (prev === 'sat' || prev === 'passes') ? null : prev)
    }
  }, [selectedNoradId])

  // Auto-advance to PASSES when the user has both a satellite/group AND a station.
  // Only fires when coming from the stations tab (user just completed setup).
  useEffect(() => {
    if (passesEnabled && selectedStationIds.length > 0) {
      setTab((prev) => prev === 'stations' ? 'passes' : prev)
    }
  }, [passesEnabled, selectedStationIds.length])  // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTab = (t: Tab) => setTab((prev) => prev === t ? null : t)

  return (
    <div className="absolute left-0 top-0 bottom-8 z-20 flex flex-row pointer-events-none">

      {/* Icon strip — always visible, full height */}
      <div className="w-12 flex flex-col pointer-events-auto bg-space-900/90 backdrop-blur-sm border-r border-space-700">
        <TabIcon
          icon="◎"
          label="SAT"
          active={tab === 'sat'}
          disabled={!selected}
          disabledTitle="SAT — select a satellite first"
          onClick={() => selected && toggleTab('sat')}
        />
        <TabIcon
          icon="≡"
          label="PASSES"
          active={tab === 'passes'}
          disabled={!passesEnabled}
          disabledTitle="PASSES — select a satellite or group first"
          onClick={() => passesEnabled && toggleTab('passes')}
        />
        <TabIcon
          icon="⊕"
          label="STATIONS"
          active={tab === 'stations'}
          onClick={() => toggleTab('stations')}
        />
        <TabIcon
          icon="◈"
          label="GROUPS"
          active={tab === 'groups'}
          onClick={() => toggleTab('groups')}
        />
        <div className="flex-1" />
        <TabIcon
          icon="⊞"
          label="FILTERS"
          active={tab === 'filters'}
          onClick={() => toggleTab('filters')}
        />
        <TabIcon
          icon="⚙"
          label="SETTINGS"
          active={tab === 'settings'}
          onClick={() => toggleTab('settings')}
        />
      </div>

      {/* Content panel — slides in from right, clears SearchBar at top */}
      {tab && (
        <div className="w-96 mt-16 flex flex-col bg-space-900/90 backdrop-blur-sm border-r border-t border-space-700 rounded-tr-lg shadow-2xl overflow-hidden pointer-events-auto text-white">
          {tab === 'sat'      && <SatTab      onClose={() => setTab(null)} />}
          {tab === 'passes'   && <PassesTab   onClose={() => setTab(null)} onNavigate={setTab} />}
          {tab === 'filters'  && <FiltersTab  onClose={() => setTab(null)} />}
          {tab === 'stations' && <StationsTab onClose={() => setTab(null)} onNavigate={setTab} />}
          {tab === 'groups'   && <GroupsTab   onClose={() => setTab(null)} onNavigate={setTab} />}
          {tab === 'settings' && <SettingsTab onClose={() => setTab(null)} />}
        </div>
      )}
    </div>
  )
}
