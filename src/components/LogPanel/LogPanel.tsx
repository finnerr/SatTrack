import { useEffect, useRef, useState } from 'react'
import { useLogStore, type LogLevel } from '../../services/logger'

const LEVEL_STYLES: Record<LogLevel, string> = {
  DEBUG: 'text-slate-500',
  INFO:  'text-slate-300',
  WARN:  'text-amber-400',
  ERROR: 'text-red-400',
}

const LEVEL_BADGE: Record<LogLevel, string> = {
  DEBUG: 'text-slate-600',
  INFO:  'text-cyan-600',
  WARN:  'text-amber-500',
  ERROR: 'text-red-500',
}

const ALL_LEVELS: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR']

const LEVEL_ORDER: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }

interface Props {
  open: boolean
}

export default function LogPanel({ open }: Props) {
  const { entries, clear } = useLogStore()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [minLevel, setMinLevel] = useState<LogLevel>('DEBUG')
  const [pinToBottom, setPinToBottom] = useState(true)

  const filtered = entries.filter((e) => LEVEL_ORDER[e.level] >= LEVEL_ORDER[minLevel])

  useEffect(() => {
    if (pinToBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [filtered.length, pinToBottom])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
    setPinToBottom(atBottom)
  }

  if (!open) return null

  return (
    <div
      className="
        absolute bottom-7 left-4 z-20 w-[560px]
        bg-space-950/95 backdrop-blur-sm border border-space-700
        rounded-lg shadow-2xl flex flex-col
        "
      style={{ maxHeight: '40vh', minHeight: '180px' }}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-space-700 flex-shrink-0">
        <span className="text-xs font-semibold text-slate-400 tracking-widest uppercase mr-1">
          Logs
        </span>

        {/* Level filter buttons */}
        <div className="flex gap-1">
          {ALL_LEVELS.map((lvl) => (
            <button
              key={lvl}
              onClick={() => setMinLevel(lvl)}
              className={`
                text-xs px-2 py-0.5 rounded border transition-colors
                ${minLevel === lvl
                  ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400'
                  : 'border-space-700 text-slate-600 hover:text-slate-400'}
              `}
            >
              {lvl}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Entry count */}
        <span className="text-xs text-slate-600">{filtered.length} entries</span>

        {/* Pin indicator */}
        <button
          onClick={() => setPinToBottom((p) => !p)}
          title="Pin to latest"
          aria-label={pinToBottom ? 'Unpin from latest' : 'Pin to latest'}
          className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
            pinToBottom ? 'text-cyan-500' : 'text-slate-600 hover:text-slate-400'
          }`}
        >
          ↓
        </button>

        {/* Clear */}
        <button
          onClick={clear}
          className="text-xs text-slate-600 hover:text-red-400 transition-colors px-1"
        >
          clear
        </button>
      </div>

      {/* Log entries */}
      <div
        className="overflow-y-auto flex-1 font-mono text-xs leading-5 px-3 py-2"
        onScroll={handleScroll}
      >
        {filtered.length === 0 && (
          <span className="text-slate-700">No log entries yet.</span>
        )}
        {filtered.map((entry) => (
          <div key={entry.id} className={`flex gap-2 ${LEVEL_STYLES[entry.level]}`}>
            <span className="text-slate-700 flex-shrink-0 select-none">
              {entry.ts.toISOString().substring(11, 23)}
            </span>
            <span className={`w-12 flex-shrink-0 ${LEVEL_BADGE[entry.level]}`}>
              {entry.level}
            </span>
            <span className="text-slate-600 flex-shrink-0 w-16 truncate" title={entry.source}>
              {entry.source}
            </span>
            <span className="break-all">{entry.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
