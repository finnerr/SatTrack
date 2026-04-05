import { create } from 'zustand'

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export interface LogEntry {
  id: number
  ts: Date
  level: LogLevel
  source: string
  message: string
}

const MAX_ENTRIES = 200

interface LogStore {
  entries: LogEntry[]
  append: (entry: LogEntry) => void
  clear: () => void
}

let seq = 0

export const useLogStore = create<LogStore>((set) => ({
  entries: [],
  append: (entry) =>
    set((s) => ({
      entries:
        s.entries.length >= MAX_ENTRIES
          ? [...s.entries.slice(1), entry]
          : [...s.entries, entry],
    })),
  clear: () => set({ entries: [] }),
}))

function log(level: LogLevel, source: string, message: string) {
  const entry: LogEntry = { id: seq++, ts: new Date(), level, source, message }
  useLogStore.getState().append(entry)

  // Also mirror to browser console
  const fn =
    level === 'ERROR' ? console.error
    : level === 'WARN' ? console.warn
    : level === 'DEBUG' ? console.debug
    : console.info
  fn(`[${source}] ${message}`)
}

export const logger = {
  debug: (source: string, msg: string) => log('DEBUG', source, msg),
  info:  (source: string, msg: string) => log('INFO',  source, msg),
  warn:  (source: string, msg: string) => log('WARN',  source, msg),
  error: (source: string, msg: string) => log('ERROR', source, msg),
}
