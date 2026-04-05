import type { SatelliteCategory } from '../types/satellite'
import { SAMPLE_TLES } from '../data/sampleTLEs'

export const CATEGORIES: SatelliteCategory[] = [
  // Local sample data — no network required
  {
    id: 'sample',
    label: 'Sample (offline)',
    group: '',
    orbitClass: 'LEO',
    localRecords: SAMPLE_TLES,
  },

  // Special / crewed
  { id: 'iss',         label: 'ISS',              group: 'stations',       orbitClass: 'LEO' },

  // Navigation
  { id: 'gps',         label: 'GPS (US)',          group: 'gps-ops',        orbitClass: 'MEO' },
  { id: 'glonass',     label: 'GLONASS (RU)',       group: 'glo-ops',        orbitClass: 'MEO' },
  { id: 'galileo',     label: 'Galileo (EU)',       group: 'galileo',        orbitClass: 'MEO' },
  { id: 'beidou',      label: 'BeiDou (CN)',        group: 'beidou',         orbitClass: 'MEO' },

  // Earth observation / weather
  { id: 'weather',     label: 'Weather',           group: 'weather',        orbitClass: 'LEO' },
  { id: 'earth-obs',   label: 'Earth Observation', group: 'resource',       orbitClass: 'LEO' },

  // Communications
  { id: 'geo-comm',    label: 'GEO Comms',         group: 'geo',            orbitClass: 'GEO' },

  // pLEO constellations — capped by default
  { id: 'starlink',    label: 'Starlink',          group: 'starlink',       orbitClass: 'LEO', isPLEO: true, defaultCap: 300 },
  { id: 'oneweb',      label: 'OneWeb',            group: 'oneweb',         orbitClass: 'LEO', isPLEO: true, defaultCap: 300 },

  // Scientific
  { id: 'science',     label: 'Scientific',        group: 'science',        orbitClass: 'LEO' },

  // Amateur
  { id: 'amateur',     label: 'Amateur',           group: 'amateur',        orbitClass: 'LEO' },

  // Military
  { id: 'military',    label: 'Military (US)',      group: 'military',       orbitClass: 'LEO' },
]

export const CATEGORY_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Demo', ids: ['sample'] },
  { label: 'Crewed', ids: ['iss'] },
  { label: 'Navigation', ids: ['gps', 'glonass', 'galileo', 'beidou'] },
  { label: 'Earth Observation', ids: ['weather', 'earth-obs'] },
  { label: 'Communications', ids: ['geo-comm', 'starlink', 'oneweb'] },
  { label: 'Scientific / Amateur', ids: ['science', 'amateur'] },
  { label: 'Military', ids: ['military'] },
]

export function getCategoryById(id: string): SatelliteCategory | undefined {
  return CATEGORIES.find((c) => c.id === id)
}
