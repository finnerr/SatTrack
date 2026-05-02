import { useState, useMemo } from 'react'
import { useSatelliteStore } from '../../store/useSatelliteStore'
import { getCountries } from '../../services/localData'
import { applyFilters } from '../../services/satelliteEngine'
import { countryName } from '../../utils/countryNames'
import type { OrbitClass, SatelliteUserType, SatellitePurpose, InclinationBand, TleAgeBand } from '../../types/satellite'

// ── Label maps (shared between filter sections and active-filter bar) ─────────

const INCLINATION_LABELS: Record<InclinationBand, string> = {
  EQUATORIAL:       'Equatorial',
  MID_LATITUDE:     'Mid-Latitude',
  HIGH_INCLINATION: 'High Incl.',
  POLAR:            'Polar',
  SUN_SYNCHRONOUS:  'Sun-Sync',
  RETROGRADE:       'Retrograde',
}

const PURPOSE_LABELS: Record<SatellitePurpose, string> = {
  COMMUNICATIONS:    'Communications',
  EARTH_OBSERVATION: 'Earth Obs',
  NAVIGATION:        'Navigation',
  RECONNAISSANCE:    'Reconnaissance',
  WEATHER:           'Weather',
  SPACE_SCIENCE:     'Space Science',
  TECHNOLOGY:        'Technology',
  OTHER:             'Other',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-widest hover:text-slate-300 transition-colors"
    >
      {label}
      <span className="text-slate-600">{open ? '▾' : '▸'}</span>
    </button>
  )
}

function Chip({
  label,
  active,
  count,
  color,
  onClick,
}: {
  label: string
  active: boolean
  count?: number
  color?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-1.5 px-2 py-1 rounded text-xs border transition-colors text-left
        ${active
          ? `border-current bg-current/10 ${color ?? 'text-cyan-400 border-cyan-500/40'}`
          : 'border-space-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'}
      `}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? 'bg-current' : 'bg-slate-700'}`}
      />
      <span>{label}</span>
      {count != null && (
        <span className="text-slate-600 text-xs ml-auto pl-1">{count.toLocaleString()}</span>
      )}
    </button>
  )
}

// Dismissible chip used in the active-filter summary bar
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 whitespace-nowrap flex-shrink-0">
      {label}
      <button
        onClick={onRemove}
        className="ml-0.5 text-cyan-400 hover:text-white transition-colors leading-none"
        title={`Remove "${label}" filter`}
        aria-label={`Remove ${label} filter`}
      >
        ×
      </button>
    </span>
  )
}

type ActiveFilterBarProps = {
  filters: ReturnType<typeof useSatelliteStore.getState>['filters']
  selectedGroupIds: Set<string>
  constellationGroups: ReturnType<typeof useSatelliteStore.getState>['constellationGroups']
  clearFilters: () => void
  setNameSearch: (v: string) => void
  toggleOrbitClass: (v: OrbitClass) => void
  toggleInclinationBand: (v: InclinationBand) => void
  toggleTleAgeBand: (v: TleAgeBand) => void
  togglePurpose: (v: SatellitePurpose) => void
  toggleUserType: (v: SatelliteUserType) => void
  toggleCountry: (code: string) => void
  setWatchListOnly: (v: boolean) => void
  toggleGroupFilter: (id: string) => void
}

function ActiveFilterBar({
  filters,
  selectedGroupIds,
  constellationGroups,
  clearFilters,
  setNameSearch,
  toggleOrbitClass,
  toggleInclinationBand,
  toggleTleAgeBand,
  togglePurpose,
  toggleUserType,
  toggleCountry,
  setWatchListOnly,
  toggleGroupFilter,
}: ActiveFilterBarProps) {
  const chips: { key: string; label: string; onRemove: () => void }[] = []

  if (filters.nameSearch) {
    chips.push({ key: 'name', label: `name: ${filters.nameSearch}`, onRemove: () => setNameSearch('') })
  }
  for (const oc of filters.orbitClasses) {
    chips.push({ key: `orbit-${oc}`, label: oc, onRemove: () => toggleOrbitClass(oc) })
  }
  for (const band of filters.inclinationBands) {
    chips.push({ key: `incl-${band}`, label: INCLINATION_LABELS[band] ?? band, onRemove: () => toggleInclinationBand(band) })
  }
  for (const band of filters.tleAgeBands) {
    chips.push({ key: `tle-${band}`, label: band.charAt(0) + band.slice(1).toLowerCase(), onRemove: () => toggleTleAgeBand(band) })
  }
  for (const p of filters.purposes) {
    chips.push({ key: `purpose-${p}`, label: PURPOSE_LABELS[p] ?? p, onRemove: () => togglePurpose(p) })
  }
  for (const ut of filters.userTypes) {
    chips.push({ key: `ut-${ut}`, label: ut.charAt(0) + ut.slice(1).toLowerCase(), onRemove: () => toggleUserType(ut) })
  }
  for (const code of filters.countries) {
    chips.push({ key: `country-${code}`, label: countryName(code), onRemove: () => toggleCountry(code) })
  }
  if (filters.watchListOnly) {
    chips.push({ key: 'watchlist', label: 'Watch List', onRemove: () => setWatchListOnly(false) })
  }
  for (const id of selectedGroupIds) {
    const grp = constellationGroups.find((g) => g.id === id)
    chips.push({ key: `grp-${id}`, label: grp?.name ?? id, onRemove: () => toggleGroupFilter(id) })
  }

  if (chips.length === 0) return null

  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-space-700/50 bg-space-800/60">
      <div className="flex items-center gap-1.5 overflow-x-auto flex-1 min-w-0 scrollbar-none">
        {chips.map((c) => (
          <FilterChip key={c.key} label={c.label} onRemove={c.onRemove} />
        ))}
      </div>
      <button
        onClick={clearFilters}
        className="flex-shrink-0 text-xs px-2 py-0.5 rounded border border-red-500/50 text-red-400 bg-red-500/10 hover:bg-red-500/20 hover:border-red-400 hover:text-red-300 transition-colors"
        title="Clear all filters"
      >
        Clear all
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type SectionKey = 'missionType' | 'operator' | 'orbit' | 'inclination' | 'tleAge' | 'groups' | 'country'

const ORBIT_COLORS: Record<OrbitClass, string> = {
  LEO: 'text-cyan-400 border-cyan-500/40',
  MEO: 'text-amber-400 border-amber-500/40',
  GEO: 'text-emerald-400 border-emerald-500/40',
  HEO: 'text-orange-400 border-orange-500/40',
  UNKNOWN: 'text-slate-400 border-slate-600',
}

export default function FilterPanel({ embedded = false }: { embedded?: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  const [countrySearch, setCountrySearch] = useState('')
  const [sections, setSections] = useState<Record<SectionKey, boolean>>({
    missionType: true, operator: true, orbit: true, inclination: false, tleAge: false, groups: true, country: false,
  })

  const allSatellites  = useSatelliteStore((s) => s.allSatellites)
  const dataInfo       = useSatelliteStore((s) => s.dataInfo)
  const filters        = useSatelliteStore((s) => s.filters)
  const renderedCount  = useSatelliteStore((s) => s.positions.length)
  const toggleCountry        = useSatelliteStore((s) => s.toggleCountry)
  const toggleOrbitClass     = useSatelliteStore((s) => s.toggleOrbitClass)
  const toggleUserType       = useSatelliteStore((s) => s.toggleUserType)
  const togglePurpose        = useSatelliteStore((s) => s.togglePurpose)
  const setNameSearch        = useSatelliteStore((s) => s.setNameSearch)
  const clearFilters         = useSatelliteStore((s) => s.clearFilters)
  const constellationGroups  = useSatelliteStore((s) => s.constellationGroups)
  const selectedGroupIds     = useSatelliteStore((s) => s.selectedGroupIds)
  const toggleGroupFilter      = useSatelliteStore((s) => s.toggleGroupFilter)
  const toggleInclinationBand  = useSatelliteStore((s) => s.toggleInclinationBand)
  const toggleTleAgeBand       = useSatelliteStore((s) => s.toggleTleAgeBand)
  const setWatchListOnly       = useSatelliteStore((s) => s.setWatchListOnly)
  const watchList              = useSatelliteStore((s) => s.watchList)

  const countries = useMemo(() => getCountries(allSatellites), [allSatellites])

  const filteredCountries = useMemo(() => {
    const q = countrySearch.toLowerCase()
    if (!q) return []
    return countries.filter(
      (c) => c.code.toLowerCase().includes(q) || countryName(c.code).toLowerCase().includes(q),
    )
  }, [countries, countrySearch])

  // Live filtered count before propagation (three-part label)
  const filteredCount = useMemo(
    () => applyFilters(allSatellites, filters).length,
    [allSatellites, filters],
  )

  // Presence flags for optional sections (hide when no data)
  const hasUserType = useMemo(() => allSatellites.some((s) => s.userType !== null),  [allSatellites])
  const hasPurpose  = useMemo(() => allSatellites.some((s) => s.purpose !== null),   [allSatellites])

  const toggleSection = (key: SectionKey) =>
    setSections((s) => ({ ...s, [key]: !s[key] }))

  const hasFilters =
    filters.nameSearch.length > 0 ||
    filters.countries.size > 0 ||
    filters.orbitClasses.size > 0 ||
    filters.inclinationBands.size > 0 ||
    filters.userTypes.size > 0 ||
    filters.purposes.size > 0 ||
    filters.tleAgeBands.size > 0 ||
    filters.watchListOnly ||
    selectedGroupIds.size > 0

  const isSampleData = dataInfo.fetchedAt === null

  // ── Count label ──────────────────────────────────────────────────────────
  const countLabel = isSampleData ? null : (
    <div className="text-xs text-slate-500">
      <span className="text-slate-300">{dataInfo.count.toLocaleString()}</span> total
      {filteredCount > 0 && (
        <> · <span className="text-cyan-400">{filteredCount.toLocaleString()} filtered</span></>
      )}
      {renderedCount > 0 && (
        <> · <span className="text-slate-400">{renderedCount.toLocaleString()} shown</span></>
      )}
      {filteredCount === 0 && filters.nameSearch.length === 0 && filters.countries.size === 0 && (
        <span> · select a filter to start</span>
      )}
    </div>
  )

  // ── Shared section list ───────────────────────────────────────────────────
  const sectionContent = (
    <>
      {/* Name / wildcard search */}
      <div className="px-4 py-2 border-b border-space-700/50">
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest block mb-1">
          Search by name
        </label>
        <div className="relative">
          <input
            type="text"
            placeholder="e.g. STARLINK* or *spy or ISS"
            value={filters.nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            className="w-full bg-space-800 border border-space-700 rounded px-2 py-1 pr-6 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
          />
          {filters.nameSearch && (
            <button
              onClick={() => setNameSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors text-sm leading-none"
              title="Clear"
            >×</button>
          )}
        </div>
        {filters.nameSearch && (
          <div className="text-[10px] text-slate-600 mt-1">
            * = any characters · {filteredCount.toLocaleString()} match{filteredCount !== 1 ? 'es' : ''}
          </div>
        )}
      </div>

      {/* Orbit */}
      <div className="border-b border-space-700/50">
        <SectionHeader
          label={`Orbit${filters.orbitClasses.size > 0 ? ` (${filters.orbitClasses.size})` : ''}`}
          open={sections.orbit}
          onToggle={() => toggleSection('orbit')}
        />
        {sections.orbit && (
          <div className="px-4 pb-3 grid grid-cols-2 gap-1.5">
            {(['LEO', 'MEO', 'GEO', 'HEO'] as OrbitClass[]).map((oc) => (
              <Chip key={oc} label={oc} active={filters.orbitClasses.has(oc)} color={ORBIT_COLORS[oc]} onClick={() => toggleOrbitClass(oc)} />
            ))}
          </div>
        )}
      </div>

      {/* Inclination Band */}
      <div className="border-b border-space-700/50">
        <SectionHeader
          label={`Inclination${filters.inclinationBands.size > 0 ? ` (${filters.inclinationBands.size})` : ''}`}
          open={sections.inclination}
          onToggle={() => toggleSection('inclination')}
        />
        {sections.inclination && (
          <div className="px-4 pb-3 grid grid-cols-2 gap-1.5">
            {(Object.entries(INCLINATION_LABELS) as [InclinationBand, string][]).map(([val, label]) => (
              <Chip key={val} label={label} active={filters.inclinationBands.has(val)} onClick={() => toggleInclinationBand(val)} />
            ))}
          </div>
        )}
      </div>

      {/* TLE Age */}
      <div className="border-b border-space-700/50">
        <SectionHeader
          label={`TLE Age${filters.tleAgeBands.size > 0 ? ` (${filters.tleAgeBands.size})` : ''}`}
          open={sections.tleAge}
          onToggle={() => toggleSection('tleAge')}
        />
        {sections.tleAge && (
          <div className="px-4 pb-3 grid grid-cols-3 gap-1.5">
            {([
              { val: 'FRESH', label: 'Fresh',  color: 'text-emerald-400 border-emerald-500/40' },
              { val: 'AGING', label: 'Aging',  color: 'text-amber-400 border-amber-500/40' },
              { val: 'STALE', label: 'Stale',  color: 'text-red-400 border-red-500/40' },
            ] as { val: TleAgeBand; label: string; color: string }[]).map(({ val, label, color }) => (
              <Chip key={val} label={label} color={color} active={filters.tleAgeBands.has(val)} onClick={() => toggleTleAgeBand(val)} />
            ))}
          </div>
        )}
      </div>

      {/* Mission Type (Purpose) */}
      {hasPurpose && (
        <div className="border-b border-space-700/50">
          <SectionHeader
            label={`Mission Type${filters.purposes.size > 0 ? ` (${filters.purposes.size})` : ''}`}
            open={sections.missionType}
            onToggle={() => toggleSection('missionType')}
          />
          {sections.missionType && (
            <div className="px-4 pb-3 grid grid-cols-2 gap-1.5">
              {(Object.entries(PURPOSE_LABELS) as [SatellitePurpose, string][]).map(([val, label]) => (
                <Chip key={val} label={label} active={filters.purposes.has(val)} onClick={() => togglePurpose(val)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Operator (User Type) */}
      {hasUserType && (
        <div className="border-b border-space-700/50">
          <SectionHeader
            label={`Operator${filters.userTypes.size > 0 ? ` (${filters.userTypes.size})` : ''}`}
            open={sections.operator}
            onToggle={() => toggleSection('operator')}
          />
          {sections.operator && (
            <div className="px-4 pb-3 grid grid-cols-2 gap-1.5">
              {(['CIVIL', 'COMMERCIAL', 'GOVERNMENT', 'MILITARY', 'MIXED'] as SatelliteUserType[]).map((ut) => (
                <Chip key={ut} label={ut} active={filters.userTypes.has(ut)} onClick={() => toggleUserType(ut)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Watch List Only */}
      {watchList.size > 0 && (
        <div className="border-b border-space-700/50 px-4 py-2">
          <button
            onClick={() => setWatchListOnly(!filters.watchListOnly)}
            className={`flex items-center gap-2 text-xs transition-colors w-full text-left
              ${filters.watchListOnly ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <span>{filters.watchListOnly ? '★' : '☆'}</span>
            <span>Watch List Only</span>
            <span className="ml-auto text-slate-600">{watchList.size}</span>
          </button>
        </div>
      )}

      {/* Groups */}
      {constellationGroups.length > 0 && (
        <div className="border-b border-space-700/50">
          <SectionHeader
            label={`Groups${selectedGroupIds.size > 0 ? ` (${selectedGroupIds.size})` : ''}`}
            open={sections.groups}
            onToggle={() => toggleSection('groups')}
          />
          {sections.groups && (
            <div className="px-4 pb-3 flex flex-col gap-1.5">
              {constellationGroups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => toggleGroupFilter(g.id)}
                  className={`
                    flex items-center gap-1.5 px-2 py-1 rounded text-xs border transition-colors text-left
                    ${selectedGroupIds.has(g.id)
                      ? 'border-current bg-current/10'
                      : 'border-space-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'}
                  `}
                  style={selectedGroupIds.has(g.id) ? { color: g.color, borderColor: g.color } : {}}
                >
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: g.color }} />
                  <span>{g.name}</span>
                  <span className="text-slate-600 text-xs ml-auto pl-1">{g.noradIds.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Country — search-first */}
      <div>
        <SectionHeader
          label={`Country${filters.countries.size > 0 ? ` (${filters.countries.size})` : ''}`}
          open={sections.country}
          onToggle={() => toggleSection('country')}
        />
        {sections.country && (
          <>
            {/* Selected countries — always visible when any are active */}
            {filters.countries.size > 0 && (
              <div className="px-4 pb-2 flex flex-col gap-1">
                {Array.from(filters.countries).map((code) => {
                  const entry = countries.find((c) => c.code === code)
                  return (
                    <Chip
                      key={code}
                      label={countryName(code)}
                      active={true}
                      count={entry?.count}
                      onClick={() => toggleCountry(code)}
                    />
                  )
                })}
              </div>
            )}

            {/* Search input */}
            <div className="px-4 pb-2">
              <input
                type="text"
                placeholder="Type to search countries…"
                value={countrySearch}
                onChange={(e) => setCountrySearch(e.target.value)}
                className="w-full bg-space-800 border border-space-700 rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
              />
            </div>

            {/* Search results — only when typing */}
            {countrySearch.length > 0 && (
              <div className="px-4 pb-3 flex flex-col gap-1 max-h-48 overflow-y-auto">
                {filteredCountries.length === 0 && (
                  <span className="text-xs text-slate-600">No matches</span>
                )}
                {filteredCountries.map(({ code, count }) => (
                  <Chip
                    key={code}
                    label={countryName(code)}
                    active={filters.countries.has(code)}
                    count={count}
                    onClick={() => toggleCountry(code)}
                  />
                ))}
              </div>
            )}

            {filters.countries.size === 0 && countrySearch.length === 0 && (
              <div className="px-4 pb-3 text-[10px] text-slate-600">
                Type a country name to search
              </div>
            )}
          </>
        )}
      </div>
    </>
  )

  if (embedded) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <ActiveFilterBar
          filters={filters}
          selectedGroupIds={selectedGroupIds}
          constellationGroups={constellationGroups}
          clearFilters={clearFilters}
          setNameSearch={setNameSearch}
          toggleOrbitClass={toggleOrbitClass}
          toggleInclinationBand={toggleInclinationBand}
          toggleTleAgeBand={toggleTleAgeBand}
          togglePurpose={togglePurpose}
          toggleUserType={toggleUserType}
          toggleCountry={toggleCountry}
          setWatchListOnly={setWatchListOnly}
          toggleGroupFilter={toggleGroupFilter}
        />
        <div className="overflow-y-auto flex-col flex flex-1 min-h-0">
          {isSampleData && (
            <div className="px-4 py-2 border-b border-space-700/50 text-xs text-amber-400/80">
              Sample data — run{' '}
              <code className="text-amber-300 font-mono">npm run fetch-tles</code>{' '}
              for full catalog
            </div>
          )}

          {sectionContent}

          {renderedCount > 0 && (
            <div className="px-4 py-2 border-t border-space-700/50 text-xs text-slate-600">
              {renderedCount.toLocaleString()} rendered
              {renderedCount >= filters.maxRendered && (
                <span className="text-amber-500/70"> (capped at {filters.maxRendered.toLocaleString()})</span>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="w-72 flex flex-col flex-1 min-h-0 bg-space-900/90 backdrop-blur-sm border border-space-700 rounded-lg shadow-2xl text-white">
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0">
        <span className="text-sm font-semibold tracking-wide text-white flex-1">FILTERS</span>
        {collapsed && hasFilters && (
          <span className="text-xs text-cyan-400 font-mono">active</span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand filter panel' : 'Collapse filter panel'}
          className="text-slate-400 hover:text-white transition-colors text-sm"
        >
          {collapsed ? '▸' : '▾'}
        </button>
      </div>
      {!collapsed && <div className="border-t border-space-700" />}

      {!collapsed && (
        <ActiveFilterBar
          filters={filters}
          selectedGroupIds={selectedGroupIds}
          constellationGroups={constellationGroups}
          clearFilters={clearFilters}
          setNameSearch={setNameSearch}
          toggleOrbitClass={toggleOrbitClass}
          toggleInclinationBand={toggleInclinationBand}
          toggleTleAgeBand={toggleTleAgeBand}
          togglePurpose={togglePurpose}
          toggleUserType={toggleUserType}
          toggleCountry={toggleCountry}
          setWatchListOnly={setWatchListOnly}
          toggleGroupFilter={toggleGroupFilter}
        />
      )}

      {!collapsed && (
        <div className="overflow-y-auto flex-col flex flex-1 min-h-0">
          <div className="px-4 py-2 border-b border-space-700/50">
            {isSampleData ? (
              <div className="text-xs text-amber-400/80">
                Sample data — run{' '}
                <code className="text-amber-300 font-mono">npm run fetch-tles</code>{' '}
                for full catalog
              </div>
            ) : countLabel}
          </div>

          {sectionContent}

          {renderedCount > 0 && (
            <div className="px-4 py-2 border-t border-space-700/50 text-xs text-slate-600">
              {renderedCount.toLocaleString()} rendered
              {renderedCount >= filters.maxRendered && (
                <span className="text-amber-500/70"> (capped at {filters.maxRendered.toLocaleString()})</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
