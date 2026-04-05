#!/usr/bin/env node
/**
 * fetch-satellite-data.mjs
 *
 * Downloads satellite TLE data, SATCAT metadata, UCS classification data, and
 * country borders. Writes bundleable files into src/data/ and public/.
 *
 * Run:  npm run fetch-tles
 *
 * Sources:
 *   1. CelesTrak GP TLE text  → TLE lines, meanMotion               (per NORAD ID)
 *   2. CelesTrak GP JSON      → objectType                           (per NORAD ID)
 *   3. CelesTrak SATCAT.txt   → country code                         (per NORAD ID)
 *   4. CelesTrak SATCAT.csv   → rcsSize, launchYear, decayed         (per NORAD ID)
 *   5. UCS Satellite Database → userType, purpose                    (per NORAD ID)
 *   6. Natural Earth          → country border GeoJSON               (globe overlay)
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT       = join(__dirname, '..')
const DATA_DIR   = join(ROOT, 'src', 'data')
const PUBLIC_DIR = join(ROOT, 'public')

const GP_TLE_URL    = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=TLE'
const GP_JSON_URL   = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=JSON'
const SATCAT_URL    = 'https://celestrak.org/pub/satcat.txt'
const SATCAT_CSV_URL = 'https://celestrak.org/pub/satcat.csv'
const BORDERS_URL   = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'

// UCS Satellite Database — tab-separated text file
// Download page: https://www.ucsusa.org/resources/satellite-database
// Note: URL may change with database updates. If fetch fails, userType and
// purpose fields will be null for all satellites (non-fatal).
const UCS_URL = 'https://www.ucsusa.org/media/11492'

const UA = { 'User-Agent': 'SatTrack/1.0 (open-source satellite tracking tool)' }

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`  ${msg}`) }
function step(msg) { console.log(`\n▶ ${msg}`) }
function ok(msg)   { console.log(`  ✓ ${msg}`) }
function warn(msg) { console.warn(`  ⚠ ${msg}`) }
function err(msg)  { console.error(`  ✗ ${msg}`) }

async function fetchWithRetry(url, label, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      log(`Fetching ${label} (attempt ${attempt}/${retries})…`)
      const res = await fetch(url, { headers: UA })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      return res
    } catch (e) {
      if (attempt === retries) throw e
      const delay = attempt * 2000
      warn(`${e.message} — retrying in ${delay / 1000}s`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

// ─── Classification helpers ──────────────────────────────────────────────────

/** Classify orbit from mean motion (rev/day) and eccentricity. */
function classifyOrbit(meanMotion, ecc) {
  if (meanMotion >= 11.25) return 'LEO'
  if (meanMotion >= 2.0)   return 'MEO'
  if (meanMotion >= 0.9 && meanMotion <= 1.1 && ecc < 0.02) return 'GEO'
  return 'HEO'
}

/** Classify inclination into an InclinationBand. */
function classifyInclination(incDeg) {
  if (incDeg > 100) return 'RETROGRADE'
  if (incDeg >= 96) return 'SUN_SYNCHRONOUS'   // SSO band ~96–100°
  if (incDeg >= 90) return 'POLAR'
  if (incDeg >= 60) return 'HIGH_INCLINATION'
  if (incDeg >= 30) return 'MID_LATITUDE'
  return 'EQUATORIAL'
}

/** Classify numeric RCS (m²) into a size class. */
function classifyRcs(rcsValue) {
  if (rcsValue === null || isNaN(rcsValue)) return null
  if (rcsValue < 0.1)  return 'SMALL'
  if (rcsValue < 1.0)  return 'MEDIUM'
  return 'LARGE'
}

/** Normalize UCS "Users" field to a SatelliteUserType. */
function mapUserType(raw) {
  if (!raw) return null
  const r = raw.toLowerCase()
  const hasMilitary   = r.includes('military')
  const hasGovernment = r.includes('government')
  const hasCivil      = r.includes('civil')
  const hasCommercial = r.includes('commercial')
  const count = [hasMilitary, hasGovernment, hasCivil, hasCommercial].filter(Boolean).length
  if (count > 1)      return 'MIXED'
  if (hasMilitary)    return 'MILITARY'
  if (hasGovernment)  return 'GOVERNMENT'
  if (hasCivil)       return 'CIVIL'
  if (hasCommercial)  return 'COMMERCIAL'
  return null
}

/** Normalize UCS "Purpose" field to a SatellitePurpose. */
function mapPurpose(raw) {
  if (!raw) return null
  const r = raw.toLowerCase()
  if (r.includes('communications') || r.includes('communication')) return 'COMMUNICATIONS'
  if (r.includes('navigation') || r.includes('positioning'))       return 'NAVIGATION'
  if (r.includes('weather') || r.includes('meteorolog'))           return 'WEATHER'
  if (r.includes('earth observation') || r.includes('remote sens')) return 'EARTH_OBSERVATION'
  if (r.includes('space science') || r.includes('astrophysics'))   return 'SPACE_SCIENCE'
  if (r.includes('reconnaissance') || r.includes('surveillance') ||
      r.includes('intelligence') || r.includes('sigint') ||
      r.includes('elint') || r.includes('isr'))                    return 'RECONNAISSANCE'
  if (r.includes('technology'))                                     return 'TECHNOLOGY'
  return 'OTHER'
}

// ─── Source 1a: CelesTrak GP TLE text ───────────────────────────────────────

async function fetchGPTLE() {
  step('CelesTrak GP TLE text (active satellites)')
  const res  = await fetchWithRetry(GP_TLE_URL, 'GP TLE text')
  const text = await res.text()

  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean)
  const tleMap = {}
  let parsed = 0, skipped = 0

  for (let i = 0; i < lines.length - 2; i += 3) {
    const name  = lines[i]
    const line1 = lines[i + 1]
    const line2 = lines[i + 2]

    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) { skipped++; i -= 2; continue }

    const noradId    = line1.substring(2, 7).trim()
    const meanMotion = parseFloat(line2.substring(52, 63))

    if (!noradId || isNaN(meanMotion)) { skipped++; continue }

    tleMap[noradId] = { name: name.trim(), line1, line2, meanMotion }
    parsed++
  }

  ok(`Parsed ${parsed} TLE records (${skipped} skipped)`)
  return tleMap
}

// ─── Source 1b: CelesTrak GP JSON ───────────────────────────────────────────

async function fetchGPJSON() {
  step('CelesTrak GP JSON (object types)')
  const res  = await fetchWithRetry(GP_JSON_URL, 'GP JSON')
  const data = await res.json()

  const typeMap = {}
  let withType = 0
  for (const sat of data) {
    const noradId = String(sat.NORAD_CAT_ID)
    // OBJECT_TYPE may be absent in some GP JSON responses; only store if present
    if (sat.OBJECT_TYPE && sat.OBJECT_TYPE !== 'UNKNOWN') {
      typeMap[noradId] = sat.OBJECT_TYPE
      withType++
    }
  }

  ok(`${Object.keys(data).length} entries total, ${withType} with OBJECT_TYPE`)
  return typeMap
}

// ─── Source 2a: CelesTrak SATCAT.txt (country codes) ────────────────────────

async function fetchSATCAT() {
  step('CelesTrak SATCAT.txt (country codes)')
  const res  = await fetchWithRetry(SATCAT_URL, 'SATCAT.txt')
  const text = await res.text()
  const lines = text.split('\n')

  const countryMap = {}
  let parsed = 0, skipped = 0

  for (const line of lines) {
    if (line.length < 50) { skipped++; continue }

    const noradId = line.substring(13, 18).trim()
    const country = line.substring(49, 54).trim()

    if (!/^\d{1,6}$/.test(noradId)) { skipped++; continue }

    countryMap[noradId] = country || 'UNK'
    parsed++
  }

  ok(`Parsed ${parsed} SATCAT entries (${skipped} skipped/header lines)`)
  return countryMap
}

// ─── Source 2b: CelesTrak SATCAT.csv (RCS, launch year, decay) ──────────────
//
// CSV columns (0-indexed after header parse):
//   INTLDES, NORAD_CAT_ID, MULTIPLE_NAME_FLAG, PAYLOAD_FLAG,
//   OPERATIONAL_STATUS_CODE, NAME, SOURCE, LAUNCH_DATE, LAUNCH_SITE,
//   DECAY_DATE, ORBITAL_PERIOD, INCLINATION, APOGEE, PERIGEE, RCS,
//   DATA_STATUS_CODE, ORBIT_CENTER, ORBIT_TYPE
//
async function fetchSATCATCSV() {
  step('CelesTrak SATCAT.csv (RCS size, launch year, decay status)')
  const res  = await fetchWithRetry(SATCAT_CSV_URL, 'SATCAT.csv')
  const text = await res.text()
  const lines = text.trim().split('\n')

  if (lines.length < 2) throw new Error('SATCAT CSV appears empty')

  // Parse header to find column indices — resilient to column order changes
  const headers = lines[0].split(',').map(h => h.trim().toUpperCase())
  const idx = {
    noradId:    headers.indexOf('NORAD_CAT_ID'),
    objectType: headers.indexOf('OBJECT_TYPE'),
    launchDate: headers.indexOf('LAUNCH_DATE'),
    decayDate:  headers.indexOf('DECAY_DATE'),
    rcs:        headers.indexOf('RCS'),
  }

  if (idx.noradId === -1) throw new Error('SATCAT CSV missing NORAD_CAT_ID column')

  const metaMap = {}
  let parsed = 0, skipped = 0

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    const noradId = cols[idx.noradId]?.trim()
    if (!noradId || !/^\d{1,6}$/.test(noradId)) { skipped++; continue }

    const objectTypeRaw = idx.objectType >= 0 ? cols[idx.objectType]?.trim() : ''
    const launchDateStr = idx.launchDate >= 0 ? cols[idx.launchDate]?.trim() : ''
    const decayDateStr  = idx.decayDate  >= 0 ? cols[idx.decayDate]?.trim()  : ''
    const rcsStr        = idx.rcs        >= 0 ? cols[idx.rcs]?.trim()        : ''

    const launchYear = launchDateStr ? parseInt(launchDateStr.substring(0, 4), 10) : null
    const decayed    = Boolean(decayDateStr && decayDateStr.length > 0)
    const rcsValue   = rcsStr ? parseFloat(rcsStr) : null
    const rcsSize    = classifyRcs(rcsValue)

    // Map SATCAT object type codes to app values
    let objectType = 'UNKNOWN'
    if (objectTypeRaw === 'PAY')  objectType = 'PAYLOAD'
    else if (objectTypeRaw === 'R/B') objectType = 'ROCKET BODY'
    else if (objectTypeRaw === 'DEB') objectType = 'DEBRIS'

    metaMap[noradId] = {
      objectType,
      launchYear: launchYear && !isNaN(launchYear) ? launchYear : null,
      decayed,
      rcsSize,
    }
    parsed++
  }

  ok(`Parsed ${parsed} SATCAT CSV entries (${skipped} skipped)`)
  return metaMap
}

// ─── Source 3: UCS Satellite Database ───────────────────────────────────────
//
// Tab-separated text file. Key columns (header-driven, order may vary):
//   "NORAD Number"  → cross-reference key
//   "Users"         → Civil / Commercial / Government / Military
//   "Purpose"       → Communications / Earth Observation / Navigation / etc.
//
async function fetchUCS() {
  step('UCS Satellite Database (user type, purpose)')
  const res  = await fetchWithRetry(UCS_URL, 'UCS DB')
  const contentType = res.headers.get('content-type') ?? ''

  // UCS now distributes an XLSX file; fall back to TSV/CSV for older formats
  const isXlsx = contentType.includes('spreadsheetml') || contentType.includes('officedocument')
  let rows  // array of arrays

  if (isXlsx) {
    const xlsx  = require('xlsx')
    const ab    = await res.arrayBuffer()
    const buf   = Buffer.from(ab)
    const wb    = xlsx.read(buf, { type: 'buffer' })
    const ws    = wb.Sheets[wb.SheetNames[0]]
    rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' })
  } else {
    const text  = await res.text()
    const lines = text.trim().split('\n')
    if (lines.length < 2) throw new Error('UCS response appears empty')
    const delim = lines[0].includes('\t') ? '\t' : ','
    rows = lines.map(l => l.split(delim).map(c => c.trim().replace(/^"|"$/g, '')))
  }

  if (rows.length < 2) throw new Error('UCS DB: no data rows found')

  // UCS column names vary slightly — find by partial uppercase match
  const headers = rows[0].map(h => String(h ?? '').trim().toUpperCase())
  const findCol = (...names) => {
    for (const n of names) {
      const i = headers.findIndex(h => h.includes(n.toUpperCase()))
      if (i >= 0) return i
    }
    return -1
  }

  const idx = {
    noradId: findCol('NORAD NUMBER', 'NORAD_NUMBER', 'NORAD'),
    users:   findCol('USERS'),
    purpose: findCol('PURPOSE'),
  }

  if (idx.noradId === -1) throw new Error('UCS DB: could not find NORAD Number column')

  const ucsMap = {}
  let matched = 0, skipped = 0

  for (let i = 1; i < rows.length; i++) {
    const cols  = rows[i]
    const rawId = String(cols[idx.noradId] ?? '').trim()
    if (!rawId) { skipped++; continue }

    // NORAD IDs in UCS may be floats (e.g. "25544.0") — normalise
    const parsed = parseInt(rawId, 10)
    if (isNaN(parsed)) { skipped++; continue }
    const noradId = String(parsed)

    ucsMap[noradId] = {
      userType: mapUserType(idx.users   >= 0 ? String(cols[idx.users]   ?? '') : ''),
      purpose:  mapPurpose(idx.purpose >= 0 ? String(cols[idx.purpose] ?? '') : ''),
    }
    matched++
  }

  ok(`Matched ${matched} UCS entries (${skipped} skipped)`)
  return ucsMap
}

// ─── Source 4: Natural Earth country borders ─────────────────────────────────

async function fetchBorders() {
  step('Natural Earth country borders (GeoJSON)')
  const res  = await fetchWithRetry(BORDERS_URL, 'ne_110m_admin_0_countries.geojson')
  const text = await res.text()
  ok(`${(text.length / 1024).toFixed(0)} KB received`)
  return text
}

// ─── Merge & write ───────────────────────────────────────────────────────────

async function main() {
  console.log('\n━━━ SatTrack: fetch-satellite-data ━━━')

  mkdirSync(DATA_DIR,   { recursive: true })
  mkdirSync(PUBLIC_DIR, { recursive: true })

  let tleMap = {}, typeMap = {}, countryMap = {}, satcatMeta = {}, ucsMap = {}, bordersText = null

  try { tleMap      = await fetchGPTLE()     }
  catch (e) { err(`GP TLE fetch failed: ${e.message}`) }

  try { typeMap     = await fetchGPJSON()    }
  catch (e) { err(`GP JSON fetch failed: ${e.message} — objectType will be UNKNOWN`) }

  try { countryMap  = await fetchSATCAT()   }
  catch (e) { err(`SATCAT.txt failed: ${e.message} — country codes will be UNK`) }

  try { satcatMeta  = await fetchSATCATCSV() }
  catch (e) { err(`SATCAT.csv failed: ${e.message} — rcsSize/launchYear will be null`) }

  try { ucsMap      = await fetchUCS()      }
  catch (e) { err(`UCS DB failed: ${e.message} — userType/purpose will be null`) }

  try { bordersText = await fetchBorders()  }
  catch (e) { err(`Borders failed: ${e.message} — globe will have no country lines`) }

  // ── Guard: abort if TLE fetch failed (don't overwrite with empty data) ──
  if (Object.keys(tleMap).length === 0) {
    err('TLE data unavailable — aborting to preserve existing activeTLEs.json')
    process.exit(1)
  }

  // ── Merge all sources ──
  step('Merging data sources')

  const satellites = []
  let noCountry = 0

  for (const [noradId, tle] of Object.entries(tleMap)) {
    const country    = countryMap[noradId] ?? 'UNK'
    // GP JSON is preferred; fall back to SATCAT CSV OBJECT_TYPE column
    const objectType = typeMap[noradId] || satcatMeta[noradId]?.objectType || 'UNKNOWN'
    const eccStr     = tle.line2.substring(26, 33)
    const ecc        = parseFloat('0.' + eccStr)
    const orbitClass = classifyOrbit(tle.meanMotion, ecc)
    const incDeg     = parseFloat(tle.line2.substring(8, 16))

    const meta = satcatMeta[noradId] ?? {}
    const ucs  = ucsMap[noradId]     ?? {}

    if (country === 'UNK') noCountry++

    satellites.push({
      noradId,
      name:            tle.name,
      objectType,
      country,
      orbitClass,
      line1:           tle.line1,
      line2:           tle.line2,
      inclinationDeg:  isNaN(incDeg) ? 0 : incDeg,
      inclinationBand: classifyInclination(isNaN(incDeg) ? 0 : incDeg),
      rcsSize:         meta.rcsSize    ?? null,
      launchYear:      meta.launchYear ?? null,
      decayed:         meta.decayed    ?? false,
      userType:        ucs.userType    ?? null,
      purpose:         ucs.purpose     ?? null,
    })
  }

  ok(`Merged ${satellites.length} satellites`)
  if (noCountry > 0) warn(`${noCountry} satellites with unknown country (SATCAT mismatch)`)

  // ── Summaries ──
  const orbitCounts = satellites.reduce((acc, s) => {
    acc[s.orbitClass] = (acc[s.orbitClass] ?? 0) + 1; return acc
  }, {})
  log(`Orbit breakdown: ${Object.entries(orbitCounts).map(([k,v]) => `${k}=${v}`).join('  ')}`)

  const countryCounts = satellites.reduce((acc, s) => {
    acc[s.country] = (acc[s.country] ?? 0) + 1; return acc
  }, {})
  const top10 = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
  log(`Top countries: ${top10.map(([k,v]) => `${k}(${v})`).join('  ')}`)

  const ucsCovered = satellites.filter(s => s.userType !== null).length
  log(`UCS coverage: ${ucsCovered} / ${satellites.length} satellites have userType`)

  // ── Write activeTLEs.json ──
  step('Writing output files')

  const output = {
    fetchedAt: new Date().toISOString(),
    count: satellites.length,
    satellites,
  }

  const json = JSON.stringify(output)
  writeFileSync(join(DATA_DIR, 'activeTLEs.json'), json)
  ok(`src/data/activeTLEs.json  (${(json.length / 1024).toFixed(0)} KB)`)

  // ── Write borders ──
  if (bordersText) {
    writeFileSync(join(PUBLIC_DIR, 'ne_countries.geojson'), bordersText)
    ok(`public/ne_countries.geojson`)
  }

  console.log('\n━━━ Done ━━━\n')
}

main().catch(e => {
  console.error('\n✗ Fatal:', e.message)
  process.exit(1)
})
