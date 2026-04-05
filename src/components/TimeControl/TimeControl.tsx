import { useState, useEffect, useRef } from 'react'
import { useSatelliteStore } from '../../store/useSatelliteStore'
import { getSimTimeMs, formatSimUtc } from '../../utils/simTime'
import { loadScenarios, saveScenarios, type Scenario } from '../../services/scenarioStorage'

function fmtSavedAt(ms: number): string {
  const d = new Date(ms)
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${MONTHS[d.getMonth()]} ${d.getDate()}  ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Time step buttons ─────────────────────────────────────────────────────────

const STEPS = [
  { label: '−24h', delta: -24 * 3600 * 1000 },
  { label: '−6h',  delta:  -6 * 3600 * 1000 },
  { label: '−1h',  delta:  -1 * 3600 * 1000 },
  { label: '+1h',  delta:   1 * 3600 * 1000 },
  { label: '+6h',  delta:   6 * 3600 * 1000 },
  { label: '+24h', delta:  24 * 3600 * 1000 },
]

const SLIDER_MIN_MS = -48 * 3600 * 1000
const SLIDER_MAX_MS =  48 * 3600 * 1000

// ── Component ─────────────────────────────────────────────────────────────────

export default function TimeControl() {
  const simClock     = useSatelliteStore((s) => s.simClock)
  const setSimLive   = useSatelliteStore((s) => s.setSimLive)
  const setSimOffset = useSatelliteStore((s) => s.setSimOffset)

  const [scenarios,  setScenarios]  = useState<Scenario[]>(loadScenarios)
  const [panelOpen,  setPanelOpen]  = useState(false)
  const [newLabel,   setNewLabel]   = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLInputElement>(null)

  // Close panel on outside click or Escape
  useEffect(() => {
    if (!panelOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPanelOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanelOpen(false) }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown',   onKey)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown',   onKey)
    }
  }, [panelOpen])

  const handleTogglePanel = () => {
    if (!panelOpen) {
      // Pre-fill label with current sim time
      setNewLabel(formatSimUtc(getSimTimeMs(simClock)).replace(' UTC', ''))
      setPanelOpen(true)
      // Focus input after render
      setTimeout(() => { inputRef.current?.select() }, 30)
    } else {
      setPanelOpen(false)
    }
  }

  const handleSave = () => {
    const label = newLabel.trim() || formatSimUtc(getSimTimeMs(simClock)).replace(' UTC', '')
    const next = [
      { id: crypto.randomUUID(), label, offsetMs: simClock.offsetMs, savedAt: Date.now() },
      ...scenarios,
    ]
    setScenarios(next)
    saveScenarios(next)
    setPanelOpen(false)
  }

  const handleLoad = (s: Scenario) => {
    setSimOffset(s.offsetMs)
    setPanelOpen(false)
  }

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = scenarios.filter((s) => s.id !== id)
    setScenarios(next)
    saveScenarios(next)
  }

  const handleStep = (delta: number) => setSimOffset(simClock.offsetMs + delta)

  const simTimeMs = getSimTimeMs(simClock)

  return (
    <div
      ref={containerRef}
      className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10"
    >
      {/* ── Scenario panel ── */}
      {panelOpen && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-72
          bg-space-900/95 backdrop-blur-sm border border-space-700 rounded-lg shadow-2xl overflow-hidden"
        >
          {/* Save row */}
          <div className="px-3 py-2.5 border-b border-space-700/50">
            <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1.5 font-semibold">
              Save Current Time
            </div>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
                placeholder="Label…"
                className="flex-1 bg-space-800 border border-space-700 rounded px-2 py-1
                  text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
              />
              <button
                onClick={handleSave}
                className="text-xs px-2.5 py-1 rounded border border-cyan-500/40 bg-cyan-500/10
                  text-cyan-400 hover:bg-cyan-500/20 transition-colors flex-shrink-0"
              >
                Save
              </button>
            </div>
          </div>

          {/* Scenario list */}
          {scenarios.length > 0 ? (
            <div className="max-h-52 overflow-y-auto">
              {scenarios.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-space-800/60 group cursor-pointer"
                  onClick={() => handleLoad(s)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white truncate">{s.label}</div>
                    <div className="text-[10px] text-slate-600 font-mono">{fmtSavedAt(s.savedAt)}</div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(s.id, e)}
                    aria-label="Delete scenario"
                    className="text-slate-700 hover:text-red-400 transition-colors text-base leading-none
                      opacity-0 group-hover:opacity-100 flex-shrink-0"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-3 text-center text-[10px] text-slate-600">
              No saved scenarios yet
            </div>
          )}
        </div>
      )}

      {/* ── Main bar ── */}
      <div className="flex items-center gap-2
        bg-space-900/90 backdrop-blur-sm border border-space-700 rounded-lg shadow-2xl
        px-3 py-2 text-xs font-mono"
      >
        {/* LIVE */}
        <button
          onClick={setSimLive}
          title="Return to live real-time mode"
          className={`
            px-2 py-1 rounded border text-[10px] font-semibold tracking-widest transition-colors
            ${simClock.isLive
              ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
              : 'border-space-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'}
          `}
        >
          LIVE
        </button>

        <span className="text-space-700">|</span>

        {/* Step buttons */}
        {STEPS.map(({ label, delta }) => (
          <button
            key={label}
            onClick={() => handleStep(delta)}
            className="px-1.5 py-1 rounded border border-space-700 text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
          >
            {label}
          </button>
        ))}

        <span className="text-space-700">|</span>

        {/* Scrub slider */}
        <input
          type="range"
          min={SLIDER_MIN_MS}
          max={SLIDER_MAX_MS}
          step={60_000}
          value={simClock.offsetMs}
          onChange={(e) => setSimOffset(parseInt(e.target.value, 10))}
          className="w-32 accent-cyan-500 cursor-pointer"
          title="Scrub simulation time (±48h)"
        />

        <span className="text-space-700">|</span>

        {/* Current sim time */}
        <span className={`text-[10px] ${simClock.isLive ? 'text-slate-400' : 'text-amber-400'}`}>
          {formatSimUtc(simTimeMs)}
        </span>

        <span className="text-space-700">|</span>

        {/* Scenarios toggle */}
        <button
          onClick={handleTogglePanel}
          title="Saved scenarios"
          className={`
            px-1.5 py-1 rounded border text-[10px] transition-colors
            ${panelOpen
              ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
              : scenarios.length > 0
              ? 'border-amber-700/50 text-amber-500/70 hover:text-amber-400 hover:border-amber-500/50'
              : 'border-space-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'}
          `}
        >
          {scenarios.length > 0 ? `★ ${scenarios.length}` : '☆'}
        </button>
      </div>
    </div>
  )
}
