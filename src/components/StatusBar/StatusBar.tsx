import { useEffect, useState } from 'react'
import { useSatelliteStore } from '../../store/useSatelliteStore'
import { useLogStore } from '../../services/logger'
import { getSimTimeMs, formatSimUtc } from '../../utils/simTime'

interface Props {
  logOpen: boolean
  onToggleLog: () => void
  listOpen: boolean
  onToggleList: () => void
}


export default function StatusBar({ logOpen, onToggleLog, listOpen, onToggleList }: Props) {
  const [tick, setTick] = useState(0)
  const { filters, positions, loading } = useSatelliteStore()
  const simClock    = useSatelliteStore((s) => s.simClock)
  const cursorLatLon = useSatelliteStore((s) => s.cursorLatLon)
  const entries     = useLogStore((s) => s.entries)

  // Tick every second to refresh the displayed time
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const displayTime = formatSimUtc(getSimTimeMs(simClock))
  void tick  // consumed only to trigger re-render each second

  const filterCount = filters.countries.size + filters.orbitClasses.size + filters.objectTypes.size
  const errorCount  = entries.filter((e) => e.level === 'ERROR').length
  const warnCount   = entries.filter((e) => e.level === 'WARN').length

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 bg-space-950/80 backdrop-blur-sm border-t border-space-700 px-4 py-1 flex items-center gap-4 text-xs font-mono text-slate-400">
      <span className="text-cyan-500 font-semibold tracking-widest">SATTRACK</span>
      <span className={simClock.isLive ? '' : 'text-amber-400'}>{displayTime}</span>
      {!simClock.isLive && <span className="text-amber-500 text-[10px] font-semibold tracking-widest animate-pulse">SIM</span>}
      {cursorLatLon && (
        <span className="text-slate-300">
          {cursorLatLon.lat >= 0
            ? `${cursorLatLon.lat.toFixed(3)}°N`
            : `${Math.abs(cursorLatLon.lat).toFixed(3)}°S`}
          {' '}
          {cursorLatLon.lon >= 0
            ? `${cursorLatLon.lon.toFixed(3)}°E`
            : `${Math.abs(cursorLatLon.lon).toFixed(3)}°W`}
        </span>
      )}
      {loading && <span className="text-cyan-400 animate-pulse">PROPAGATING</span>}
      {filterCount > 0 && (
        <span>{filterCount} filter{filterCount !== 1 ? 's' : ''}</span>
      )}

      {/* Clickable satellite count — opens list panel */}
      {positions.length > 0 && (
        <button
          onClick={onToggleList}
          className={`flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
            listOpen
              ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400'
              : 'border-space-700 text-slate-400 hover:text-white hover:border-slate-500'
          }`}
        >
          {positions.length.toLocaleString()} satellites
          <span className="text-slate-600">↑</span>
        </button>
      )}

      <div className="flex-1" />
      <span className="text-slate-600">TLE · CelesTrak &nbsp;·&nbsp; Imagery · NASA GIBS / OSM</span>

      <button
        onClick={onToggleLog}
        className={`flex items-center gap-1.5 px-2 py-0.5 rounded border transition-colors ${
          logOpen
            ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400'
            : 'border-space-700 text-slate-500 hover:text-slate-300'
        }`}
      >
        <span>LOGS</span>
        {(errorCount > 0 || warnCount > 0) && (
          <span className={errorCount > 0 ? 'text-red-400' : 'text-amber-400'}>
            {errorCount > 0 ? `${errorCount}E` : `${warnCount}W`}
          </span>
        )}
      </button>
    </div>
  )
}
