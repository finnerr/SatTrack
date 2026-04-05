import { useState, useMemo } from 'react'
import { useSatelliteStore } from '../../store/useSatelliteStore'
import { matchesGlob } from '../../utils/searchUtils'

const PRESET_COLORS = [
  '#06b6d4', '#22c55e', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
]

// ── Group form ─────────────────────────────────────────────────────────────────

interface GroupFormProps {
  onSave: (name: string, color: string) => void
  onCancel: () => void
}

function GroupForm({ onSave, onCancel }: GroupFormProps) {
  const [name,  setName]  = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [error, setError] = useState<string | null>(null)

  const handleSave = () => {
    if (!name.trim()) { setError('Name required'); return }
    onSave(name.trim(), color)
  }

  const inputCls = `
    w-full bg-space-800 border border-space-700 rounded px-2 py-1
    text-xs text-white placeholder-slate-600
    focus:outline-none focus:border-cyan-500/50
  `

  return (
    <div className="px-4 pb-3 flex flex-col gap-2 pt-2 border-b border-space-700/50">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 uppercase tracking-wide">Name</label>
        <input
          type="text"
          placeholder="Starlink Shell 1"
          className={inputCls}
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null) }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 uppercase tracking-wide">Color</label>
        <div className="flex gap-1.5 flex-wrap">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full border-2 transition-all ${
                color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'
              }`}
              style={{ background: c }}
              title={c}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-5 h-5 rounded cursor-pointer bg-transparent border-0"
            title="Custom color"
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          className="flex-1 text-xs py-1 rounded border border-cyan-500/50 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
        >
          Create Group
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1 rounded border border-space-700 text-slate-500 hover:text-slate-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Satellite search within group editor ──────────────────────────────────────

interface MemberEditorProps {
  groupId: string
  onClose: () => void
}

function MemberEditor({ groupId, onClose }: MemberEditorProps) {
  const [search, setSearch]           = useState('')
  const [editingMeta, setEditingMeta] = useState(false)
  const [nameInput, setNameInput]     = useState('')
  const [colorInput, setColorInput]   = useState('')
  const allSatellites = useSatelliteStore((s) => s.allSatellites)
  const groups        = useSatelliteStore((s) => s.constellationGroups)
  const updateGroup   = useSatelliteStore((s) => s.updateGroup)

  const group = groups.find((g) => g.id === groupId)
  if (!group) return null

  const memberSet = new Set(group.noradIds)

  // Map for fast name lookup
  const satNameMap = useMemo(() => {
    const m = new Map<string, string>()
    allSatellites.forEach((s) => m.set(s.noradId, s.name))
    return m
  }, [allSatellites])

  // Search results — excludes existing members, supports * wildcards
  const searchResults = useMemo(() => {
    const q = search.trim()
    if (q.length < 2) return []
    return allSatellites
      .filter((s) => !memberSet.has(s.noradId) && (matchesGlob(s.name, q) || s.noradId === q))
      .slice(0, 20)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, allSatellites, group.noradIds])

  const removeMember = (noradId: string) =>
    updateGroup(groupId, { noradIds: group.noradIds.filter((id) => id !== noradId) })

  const addMember = (noradId: string) => {
    updateGroup(groupId, { noradIds: [...group.noradIds, noradId] })
    setSearch('')
  }

  const startEditMeta = () => { setNameInput(group.name); setColorInput(group.color); setEditingMeta(true) }
  const saveMeta = () => {
    if (nameInput.trim()) updateGroup(groupId, { name: nameInput.trim(), color: colorInput })
    setEditingMeta(false)
  }

  return (
    <div className="flex flex-col border-b border-space-700/50">
      {/* Header: name / rename */}
      {editingMeta ? (
        <div className="px-4 py-2 flex flex-col gap-2 border-b border-space-700/50">
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveMeta(); if (e.key === 'Escape') setEditingMeta(false) }}
            autoFocus
            className="w-full bg-space-800 border border-space-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-cyan-500/50"
          />
          <div className="flex items-center gap-1.5 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button key={c} onClick={() => setColorInput(c)}
                className={`w-4 h-4 rounded-full border-2 transition-all ${colorInput === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                style={{ background: c }} />
            ))}
            <input type="color" value={colorInput} onChange={(e) => setColorInput(e.target.value)} className="w-4 h-4 rounded cursor-pointer bg-transparent border-0" />
          </div>
          <div className="flex gap-2">
            <button onClick={saveMeta} className="flex-1 text-xs py-0.5 rounded border border-cyan-500/50 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors">Save</button>
            <button onClick={() => setEditingMeta(false)} className="text-xs px-3 py-0.5 rounded border border-space-700 text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-space-700/50">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: group.color }} />
          <span className="text-xs text-white font-medium flex-1 truncate">
            {group.name}
            <span className="text-slate-500 ml-1.5 text-[10px]">{group.noradIds.length} members</span>
          </span>
          <button onClick={startEditMeta} className="text-slate-500 hover:text-slate-300 transition-colors text-xs" title="Rename / recolor">✎</button>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-sm leading-none">×</button>
        </div>
      )}

      {/* Current members list */}
      <div className="flex flex-col">
        <div className="px-4 pt-2 pb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Members</span>
          {group.noradIds.length > 0 && (
            <button
              onClick={() => updateGroup(groupId, { noradIds: [] })}
              className="text-[10px] text-slate-600 hover:text-red-400 transition-colors"
            >
              clear all
            </button>
          )}
        </div>
        {group.noradIds.length === 0 ? (
          <div className="px-4 pb-2 text-[10px] text-slate-600">No satellites yet — search below to add</div>
        ) : (
          <div className="max-h-52 overflow-y-auto">
            {group.noradIds.map((id) => (
              <div key={id} className="flex items-center gap-2 px-4 py-1.5 hover:bg-space-800/50 group/row transition-colors">
                <span className="flex-1 text-xs font-mono text-slate-300 truncate">
                  {satNameMap.get(id) ?? id}
                </span>
                <span className="text-[10px] text-slate-600 font-mono flex-shrink-0">{id}</span>
                <button
                  onClick={() => removeMember(id)}
                  className="text-slate-700 hover:text-red-400 transition-colors text-xs flex-shrink-0 opacity-0 group-hover/row:opacity-100"
                  title="Remove from group"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add satellites */}
      <div className="px-4 pt-2 pb-3 border-t border-space-700/50">
        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Add Satellites</div>
        <input
          type="text"
          placeholder="Search name or NORAD ID… (supports BEID*)"
          value={search}
          autoFocus
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-space-800 border border-space-700 rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
        />
        {search.trim().length >= 2 && searchResults.length === 0 && (
          <div className="mt-1 text-[10px] text-slate-600">No matches outside group</div>
        )}
        {searchResults.length > 0 && (
          <div className="mt-1 flex flex-col border border-space-700 rounded overflow-hidden max-h-40 overflow-y-auto">
            {searchResults.map((s) => (
              <button
                key={s.noradId}
                onClick={() => addMember(s.noradId)}
                className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-space-800 transition-colors text-left"
              >
                <span className="flex-1 font-mono text-slate-300 truncate">{s.name}</span>
                <span className="text-slate-600 font-mono text-[10px] flex-shrink-0">{s.noradId}</span>
                <span className="text-cyan-500 text-[10px] flex-shrink-0 font-bold">+</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ConstellationManager({ embedded = false }: { embedded?: boolean }) {
  const [showAdd,    setShowAdd]    = useState(false)
  const [editingId,  setEditingId]  = useState<string | null>(null)

  const groups          = useSatelliteStore((s) => s.constellationGroups)
  const selectedGroupIds = useSatelliteStore((s) => s.selectedGroupIds)
  const addGroup        = useSatelliteStore((s) => s.addGroup)
  const deleteGroup     = useSatelliteStore((s) => s.deleteGroup)
  const toggleGroupFilter = useSatelliteStore((s) => s.toggleGroupFilter)

  const handleCreate = (name: string, color: string) => {
    const id = addGroup(name, color)
    setShowAdd(false)
    setEditingId(id)   // immediately open member editor for the new group
  }

  const content = (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-space-700/50 flex-shrink-0">
        <button
          onClick={() => { setShowAdd((v) => !v); setEditingId(null) }}
          className="text-xs text-slate-400 hover:text-cyan-400 transition-colors"
        >
          + New group
        </button>
        {groups.length > 0 && (
          <span className="ml-auto text-xs text-slate-600">
            {groups.length} group{groups.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="overflow-y-auto flex-1 flex flex-col">
        {/* New group form */}
        {showAdd && (
          <GroupForm onSave={handleCreate} onCancel={() => setShowAdd(false)} />
        )}

        {/* Member editor */}
        {editingId && (
          <MemberEditor groupId={editingId} onClose={() => setEditingId(null)} />
        )}

        {/* Group list */}
        {groups.length === 0 && !showAdd ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-slate-500">No groups defined.</p>
            <button
              onClick={() => setShowAdd(true)}
              className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              + Create your first group
            </button>
          </div>
        ) : (
          <div className="px-1 py-1 flex flex-col gap-0.5">
            {groups.map((g) => {
              const isSelected = selectedGroupIds.has(g.id)
              const isEditing  = editingId === g.id
              return (
                <div
                  key={g.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded transition-colors group ${
                    isSelected ? 'bg-space-800 border border-space-600' : 'border border-transparent hover:bg-space-800/50'
                  }`}
                >
                  {/* Color swatch */}
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0 cursor-pointer"
                    style={{ background: g.color }}
                    onClick={() => toggleGroupFilter(g.id)}
                    title={isSelected ? 'Deactivate filter' : 'Activate filter'}
                  />

                  {/* Name + count */}
                  <button
                    onClick={() => setEditingId(isEditing ? null : g.id)}
                    className={`flex-1 text-left text-xs ${isSelected ? 'text-white' : 'text-slate-400 hover:text-white'} transition-colors truncate`}
                  >
                    {g.name}
                    <span className="text-slate-600 ml-1.5 text-[10px]">{g.noradIds.length}</span>
                  </button>

                  {/* Filter toggle */}
                  <button
                    onClick={() => toggleGroupFilter(g.id)}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                      isSelected
                        ? 'border-current text-current opacity-100'
                        : 'border-space-700 text-slate-600 opacity-0 group-hover:opacity-100'
                    }`}
                    style={isSelected ? { color: g.color, borderColor: g.color } : {}}
                    title={isSelected ? 'Remove filter' : 'Filter to group'}
                  >
                    {isSelected ? 'ON' : 'filter'}
                  </button>

                  {/* Edit button */}
                  <button
                    onClick={() => setEditingId(isEditing ? null : g.id)}
                    className="text-slate-500 hover:text-slate-300 transition-colors text-xs opacity-0 group-hover:opacity-100"
                    title="Edit members"
                  >
                    ✎
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => { deleteGroup(g.id); if (editingId === g.id) setEditingId(null) }}
                    className="text-slate-500 hover:text-red-400 transition-colors text-xs opacity-0 group-hover:opacity-100"
                    title="Delete group"
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {selectedGroupIds.size > 0 && (
          <div className="px-4 py-2 text-[10px] text-slate-500 border-t border-space-700/50 mt-auto">
            Globe filtered to {[...selectedGroupIds].length} group{selectedGroupIds.size !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </>
  )

  if (embedded) {
    return <div className="flex flex-col flex-1 min-h-0 overflow-hidden">{content}</div>
  }

  return (
    <div className="w-72 flex flex-col flex-shrink-0 bg-space-900/90 backdrop-blur-sm border border-space-700 rounded-lg shadow-2xl text-white max-h-96">
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0 border-b border-space-700">
        <span className="text-sm font-semibold tracking-wide text-white flex-1">GROUPS</span>
      </div>
      {content}
    </div>
  )
}
