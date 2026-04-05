/**
 * IndexedDB persistence layer for satellite catalog, constellation groups,
 * and watch list.  DB version 2 — version 1 is owned by tleCache.ts.
 *
 * Pattern mirrors tleCache.ts: openDB() returns a Promise<IDBDatabase>,
 * each exported helper handles its own transaction.
 */
import type { SatelliteMeta, ConstellationGroup } from '../types/satellite'
import { logger } from './logger'

const DB_NAME    = 'sattrack'
const DB_VERSION = 2
const SRC        = 'IDB'

const CATALOG_STORE      = 'satellite_catalog'
const GROUPS_STORE       = 'constellation_groups'
const WATCH_STORE        = 'watch_list'

// ── DB open ────────────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (event) => {
      const db      = req.result
      const oldVer  = event.oldVersion

      // Version 1 stores (tleCache.ts)
      if (oldVer < 1) {
        db.createObjectStore('tle_cache', { keyPath: 'categoryId' })
      }

      // Version 2 stores (this file)
      if (oldVer < 2) {
        db.createObjectStore(CATALOG_STORE, { keyPath: 'noradId' })
        db.createObjectStore(GROUPS_STORE,  { keyPath: 'id' })
        db.createObjectStore(WATCH_STORE,   { keyPath: 'noradId' })
        logger.info(SRC, 'IndexedDB v2 schema created')
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => {
      logger.error(SRC, `IndexedDB open failed: ${req.error?.message}`)
      reject(req.error)
    }
  })
}

// ── Generic helpers ────────────────────────────────────────────────────────────

async function putAll(storeName: string, items: object[]): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    store.clear()
    for (const item of items) store.put(item)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => {
      logger.error(SRC, `Write failed [${storeName}]: ${tx.error?.message}`)
      reject(tx.error)
    }
  })
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror   = () => {
      logger.error(SRC, `Read failed [${storeName}]: ${req.error?.message}`)
      reject(req.error)
    }
  })
}

// ── Satellite catalog ─────────────────────────────────────────────────────────

/** Persists the full catalog. Overwrites any previous snapshot. */
export async function saveCatalog(sats: SatelliteMeta[]): Promise<void> {
  try {
    await putAll(CATALOG_STORE, sats)
    logger.debug(SRC, `Catalog saved: ${sats.length} records`)
  } catch {
    // Non-fatal — app continues with in-memory data
  }
}

/** Clears the persisted catalog and the localStorage timestamp. */
export async function clearCatalog(): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CATALOG_STORE, 'readwrite')
      tx.objectStore(CATALOG_STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror    = () => reject(tx.error)
    })
    localStorage.removeItem('sattrack_catalog_fetchedAt')
    logger.debug(SRC, 'Catalog cleared')
  } catch {
    // Non-fatal
  }
}

/** Returns persisted catalog, or null if not found / error. */
export async function loadCatalog(): Promise<SatelliteMeta[] | null> {
  try {
    const sats = await getAll<SatelliteMeta>(CATALOG_STORE)
    if (sats.length === 0) return null
    logger.debug(SRC, `Catalog loaded: ${sats.length} records`)
    return sats
  } catch {
    return null
  }
}

// ── Constellation groups ──────────────────────────────────────────────────────

export async function saveGroups(groups: ConstellationGroup[]): Promise<void> {
  try {
    await putAll(GROUPS_STORE, groups)
  } catch {
    // Non-fatal
  }
}

export async function loadGroups(): Promise<ConstellationGroup[]> {
  try {
    return await getAll<ConstellationGroup>(GROUPS_STORE)
  } catch {
    return []
  }
}

// ── Watch list ────────────────────────────────────────────────────────────────

export async function saveWatchList(noradIds: string[]): Promise<void> {
  try {
    await putAll(WATCH_STORE, noradIds.map((id) => ({ noradId: id })))
  } catch {
    // Non-fatal
  }
}

export async function loadWatchList(): Promise<string[]> {
  try {
    const rows = await getAll<{ noradId: string }>(WATCH_STORE)
    return rows.map((r) => r.noradId)
  } catch {
    return []
  }
}
