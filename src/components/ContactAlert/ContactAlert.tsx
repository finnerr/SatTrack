import { useState, useEffect } from 'react'
import { useSatelliteStore } from '../../store/useSatelliteStore'
import { getSimTimeMs } from '../../utils/simTime'
import { formatCountdown, isAlertWindow } from '../../utils/passUtils'

// ── Constants ──────────────────────────────────────────────────────────────────

const ALERT_LEAD_MS = 10 * 60 * 1000  // alert fires when AOS < 10 minutes away

function elevColor(tcaEl: number) {
  if (tcaEl >= 45) return {
    border:  'border-emerald-500/50',
    bg:      'bg-emerald-500/8',
    label:   'text-emerald-400',
    badge:   'bg-emerald-500/20 text-emerald-300',
    el:      'text-emerald-400',
  }
  if (tcaEl >= 15) return {
    border:  'border-cyan-500/50',
    bg:      'bg-cyan-500/8',
    label:   'text-cyan-400',
    badge:   'bg-cyan-500/20 text-cyan-300',
    el:      'text-cyan-400',
  }
  return {
    border:  'border-amber-500/50',
    bg:      'bg-amber-500/8',
    label:   'text-amber-400',
    badge:   'bg-amber-500/20 text-amber-300',
    el:      'text-amber-400',
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface AlertItem {
  key:          string
  satName:      string
  stationName:  string
  aosTime:      number
  tcaElDeg:     number
  durationSec:  number
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ContactAlert() {
  const selected           = useSatelliteStore((s) => s.selected)
  const passPredictions    = useSatelliteStore((s) => s.passPredictions)
  const groundStations     = useSatelliteStore((s) => s.groundStations)
  const selectedStationIds = useSatelliteStore((s) => s.selectedStationIds)
  const simClock           = useSatelliteStore((s) => s.simClock)

  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  // Re-render every second so countdowns stay live
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (!selected || selectedStationIds.length === 0) return null

  const now = getSimTimeMs(simClock)

  const alerts: AlertItem[] = []
  for (const stationId of selectedStationIds) {
    const pred = passPredictions.find(
      (p) => p.noradId === selected.noradId && p.stationId === stationId,
    )
    if (!pred) continue
    const station = groundStations.find((gs) => gs.id === stationId)
    if (!station) continue

    for (const pass of pred.passes) {
      if (!isAlertWindow(pass.aosTime, now, ALERT_LEAD_MS)) continue
      const timeUntil = pass.aosTime - now
      const key = `${pred.noradId}-${stationId}-${pass.aosTime}`
      if (dismissed.has(key)) continue
      alerts.push({
        key,
        satName:     selected.name,
        stationName: station.name,
        aosTime:     pass.aosTime,
        tcaElDeg:    pass.tcaElDeg,
        durationSec: pass.durationSec,
      })
    }
  }

  if (alerts.length === 0) return null

  return (
    <div className="absolute bottom-10 right-4 z-30 flex flex-col gap-2 w-80 pointer-events-none">
      {alerts.map((alert) => {
        const c        = elevColor(alert.tcaElDeg)
        const timeLeft = alert.aosTime - now
        const durMin   = Math.floor(alert.durationSec / 60)
        const durSec   = alert.durationSec % 60

        return (
          <div
            key={alert.key}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg border shadow-2xl backdrop-blur-sm bg-space-900/90 ${c.border} ${c.bg}`}
          >
            <div className="flex-1 min-w-0">
              {/* Header row */}
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-semibold tracking-widest uppercase ${c.label}`}>
                  Upcoming Contact
                </span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold ${c.badge}`}>
                  {formatCountdown(timeLeft)}
                </span>
              </div>

              {/* Satellite name */}
              <div className="text-sm font-semibold text-white truncate">{alert.satName}</div>

              {/* Station + pass details */}
              <div className="flex items-center gap-2 mt-0.5 text-xs font-mono">
                <span className="text-slate-400 truncate">{alert.stationName}</span>
                <span className="text-slate-600">·</span>
                <span className={c.el}>{alert.tcaElDeg.toFixed(1)}° max</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-500">
                  {durMin}m{String(durSec).padStart(2, '0')}s
                </span>
              </div>
            </div>

            {/* Dismiss */}
            <button
              onClick={() => setDismissed((prev) => new Set([...prev, alert.key]))}
              className="text-slate-600 hover:text-white transition-colors text-lg leading-none flex-shrink-0 mt-0.5"
              aria-label="Dismiss alert"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
