import { useEffect, useRef, useState } from 'react'
import Globe from './components/Globe/Globe'
import RightDrawer from './components/RightDrawer/RightDrawer'
import StatusBar from './components/StatusBar/StatusBar'
import LogPanel from './components/LogPanel/LogPanel'
import SatelliteList from './components/SatelliteList/SatelliteList'
import SearchBar, { type SearchBarHandle } from './components/SearchBar/SearchBar'
import TimeControl from './components/TimeControl/TimeControl'
import { loadSatellites } from './services/localData'
import { initEngine, stopEngine } from './services/satelliteEngine'
import { useSatelliteStore } from './store/useSatelliteStore'
import { logger } from './services/logger'
import { loadCatalog, loadWatchList, loadGroups } from './services/idb'
import ContactAlert from './components/ContactAlert/ContactAlert'

const HINT_KEY = 'sattrack_hint_dismissed'

export default function App() {
  const [logOpen,  setLogOpen]  = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [showHint, setShowHint] = useState(() => !localStorage.getItem(HINT_KEY))
  const setAllSatellites = useSatelliteStore((s) => s.setAllSatellites)
  const setSelected      = useSatelliteStore((s) => s.setSelected)
  const setSimLive       = useSatelliteStore((s) => s.setSimLive)
  const searchRef        = useRef<SearchBarHandle>(null)

  const dismissHint = () => {
    localStorage.setItem(HINT_KEY, '1')
    setShowHint(false)
  }

  useEffect(() => {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

    async function init() {
      // Try IndexedDB catalog first (if fetched within 7 days)
      const cached = await loadCatalog()
      const bundled = loadSatellites()

      // idbFetchedAt tracks when IDB was last written (saved in localStorage alongside IDB)
      const idbFetchedAt = localStorage.getItem('sattrack_catalog_fetchedAt')
      const bundledIsNewer =
        bundled.fetchedAt &&
        (!idbFetchedAt || new Date(bundled.fetchedAt) > new Date(idbFetchedAt))

      // Sanity check: if IDB has suspiciously few records it's stale/corrupted — use bundled
      const idbSeemsValid = cached && cached.length >= 1000

      if (idbSeemsValid && !bundledIsNewer) {
        // IDB is current — use it (may have been refreshed live during a previous session)
        setAllSatellites(cached!, idbFetchedAt ?? bundled.fetchedAt)
        logger.info('App', `Loaded ${cached!.length} satellites from IndexedDB cache`)
      } else {
        setAllSatellites(bundled.satellites, bundled.fetchedAt)
        if (bundled.source === 'sample') {
          logger.warn('App', `No bulk data — using ${bundled.satellites.length} sample TLEs. Run: npm run fetch-tles`)
        } else {
          logger.info('App', `Loaded ${bundled.satellites.length} satellites from bulk data (fetched: ${bundled.fetchedAt})`)
        }
      }

      // Load watch list from IndexedDB
      const watchIds = await loadWatchList()
      if (watchIds.length > 0) {
        const { toggleWatchList } = useSatelliteStore.getState()
        for (const id of watchIds) toggleWatchList(id)
        logger.debug('App', `Loaded ${watchIds.length} watch list entries`)
      }

      // Load constellation groups from IndexedDB
      const groups = await loadGroups()
      if (groups.length > 0) {
        const { updateGroup, addGroup } = useSatelliteStore.getState()
        // Replace with loaded groups by reinitializing
        for (const g of groups) {
          const newId = addGroup(g.name, g.color)
          updateGroup(newId, { noradIds: g.noradIds })
        }
        logger.debug('App', `Loaded ${groups.length} constellation groups`)
      }

      initEngine()

    }

    init()
    return () => stopEngine()
  }, [setAllSatellites])

  // ── Global keyboard shortcuts ───────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (listOpen) { setListOpen(false); return }
        if (logOpen)  { setLogOpen(false);  return }
        setSelected(null)
        return
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === '/')                   { e.preventDefault(); searchRef.current?.focus(); return }
      if (e.key === 'l' || e.key === 'L') { setLogOpen((o) => !o);  return }
      if (e.key === 's' || e.key === 'S') { setListOpen((o) => !o); return }
      if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) { setSimLive(); return }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [listOpen, logOpen, setSelected, setSimLive])

  return (
    <div className="relative w-screen h-screen bg-space-950 overflow-hidden">
      <Globe />
      <RightDrawer />
      <SearchBar ref={searchRef} />
      <TimeControl />
      <SatelliteList open={listOpen} onClose={() => setListOpen(false)} />
      <ContactAlert />
      <LogPanel open={logOpen} />
      {showHint && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 rounded-lg border border-cyan-700/40 bg-space-900/95 backdrop-blur-sm shadow-xl text-xs text-slate-300 pointer-events-auto whitespace-nowrap">
          <span className="text-cyan-400 font-semibold">Get started:</span>
          <span>① Click a satellite on the globe</span>
          <span className="text-slate-600">·</span>
          <span>② Open <span className="text-emerald-400 font-mono">STATIONS</span> and add your location</span>
          <span className="text-slate-600">·</span>
          <span>③ Open <span className="text-cyan-400 font-mono">PASSES</span> to see predictions</span>
          <button
            onClick={dismissHint}
            aria-label="Dismiss hint"
            className="ml-2 text-slate-500 hover:text-white transition-colors text-base leading-none flex-shrink-0"
          >×</button>
        </div>
      )}
      <StatusBar
        logOpen={logOpen}
        onToggleLog={() => setLogOpen((o) => !o)}
        listOpen={listOpen}
        onToggleList={() => setListOpen((o) => !o)}
      />
    </div>
  )
}
