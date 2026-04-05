import { useState, useRef, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react'
import * as satelliteJs from 'satellite.js'
import { useSatelliteStore } from '../../store/useSatelliteStore'
import { matchesGlob } from '../../utils/searchUtils'
import { logger } from '../../services/logger'
import type { SatelliteDetail, SatelliteMeta } from '../../types/satellite'

export interface SearchBarHandle {
  focus: () => void
}

const GROUP_COLORS = [
  '#06b6d4', '#f59e0b', '#10b981', '#ef4444',
  '#8b5cf6', '#f97316', '#ec4899', '#64748b',
]

function propagateOne(meta: SatelliteMeta): SatelliteDetail | null {
  try {
    const satrec = satelliteJs.twoline2satrec(meta.line1, meta.line2)
    const now = new Date()
    const pv = satelliteJs.propagate(satrec, now)
    if (!pv.position || typeof pv.position === 'boolean') return null
    const gmst  = satelliteJs.gstime(now)
    const geo   = satelliteJs.eciToGeodetic(pv.position as satelliteJs.EciVec3<number>, gmst)
    const vel   = pv.velocity as satelliteJs.EciVec3<number>
    const speed = typeof vel === 'boolean' ? 0
      : Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2)
    return {
      noradId:    meta.noradId,
      name:       meta.name,
      lat:        satelliteJs.degreesLat(geo.latitude),
      lon:        satelliteJs.degreesLong(geo.longitude),
      alt:        geo.height,
      velocity:   speed,
      orbitClass: meta.orbitClass,
      country:    meta.country,
      objectType: meta.objectType,
      line1:      meta.line1,
      line2:      meta.line2,
    }
  } catch {
    return null
  }
}

function orbitColor(oc: string): string {
  if (oc === 'LEO') return 'text-cyan-400'
  if (oc === 'MEO') return 'text-amber-400'
  if (oc === 'GEO') return 'text-emerald-400'
  if (oc === 'HEO') return 'text-orange-400'
  return 'text-slate-400'
}

const MAX_RESULTS = 15

const SearchBar = forwardRef<SearchBarHandle>(function SearchBar(_, ref) {
  const [query, setQuery]             = useState('')
  const [error, setError]             = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [checkedIds, setCheckedIds]   = useState<Set<string>>(new Set())
  const [showGroupPicker, setShowGroupPicker] = useState(false)
  const [creatingGroup, setCreatingGroup]     = useState(false)
  const [newGroupName, setNewGroupName]       = useState('')
  const [newGroupColor, setNewGroupColor]     = useState(GROUP_COLORS[0])
  const [addedFeedback, setAddedFeedback]     = useState<string | null>(null)
  const inputRef     = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const newGroupInputRef = useRef<HTMLInputElement>(null)

  const {
    allSatellites, setSelected, filters, toggleOrbitClass,
    setNameSearch, constellationGroups, addGroup, addSatellitesToGroup,
    toggleGroupFilter,
  } = useSatelliteStore()

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }))

  const q = query.trim()

  const allMatches = useMemo(() => {
    if (q.length < 2) return []
    return allSatellites.filter(
      (s) => matchesGlob(s.name, q) || s.noradId === q,
    )
  }, [allSatellites, q])

  const results = allMatches.slice(0, MAX_RESULTS)
  const overflow = allMatches.length - MAX_RESULTS

  // Clear checked + group picker when query changes
  useEffect(() => {
    setCheckedIds(new Set())
    setShowGroupPicker(false)
    setCreatingGroup(false)
  }, [q])

  // Open dropdown when there are results
  useEffect(() => {
    if (results.length > 0) setDropdownOpen(true)
    else if (q.length < 2) setDropdownOpen(false)
  }, [results.length, q.length])

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setShowGroupPicker(false)
        setCreatingGroup(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Focus new group input when it appears
  useEffect(() => {
    if (creatingGroup) newGroupInputRef.current?.focus()
  }, [creatingGroup])

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const allResultsChecked = results.length > 0 && results.every((s) => checkedIds.has(s.noradId))
  const toggleCheckAll = () => {
    if (allResultsChecked) {
      setCheckedIds((prev) => {
        const next = new Set(prev)
        results.forEach((s) => next.delete(s.noradId))
        return next
      })
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev)
        results.forEach((s) => next.add(s.noradId))
        return next
      })
    }
  }

  // Click a result: isolate that satellite on the globe + select it
  const selectSat = (meta: SatelliteMeta) => {
    setError('')
    const detail = propagateOne(meta)
    if (!detail) {
      setError(`Could not propagate ${meta.name} — TLE may be stale`)
      logger.error('Search', `Propagation failed for NORAD ${meta.noradId}`)
      return
    }
    logger.info('Search', `Selected: ${meta.name} (NORAD ${meta.noradId})`)
    setSelected(detail)
    // Show only this satellite: filter by its exact NORAD ID
    setNameSearch(meta.noradId)
    if (!filters.orbitClasses.has(meta.orbitClass)) {
      toggleOrbitClass(meta.orbitClass)
    }
    setQuery('')
    setDropdownOpen(false)
    inputRef.current?.blur()
  }

  // Enter key: show ALL matching satellites on the globe
  const handleSubmit = () => {
    if (!q) return
    if (allMatches.length === 0) {
      setError(`No satellite found for "${q}"`)
      logger.warn('Search', `No match for query: ${q}`)
      return
    }
    logger.info('Search', `Showing ${allMatches.length} satellites matching "${q}"`)
    setNameSearch(q)
    setDropdownOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  // Add checked satellites to an existing group
  const addToGroup = (groupId: string, groupName: string) => {
    addSatellitesToGroup(groupId, Array.from(checkedIds))
    toggleGroupFilter(groupId)  // activate the group filter so they appear
    setCheckedIds(new Set())
    setShowGroupPicker(false)
    setCreatingGroup(false)
    setAddedFeedback(`Added to "${groupName}"`)
    setTimeout(() => setAddedFeedback(null), 2500)
  }

  // Create a new group and add checked satellites to it
  const createAndAdd = () => {
    if (!newGroupName.trim()) return
    const id = addGroup(newGroupName.trim(), newGroupColor)
    addSatellitesToGroup(id, Array.from(checkedIds))
    toggleGroupFilter(id)  // activate so satellites appear immediately
    setCheckedIds(new Set())
    setShowGroupPicker(false)
    setCreatingGroup(false)
    setNewGroupName('')
    setNewGroupColor(GROUP_COLORS[0])
    setAddedFeedback(`Added to "${newGroupName.trim()}"`)
    setTimeout(() => setAddedFeedback(null), 2500)
  }

  return (
    <div ref={containerRef} className="absolute top-4 right-4 z-10">
      {/* Input row */}
      <div className="flex items-center gap-1 justify-end">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search name or NORAD ID…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setError('') }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
            if (e.key === 'Escape') { setDropdownOpen(false); inputRef.current?.blur() }
            if (e.key === 'ArrowDown' && dropdownOpen) {
              const first = containerRef.current?.querySelector<HTMLButtonElement>('[data-result]')
              first?.focus()
            }
          }}
          onFocus={() => { if (results.length > 0) setDropdownOpen(true) }}
          className="
            w-56 bg-space-900/90 backdrop-blur-sm border border-space-700
            rounded px-3 py-1.5 text-xs text-white placeholder-slate-600
            focus:outline-none focus:border-cyan-500/50 font-mono
          "
        />
        <button
          onClick={handleSubmit}
          aria-label="Search"
          title="Show all matches on globe"
          className="bg-space-900/90 border border-space-700 rounded px-2 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
        >
          ↵
        </button>
      </div>

      {/* Dropdown */}
      {dropdownOpen && results.length > 0 && (
        <div className="absolute top-full right-0 mt-1 w-80 bg-space-900/98 border border-space-700 rounded-lg shadow-2xl overflow-hidden backdrop-blur-sm">

          {/* Header */}
          <div className="px-3 py-1.5 border-b border-space-700/50 text-[10px] text-slate-600 flex items-center gap-2">
            <button
              onClick={toggleCheckAll}
              className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                allResultsChecked
                  ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-400'
                  : checkedIds.size > 0
                    ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-400'
                    : 'border-space-600 hover:border-slate-500'
              }`}
              title="Select all visible"
            >
              {allResultsChecked ? '✓' : checkedIds.size > 0 ? '−' : ''}
            </button>
            <span className="flex-1">
              {allMatches.length.toLocaleString()} match{allMatches.length !== 1 ? 'es' : ''}
              {!q.includes('*') && <span className="text-slate-700"> — try STARLINK* for wildcard</span>}
            </span>
            <span className="text-slate-700">↵ shows all · click to isolate</span>
          </div>

          {/* Result rows */}
          <div className="max-h-64 overflow-y-auto">
            {results.map((s, i) => {
              const checked = checkedIds.has(s.noradId)
              return (
                <div
                  key={s.noradId}
                  className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                    checked ? 'bg-cyan-500/5' : 'hover:bg-space-800'
                  }`}
                >
                  {/* Checkbox */}
                  <button
                    onClick={() => toggleCheck(s.noradId)}
                    className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                      checked
                        ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-400'
                        : 'border-space-600 hover:border-slate-400'
                    }`}
                    title={checked ? 'Deselect' : 'Select'}
                  >
                    {checked && <span className="text-[8px] leading-none">✓</span>}
                  </button>

                  {/* Satellite info — click to isolate + select */}
                  <button
                    data-result
                    onClick={() => selectSat(s)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        const next = containerRef.current?.querySelectorAll<HTMLButtonElement>('[data-result]')[i + 1]
                        next?.focus()
                      }
                      if (e.key === 'ArrowUp') {
                        if (i === 0) inputRef.current?.focus()
                        else {
                          const prev = containerRef.current?.querySelectorAll<HTMLButtonElement>('[data-result]')[i - 1]
                          prev?.focus()
                        }
                      }
                      if (e.key === 'Enter') selectSat(s)
                      if (e.key === 'Escape') { setDropdownOpen(false); inputRef.current?.focus() }
                    }}
                    className="flex-1 flex items-center gap-2 focus:outline-none text-left min-w-0"
                  >
                    <span className={`text-[10px] font-mono w-8 flex-shrink-0 ${orbitColor(s.orbitClass)}`}>
                      {s.orbitClass}
                    </span>
                    <span className="flex-1 text-white font-mono truncate">{s.name}</span>
                    <span className="text-slate-500 text-[10px] font-mono flex-shrink-0">{s.noradId}</span>
                  </button>
                </div>
              )
            })}
          </div>

          {overflow > 0 && (
            <div className="px-3 py-1.5 border-t border-space-700/50 text-[10px] text-slate-600">
              +{overflow.toLocaleString()} more — refine your search or press ↵ to show all
            </div>
          )}

          {/* Add to Group footer — shown when items are checked */}
          {checkedIds.size > 0 && !showGroupPicker && (
            <div className="px-3 py-2 border-t border-space-700/50 bg-space-800/60 flex items-center gap-2">
              <span className="text-[10px] text-slate-400 flex-1">{checkedIds.size} selected</span>
              <button
                onClick={() => setCheckedIds(new Set())}
                className="text-[10px] text-slate-600 hover:text-slate-300 transition-colors"
              >
                clear
              </button>
              <button
                onClick={() => setShowGroupPicker(true)}
                className="text-[10px] px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
              >
                + Add to Group
              </button>
            </div>
          )}

          {/* Group picker */}
          {showGroupPicker && (
            <div className="border-t border-space-700/50 bg-space-800/60">
              <div className="px-3 pt-2 pb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Add {checkedIds.size} to group
                </span>
                <button
                  onClick={() => { setShowGroupPicker(false); setCreatingGroup(false) }}
                  className="text-slate-600 hover:text-slate-300 text-xs"
                >
                  ✕
                </button>
              </div>

              {/* Existing groups */}
              {constellationGroups.length > 0 && (
                <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                  {constellationGroups.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => addToGroup(g.id, g.name)}
                      className="flex items-center gap-1 px-2 py-1 rounded border border-space-600 hover:border-slate-500 text-[10px] text-slate-300 hover:text-white transition-colors"
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: g.color }} />
                      {g.name}
                      <span className="text-slate-600 ml-0.5">{g.noradIds.length}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* New group form */}
              {!creatingGroup ? (
                <div className="px-3 pb-2">
                  <button
                    onClick={() => setCreatingGroup(true)}
                    className="text-[10px] text-cyan-400/70 hover:text-cyan-400 transition-colors flex items-center gap-1"
                  >
                    <span>+</span>
                    <span>New group…</span>
                  </button>
                </div>
              ) : (
                <div className="px-3 pb-3 flex flex-col gap-2 border-t border-space-700/50 pt-2">
                  <input
                    ref={newGroupInputRef}
                    type="text"
                    placeholder="Group name…"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createAndAdd()
                      if (e.key === 'Escape') setCreatingGroup(false)
                    }}
                    className="w-full bg-space-700 border border-space-600 rounded px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
                  />
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1 flex-1 flex-wrap">
                      {GROUP_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setNewGroupColor(c)}
                          className={`w-4 h-4 rounded-full transition-transform ${newGroupColor === c ? 'scale-125 ring-1 ring-white/40' : 'hover:scale-110'}`}
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                    <button
                      onClick={createAndAdd}
                      disabled={!newGroupName.trim()}
                      className="text-[10px] px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Create
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Feedback */}
          {addedFeedback && (
            <div className="px-3 py-1.5 border-t border-emerald-500/20 bg-emerald-500/5 text-[10px] text-emerald-400">
              {addedFeedback} ✓
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="flex justify-end mt-1">
          <span className="text-xs text-red-400 bg-space-900/80 px-2 py-0.5 rounded">
            {error}
          </span>
        </div>
      )}
    </div>
  )
})

export default SearchBar
