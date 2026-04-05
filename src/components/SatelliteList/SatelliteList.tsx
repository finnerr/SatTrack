import { useState, useMemo, useEffect } from 'react'
import { useSatelliteStore } from '../../store/useSatelliteStore'
import { countryName } from '../../utils/countryNames'
import { parseTleAge } from '../../utils/tleUtils'
import type { SatellitePosition } from '../../types/satellite'

const ORBIT_COLOR: Record<string, string> = {
  LEO: 'text-cyan-400', MEO: 'text-amber-400',
  GEO: 'text-emerald-400', HEO: 'text-orange-400', UNKNOWN: 'text-slate-400',
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function SatelliteList({ open, onClose }: Props) {
  const { positions, allSatellites, setSelected, pinnedIds, pinnedMode, togglePinned, activatePinnedMode, clearPinned } = useSatelliteStore()
  // Build a lookup for line1 (needed for TLE age dot)
  const line1Map = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of allSatellites) if (s.line1) m.set(s.noradId, s.line1)
    return m
  }, [allSatellites])
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<'name' | 'alt' | 'country'>('name')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return positions
      .filter((p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.noradId.includes(q) ||
        p.country.toLowerCase().includes(q),
      )
      .slice()
      .sort((a, b) => {
        if (sortKey === 'alt')     return b.alt - a.alt
        if (sortKey === 'country') return a.country.localeCompare(b.country)
        return a.name.localeCompare(b.name)
      })
  }, [positions, search, sortKey])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleSelect = (pos: SatellitePosition) => {
    const meta = allSatellites.find((s) => s.noradId === pos.noradId)
    setSelected({ ...pos, line1: meta?.line1 ?? '', line2: meta?.line2 ?? '' })
    onClose()
  }

  if (!open) return null

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[560px] max-h-[70vh] bg-space-900 border border-space-700 rounded-lg shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>

        {pinnedMode && (
          <div className="flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border-b border-cyan-500/20 flex-shrink-0">
            <span className="text-xs text-cyan-400">Showing {positions.length} pinned satellites</span>
            <div className="flex-1" />
            <button
              onClick={clearPinned}
              className="text-xs text-slate-500 hover:text-red-400 transition-colors"
            >
              clear pins
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-space-700 flex-shrink-0">
          <span className="text-sm font-semibold text-white tracking-wide">
            SATELLITES
          </span>
          <span className="text-xs text-cyan-400">{positions.length.toLocaleString()} rendered</span>
          <div className="flex-1" />
          <button onClick={onClose} aria-label="Close satellite list" className="text-slate-500 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-space-700 flex-shrink-0">
          <input
            type="text"
            placeholder="Filter by name, NORAD ID, country…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            className="flex-1 bg-space-800 border border-space-700 rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
          />
          <div className="flex gap-1">
            {(['name', 'alt', 'country'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  sortKey === k
                    ? 'border-cyan-500/50 text-cyan-400 bg-cyan-500/10'
                    : 'border-space-700 text-slate-500 hover:text-slate-300'
                }`}
              >
                {k === 'alt' ? 'ALT' : k.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 font-mono text-xs">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-600">No satellites match</div>
          )}
          {filtered.map((pos) => (
            <div
              key={pos.noradId}
              className="w-full flex items-center gap-2 px-2 py-2 hover:bg-space-700/50 transition-colors border-b border-space-800/50"
            >
              {/* Pin checkbox */}
              <button
                onClick={() => togglePinned(pos.noradId)}
                className={`flex-shrink-0 w-4 h-4 rounded border transition-colors ${
                  pinnedIds.has(pos.noradId)
                    ? 'bg-cyan-500 border-cyan-500'
                    : 'border-space-600 hover:border-cyan-500/50'
                }`}
                aria-label={pinnedIds.has(pos.noradId) ? 'Unpin satellite' : 'Pin satellite'}
              >
                {pinnedIds.has(pos.noradId) && (
                  <span className="text-[8px] text-space-950 font-bold leading-none flex items-center justify-center w-full h-full">✓</span>
                )}
              </button>

              {/* Row content — click to select satellite */}
              <button
                onClick={() => handleSelect(pos)}
                className="flex-1 flex items-center gap-3 text-left font-mono text-xs"
              >
                <span className={`w-8 flex-shrink-0 ${ORBIT_COLOR[pos.orbitClass]}`}>
                  {pos.orbitClass}
                </span>
                {/* TLE age dot (4b) */}
                {(() => {
                  const l1 = line1Map.get(pos.noradId)
                  if (!l1) return <span className="w-1.5 h-1.5 rounded-full bg-slate-700 flex-shrink-0" />
                  const { days } = parseTleAge(l1)
                  const color = days < 7 ? 'bg-emerald-400' : days < 14 ? 'bg-amber-400' : 'bg-red-400'
                  const title = days < 7 ? 'Fresh TLE' : days < 14 ? 'Aging TLE' : 'Stale TLE'
                  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} title={title} />
                })()}
                <span className="flex-1 text-white truncate">{pos.name}</span>
                <span className="text-slate-500 w-12 text-right">{pos.noradId}</span>
                <span className="text-slate-600 w-16 text-right truncate" title={countryName(pos.country)}>{pos.country}</span>
                <span className="text-slate-500 w-16 text-right">{pos.alt.toFixed(0)} km</span>
              </button>
            </div>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-space-700 text-xs text-slate-600 flex-shrink-0 flex items-center gap-3">
          <span>
            {filtered.length < positions.length
              ? `Showing ${filtered.length} of ${positions.length}`
              : `${positions.length} satellites · click to select`}
          </span>
          <div className="flex-1" />
          {pinnedIds.size > 0 && !pinnedMode && (
            <button
              onClick={activatePinnedMode}
              className="text-xs px-2 py-1 rounded border border-cyan-500/50 text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors"
            >
              SHOW {pinnedIds.size} ONLY
            </button>
          )}
          {pinnedIds.size > 0 && (
            <button
              onClick={clearPinned}
              className="text-xs text-slate-600 hover:text-red-400 transition-colors"
            >
              clear
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
