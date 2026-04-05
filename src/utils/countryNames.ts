export const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', RU: 'Russia', CN: 'China', FR: 'France',
  UK: 'United Kingdom', JPN: 'Japan', IND: 'India', ESA: 'European Space Agency',
  GER: 'Germany', IT: 'Italy', CAN: 'Canada', AU: 'Australia',
  ISRA: 'Israel', BRAZ: 'Brazil', KAZ: 'Kazakhstan', UKR: 'Ukraine',
  SPAN: 'Spain', TURK: 'Turkey', SAUD: 'Saudi Arabia', UAE: 'UAE',
  IRID: 'Iridium', GLOB: 'Globalstar', ITSO: 'Intelsat', SES: 'SES',
  EUME: 'EUMETSAT', EUTS: 'Eutelsat', IM: 'Inmarsat', NATO: 'NATO',
  INT: 'International', CIS: 'CIS (former USSR)', UNK: 'Unknown',
  UNKN: 'Unknown', SWED: 'Sweden', NOR: 'Norway', DEN: 'Denmark',
  FIN: 'Finland', NETH: 'Netherlands', PAKI: 'Pakistan', IRAN: 'Iran',
  SAFR: 'South Africa', NIIG: 'Nigeria', EGYP: 'Egypt', VENZ: 'Venezuela',
  ARG: 'Argentina', INDO: 'Indonesia', THAI: 'Thailand', SING: 'Singapore',
  MLA: 'Malaysia', VIET: 'Vietnam', QAT: 'Qatar', PRC: 'China',
  O3B: 'O3b Networks', SEAL: 'Sea Launch', LUXE: 'Luxembourg',
  BGDT: 'Bangladesh', MEX: 'Mexico', COL: 'Colombia', PER: 'Peru',
}

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code
}
