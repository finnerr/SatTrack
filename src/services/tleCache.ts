import type { TLERecord } from '../types/satellite'
import { logger } from './logger'

const DB_NAME = 'sattrack'
const DB_VERSION = 1
const STORE_NAME = 'tle_cache'
const TTL_MS = 4 * 60 * 60 * 1000 // 4 hours
const SRC = 'TLECache'

interface CacheEntry {
  categoryId: string
  records: TLERecord[]
  fetchedAt: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'categoryId' })
      logger.info(SRC, 'IndexedDB schema created')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      logger.error(SRC, `IndexedDB open failed: ${req.error?.message}`)
      reject(req.error)
    }
  })
}

async function getCached(categoryId: string): Promise<TLERecord[] | null> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(categoryId)
    req.onsuccess = () => {
      const entry: CacheEntry | undefined = req.result
      if (!entry) {
        logger.debug(SRC, `No cache entry for [${categoryId}]`)
        return resolve(null)
      }
      const ageMin = ((Date.now() - entry.fetchedAt) / 60_000).toFixed(1)
      if (Date.now() - entry.fetchedAt > TTL_MS) {
        logger.info(SRC, `Cache expired for [${categoryId}] (age: ${ageMin}m) — will refetch`)
        return resolve(null)
      }
      logger.info(SRC, `Cache hit [${categoryId}] — ${entry.records.length} TLEs, age: ${ageMin}m`)
      resolve(entry.records)
    }
    req.onerror = () => {
      logger.warn(SRC, `Cache read failed for [${categoryId}]: ${req.error?.message}`)
      resolve(null)
    }
  })
}

async function setCached(categoryId: string, records: TLERecord[]): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({ categoryId, records, fetchedAt: Date.now() })
    tx.oncomplete = () => {
      logger.debug(SRC, `Cache written for [${categoryId}] — ${records.length} records`)
      resolve()
    }
    tx.onerror = () => {
      logger.error(SRC, `Cache write failed for [${categoryId}]: ${tx.error?.message}`)
      reject(tx.error)
    }
  })
}

function parseTLE(raw: string): TLERecord[] {
  const lines = raw.trim().split('\n').map((l) => l.trim()).filter(Boolean)
  const records: TLERecord[] = []
  let skipped = 0
  for (let i = 0; i < lines.length - 2; i += 3) {
    if (lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')) {
      records.push({ name: lines[i], line1: lines[i + 1], line2: lines[i + 2] })
    } else {
      skipped++
    }
  }
  if (skipped > 0) {
    logger.warn(SRC, `TLE parse: skipped ${skipped} malformed entries`)
  }
  return records
}

const RETRYABLE = new Set([429, 500, 502, 503, 504])
const MAX_RETRIES = 3

async function fetchWithRetry(url: string, categoryId: string): Promise<string> {
  let lastStatus = 0
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      const msg = `Network error fetching [${categoryId}] (attempt ${attempt}): ${(err as Error).message}`
      if (attempt === MAX_RETRIES) {
        logger.error(SRC, msg)
        throw new Error(msg)
      }
      logger.warn(SRC, msg + ' — retrying')
      await new Promise((r) => setTimeout(r, 1000 * attempt))
      continue
    }

    if (res.ok) {
      const text = await res.text()
      if (!text.trim()) {
        const msg = `Empty response from CelesTrak for [${categoryId}]`
        logger.error(SRC, msg)
        throw new Error(msg)
      }
      if (attempt > 1) logger.info(SRC, `[${categoryId}] succeeded on attempt ${attempt}`)
      return text
    }

    lastStatus = res.status
    if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES) {
      const delay = 1000 * attempt
      logger.warn(SRC, `CelesTrak HTTP ${res.status} for [${categoryId}] — retry ${attempt}/${MAX_RETRIES - 1} in ${delay}ms`)
      await new Promise((r) => setTimeout(r, delay))
      continue
    }

    const msg = `CelesTrak returned HTTP ${lastStatus} for [${categoryId}]`
    logger.error(SRC, msg)
    throw new Error(msg)
  }
  throw new Error(`CelesTrak fetch failed for [${categoryId}] after ${MAX_RETRIES} attempts`)
}

export async function fetchTLEs(group: string, categoryId: string): Promise<TLERecord[]> {
  const cached = await getCached(categoryId)
  if (cached) return cached

  const url = `/celestrak/NORAD/elements/gp.php?GROUP=${group}&FORMAT=TLE`
  logger.info(SRC, `Fetching TLEs for [${categoryId}] from CelesTrak (group: ${group})`)

  const text = await fetchWithRetry(url, categoryId)
  const records = parseTLE(text)
  logger.info(SRC, `Fetched ${records.length} TLEs for [${categoryId}]`)

  await setCached(categoryId, records)
  return records
}

export async function getCacheAge(categoryId: string): Promise<number | null> {
  const db = await openDB()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(categoryId)
    req.onsuccess = () => {
      const entry: CacheEntry | undefined = req.result
      if (!entry) return resolve(null)
      resolve(Date.now() - entry.fetchedAt)
    }
    req.onerror = () => resolve(null)
  })
}
