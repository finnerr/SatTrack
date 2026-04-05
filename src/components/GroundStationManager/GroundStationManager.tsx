import { useState, useEffect } from 'react'
import { useSatelliteStore } from '../../store/useSatelliteStore'
import type { GroundStation } from '../../types/satellite'

// ── Sub-components ─────────────────────────────────────────────────────────────

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

// ── Station form ──────────────────────────────────────────────────────────────

interface StationFormValues {
  name: string
  lat: string
  lon: string
  elevationM: string
  maskDeg: string
}

const EMPTY_FORM: StationFormValues = {
  name: '', lat: '', lon: '', elevationM: '0', maskDeg: '0',
}

const PRESET_STATIONS: Omit<GroundStation, 'id'>[] = [
  { name: 'New York',   lat:  40.713, lon:  -74.006, elevationM:   10, maskDeg: 0, visible: true },
  { name: 'London',     lat:  51.507, lon:   -0.128, elevationM:   11, maskDeg: 0, visible: true },
  { name: 'Tokyo',      lat:  35.689, lon:  139.692, elevationM:   40, maskDeg: 0, visible: true },
  { name: 'Sydney',     lat: -33.869, lon:  151.209, elevationM:   58, maskDeg: 0, visible: true },
  { name: 'São Paulo',  lat: -23.550, lon:  -46.633, elevationM:  760, maskDeg: 0, visible: true },
]

function stationToForm(gs: GroundStation): StationFormValues {
  return {
    name:       gs.name,
    lat:        String(gs.lat),
    lon:        String(gs.lon),
    elevationM: String(gs.elevationM),
    maskDeg:    String(gs.maskDeg ?? 0),
  }
}

function validateForm(f: StationFormValues): string | null {
  if (!f.name.trim()) return 'Name is required'
  const lat  = parseFloat(f.lat)
  const lon  = parseFloat(f.lon)
  const elev = parseFloat(f.elevationM)
  const mask = parseFloat(f.maskDeg)
  if (isNaN(lat)  || lat < -90  || lat > 90)    return 'Latitude must be −90 to 90'
  if (isNaN(lon)  || lon < -180 || lon > 180)    return 'Longitude must be −180 to 180'
  if (isNaN(elev) || elev < -500 || elev > 9000) return 'Elevation must be −500 to 9000 m'
  if (isNaN(mask) || mask < 0   || mask > 30)    return 'Mask must be 0–30°'
  return null
}

interface StationFormProps {
  initial?: GroundStation
  onSave: (values: Omit<GroundStation, 'id'>) => void
  onCancel: () => void
}

function StationForm({ initial, onSave, onCancel }: StationFormProps) {
  const [form, setForm]   = useState<StationFormValues>(initial ? stationToForm(initial) : EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  const pickingLocation = useSatelliteStore((s) => s.pickingLocation)
  const pickedLocation  = useSatelliteStore((s) => s.pickedLocation)
  const setPickingLocation = useSatelliteStore((s) => s.setPickingLocation)
  const setPickedLocation  = useSatelliteStore((s) => s.setPickedLocation)

  // Auto-fill lat/lon when user picks a location on the map
  useEffect(() => {
    if (pickedLocation) {
      setForm((f) => ({
        ...f,
        lat: pickedLocation.lat.toFixed(5),
        lon: pickedLocation.lon.toFixed(5),
      }))
      setError(null)
    }
  }, [pickedLocation])

  const field = (key: keyof StationFormValues) => ({
    value:    form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }))
      setError(null)
    },
  })

  const handleSave = () => {
    const err = validateForm(form)
    if (err) { setError(err); return }
    setPickedLocation(null)
    onSave({
      name:       form.name.trim(),
      lat:        parseFloat(form.lat),
      lon:        parseFloat(form.lon),
      elevationM: parseFloat(form.elevationM),
      maskDeg:    parseFloat(form.maskDeg) || 0,
      visible:    initial?.visible ?? true,
    })
  }

  const handleCancel = () => {
    setPickingLocation(false)
    setPickedLocation(null)
    onCancel()
  }

  const handlePickOnMap = () => {
    setPickingLocation(true)
  }

  const inputCls = `
    w-full bg-space-800 border border-space-700 rounded px-2 py-1
    text-xs text-white placeholder-slate-600
    focus:outline-none focus:border-cyan-500/50
  `

  return (
    <div className="px-4 pb-3 flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 uppercase tracking-wide">Name</label>
        <input type="text" placeholder="Station Alpha" className={inputCls} {...field('name')} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 uppercase tracking-wide">Lat °</label>
          <input type="number" step="any" min="-90" max="90" placeholder="38.8977" className={inputCls} {...field('lat')} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 uppercase tracking-wide">Lon °</label>
          <input type="number" step="any" min="-180" max="180" placeholder="-77.0366" className={inputCls} {...field('lon')} />
        </div>
      </div>

      <button
        onClick={handlePickOnMap}
        disabled={pickingLocation}
        className={`
          text-xs py-1 rounded border transition-colors
          ${pickingLocation
            ? 'border-amber-500/50 bg-amber-500/10 text-amber-400 cursor-wait'
            : 'border-space-700 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/40'}
        `}
      >
        {pickingLocation ? 'Click globe to place…' : '⊕ Pick on Map'}
      </button>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 uppercase tracking-wide">Elevation (m)</label>
          <input type="number" step="1" placeholder="0" className={inputCls} {...field('elevationM')} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 uppercase tracking-wide">Mask °</label>
          <input type="number" step="1" min="0" max="30" placeholder="0" className={inputCls} {...field('maskDeg')} />
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          className="flex-1 text-xs py-1 rounded border border-cyan-500/50 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
        >
          {initial ? 'Update' : 'Add Station'}
        </button>
        <button
          onClick={handleCancel}
          className="text-xs px-3 py-1 rounded border border-space-700 text-slate-500 hover:text-slate-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Station row ───────────────────────────────────────────────────────────────

interface StationRowProps {
  station: GroundStation
  isSelected: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleVisible: () => void
}

function StationRow({ station, isSelected, onSelect, onEdit, onDelete, onToggleVisible }: StationRowProps) {
  return (
    <div
      className={`
        flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-colors group
        ${isSelected
          ? 'bg-emerald-500/10 border border-emerald-500/30'
          : 'hover:bg-space-800 border border-transparent'}
      `}
      onClick={onSelect}
    >
      {/* Visibility dot */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleVisible() }}
        aria-label={station.visible ? 'Hide station' : 'Show station'}
        className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${
          station.visible ? 'bg-emerald-400' : 'bg-slate-600'
        }`}
      />

      {/* Name + coords */}
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-medium truncate ${isSelected ? 'text-emerald-300' : 'text-white'}`}>
          {station.name}
        </div>
        <div className="text-[10px] font-mono text-slate-500">
          {station.lat.toFixed(3)}°, {station.lon.toFixed(3)}°
          {station.elevationM !== 0 && ` · ${station.elevationM}m`}
        </div>
      </div>

      {/* Actions — only visible on hover or when selected */}
      <div className={`flex items-center gap-1 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          aria-label="Edit station"
          className="text-slate-500 hover:text-slate-300 transition-colors text-xs px-1"
        >
          ✎
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          aria-label="Delete station"
          className="text-slate-500 hover:text-red-400 transition-colors text-xs px-1"
        >
          ×
        </button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function GroundStationManager({ embedded = false }: { embedded?: boolean }) {
  const [collapsed,   setCollapsed]   = useState(false)
  const [showAdd,     setShowAdd]     = useState(false)
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [listOpen,    setListOpen]    = useState(true)

  const groundStations     = useSatelliteStore((s) => s.groundStations)
  const selectedStationIds = useSatelliteStore((s) => s.selectedStationIds)
  const addGroundStation   = useSatelliteStore((s) => s.addGroundStation)
  const updateGroundStation = useSatelliteStore((s) => s.updateGroundStation)
  const deleteGroundStation = useSatelliteStore((s) => s.deleteGroundStation)
  const toggleStationVisible = useSatelliteStore((s) => s.toggleStationVisible)
  const setSelectedStation  = useSatelliteStore((s) => s.setSelectedStation)

  const handleAdd = (values: Omit<GroundStation, 'id'>) => {
    addGroundStation(values)
    setShowAdd(false)
  }

  const handleUpdate = (values: Omit<GroundStation, 'id'>) => {
    if (editingId) {
      updateGroundStation(editingId, values)
      setEditingId(null)
    }
  }

  const handleDelete = (id: string) => {
    deleteGroundStation(id)
    if (editingId === id) setEditingId(null)
  }

  const handleSelect = (id: string) => {
    setSelectedStation(id)
  }

  // ── Embedded mode (inside RightDrawer) ──────────────────────────────────────
  if (embedded) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Add button */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-space-700/50 flex-shrink-0">
          <button
            onClick={() => { setShowAdd((v) => !v); setEditingId(null) }}
            className="text-xs text-slate-400 hover:text-emerald-400 transition-colors"
          >
            + Add station
          </button>
          {groundStations.length > 0 && (
            <span className="ml-auto text-xs text-slate-600">{groundStations.length} station{groundStations.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="overflow-y-auto flex-1 flex flex-col">
          {showAdd && !editingId && (
            <div className="border-b border-space-700/50 pt-2">
              <StationForm onSave={handleAdd} onCancel={() => setShowAdd(false)} />
            </div>
          )}
          {groundStations.length > 0 ? (
            <div className="px-1 py-1 flex flex-col gap-0.5">
              {groundStations.map((gs) =>
                editingId === gs.id ? (
                  <div key={gs.id} className="pt-1">
                    <StationForm initial={gs} onSave={handleUpdate} onCancel={() => setEditingId(null)} />
                  </div>
                ) : (
                  <StationRow
                    key={gs.id}
                    station={gs}
                    isSelected={selectedStationIds.includes(gs.id)}
                    onSelect={() => handleSelect(gs.id)}
                    onEdit={() => { setEditingId(gs.id); setShowAdd(false) }}
                    onDelete={() => handleDelete(gs.id)}
                    onToggleVisible={() => toggleStationVisible(gs.id)}
                  />
                )
              )}
            </div>
          ) : !showAdd && (
            <div className="px-4 pt-5 pb-3 flex flex-col gap-3">
              <p className="text-xs text-slate-500 text-center">No ground stations defined.</p>
              <div>
                <p className="text-[10px] text-slate-600 uppercase tracking-wide mb-1.5">Quick add</p>
                <div className="flex flex-col gap-1">
                  {PRESET_STATIONS.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => { addGroundStation(preset); setShowAdd(false) }}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded border border-space-700 text-xs text-slate-400 hover:text-emerald-400 hover:border-emerald-700/50 transition-colors"
                    >
                      <span>{preset.name}</span>
                      <span className="text-[10px] font-mono text-slate-600">
                        {preset.lat.toFixed(1)}°, {preset.lon.toFixed(1)}°
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setShowAdd(true)}
                className="text-xs text-slate-500 hover:text-emerald-400 transition-colors text-center"
              >
                + Add custom station
              </button>
            </div>
          )}
          {selectedStationIds.length > 0 && (() => {
            const names = selectedStationIds
              .map((id) => groundStations.find((s) => s.id === id)?.name)
              .filter(Boolean)
              .join(' & ')
            return (
              <div className="px-4 py-2 text-xs text-slate-500 border-t border-space-700/50 mt-auto">
                <span className="text-emerald-400">{names}</span> selected
                {' · '}click a satellite to compute passes
              </div>
            )
          })()}
        </div>
      </div>
    )
  }

  // ── Standalone mode (floating panel) ────────────────────────────────────────
  return (
    <div className="w-72 flex flex-col flex-shrink-0 bg-space-900/90 backdrop-blur-sm border border-space-700 rounded-lg shadow-2xl text-white">
      {/* Header — always visible */}
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0">
        <span className="text-sm font-semibold tracking-wide text-white flex-1">GROUND STATIONS</span>
        {collapsed && groundStations.length > 0 && (
          <span className="text-xs text-emerald-400 font-mono">
            {groundStations.length}
          </span>
        )}
        {!collapsed && (
          <button
            onClick={() => { setShowAdd((v) => !v); setEditingId(null) }}
            aria-label="Add ground station"
            className="text-slate-400 hover:text-emerald-400 transition-colors text-base leading-none"
            title="Add station"
          >
            +
          </button>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand ground stations' : 'Collapse ground stations'}
          className="text-slate-400 hover:text-white transition-colors text-sm"
        >
          {collapsed ? '▸' : '▾'}
        </button>
      </div>
      {!collapsed && <div className="border-t border-space-700" />}

      {!collapsed && (
        <div className="overflow-y-auto flex-col flex" style={{ maxHeight: 'calc(100vh - 220px)' }}>

          {/* Add form */}
          {showAdd && !editingId && (
            <div className="border-b border-space-700/50 pt-2">
              <StationForm
                onSave={handleAdd}
                onCancel={() => setShowAdd(false)}
              />
            </div>
          )}

          {/* Station list */}
          {groundStations.length > 0 ? (
            <div className="border-b border-space-700/50">
              <SectionHeader
                label={`Stations (${groundStations.length})`}
                open={listOpen}
                onToggle={() => setListOpen((v) => !v)}
              />
              {listOpen && (
                <div className="px-1 pb-2 flex flex-col gap-0.5">
                  {groundStations.map((gs) =>
                    editingId === gs.id ? (
                      <div key={gs.id} className="pt-1">
                        <StationForm
                          initial={gs}
                          onSave={handleUpdate}
                          onCancel={() => setEditingId(null)}
                        />
                      </div>
                    ) : (
                      <StationRow
                        key={gs.id}
                        station={gs}
                        isSelected={selectedStationIds.includes(gs.id)}
                        onSelect={() => handleSelect(gs.id)}
                        onEdit={() => { setEditingId(gs.id); setShowAdd(false) }}
                        onDelete={() => handleDelete(gs.id)}
                        onToggleVisible={() => toggleStationVisible(gs.id)}
                      />
                    )
                  )}
                </div>
              )}
            </div>
          ) : !showAdd && (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-slate-500">No ground stations defined.</p>
              <button
                onClick={() => setShowAdd(true)}
                className="mt-2 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                + Add your first station
              </button>
            </div>
          )}

          {/* Selected station summary */}
          {selectedStationIds.length > 0 && (() => {
            const names = selectedStationIds
              .map((id) => groundStations.find((s) => s.id === id)?.name)
              .filter(Boolean)
              .join(' & ')
            return (
              <div className="px-4 py-2 text-xs text-slate-500">
                <span className="text-emerald-400">{names}</span> selected
                {' · '}click a satellite to compute passes
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
