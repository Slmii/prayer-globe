// Diyanet names cities in a mix of English and Turkish transliteration; the
// dropdown holds "NETHERLANDS" but the state under it is "HOLLANDA", and Mecca
// appears as MECCA, MEKKE or MAKKAH depending on where you look.
//
// normalize() already folds diacritics and the Turkish dotted I for the live
// app, so it is reused here rather than reimplemented.

import { normalize } from '../../src/lib/diyanet.ts'
import type { DiyanetDistrict } from './discover.ts'
import type { GeoCity } from './geonames.ts'

/** Diyanet spellings that Intl.DisplayNames will never produce. */
const COUNTRY_OVERRIDES: Record<string, string> = {
  USA: 'US',
  HOLLANDA: 'NL',
  INGILTERE: 'GB',
  ALMANYA: 'DE',
  'S ARABISTAN': 'SA',
  'SUUDI ARABISTAN': 'SA',
  KKTC: 'CY',
  BOLIVYA: 'BO',
  'ANTIGUA VE BARBUDA': 'AG',
  'BOSNIAHERZEGOVINA': 'BA',
  'BOSNAHERSEK': 'BA',
  MACARISTAN: 'HU',
  YUNANISTAN: 'GR',
  ISVICRE: 'CH',
  ISVEC: 'SE',
  RUSYA: 'RU',
  MISIR: 'EG',
  URDUN: 'JO',
  IRAK: 'IQ',
  IRAN: 'IR',
  CIN: 'CN',
  HINDISTAN: 'IN',
  JAPONYA: 'JP',
  KANADA: 'CA',
  BREZILYA: 'BR',
  ARJANTIN: 'AR',
  'GUNEY AFRIKA': 'ZA',
  'CEK CUMHURIYETI': 'CZ',
  TURKIYE: 'TR',
}

/** ISO2 -> normalised English name, built once from the runtime's own data. */
const BY_ENGLISH_NAME: Map<string, string> = (() => {
  const display = new Intl.DisplayNames(['en'], { type: 'region' })
  const map = new Map<string, string>()
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const iso2 = String.fromCharCode(a, b)
      let name: string | undefined
      try {
        name = display.of(iso2)
      } catch {
        continue
      }
      // Unknown codes echo themselves back.
      if (!name || name === iso2) continue
      map.set(normalize(name), iso2)
    }
  }
  return map
})()

export function countryIso2(diyanetName: string): string | null {
  const key = normalize(diyanetName)
  return COUNTRY_OVERRIDES[key] ?? BY_ENGLISH_NAME.get(key) ?? null
}

/**
 * Match one GeoNames city to a district from the *same country's* list. Exact
 * names are tried across every district before alternate names are considered,
 * so "Mecca" prefers a district actually called MECCA over one called MAKKAH.
 */
export function matchDistrict(
  city: GeoCity,
  districts: DiyanetDistrict[],
): DiyanetDistrict | null {
  const exact = new Set([normalize(city.name), normalize(city.ascii)])
  exact.delete('')

  for (const d of districts) {
    if (exact.has(normalize(d.nameEn)) || exact.has(normalize(d.name))) return d
  }

  const alt = new Set(city.alt.map(normalize))
  alt.delete('')
  if (!alt.size) return null

  for (const d of districts) {
    if (alt.has(normalize(d.nameEn)) || alt.has(normalize(d.name))) return d
  }
  return null
}
