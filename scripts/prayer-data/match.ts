// Diyanet names cities in a mix of English and Turkish transliteration; the
// dropdown holds "NETHERLANDS" but the state under it is "HOLLANDA", and Mecca
// appears as MECCA, MEKKE or MAKKAH depending on where you look.
//
// normalize() already folds diacritics and the Turkish dotted I for the live
// app, so it is reused here rather than reimplemented.

import { normalize } from '../../src/lib/diyanet.ts'
import type { DiyanetDistrict } from './discover.ts'
import type { GeoCity } from './geonames.ts'

/**
 * Diyanet spellings that Intl.DisplayNames will never produce — mostly Turkish
 * names, plus English variants ICU renders differently ("Czechia" for CZECH
 * REPUBLIC, "Myanmar (Burma)" for MYANMAR).
 *
 * Deliberately absent, because each would double-book an ISO2 already claimed
 * by another Diyanet country, silently dropping one of the pair:
 *   KUDUS (Jerusalem)  — FILISTIN already takes PS
 *   UKRAINE-KRYM       — UKRAINE already takes UA
 * Also absent are the entries that are not countries at all: ATLANTIC OCEAN
 * (10,043 districts of open water) and ASCENSION.
 */
const COUNTRY_OVERRIDES: Record<string, string> = {
  BUTAN: 'BT',
  CAD: 'TD',
  'CZECH REPUBLIC': 'CZ',
  CIBUTI: 'DJ',
  'DEMOKRATIC REPUBLIC OF THE CONGO': 'CD',
  'DOGU TIMOR': 'TL',
  DOMINIK: 'DM',
  'DOMINIK CUMHURIYETI': 'DO',
  EKVATOR: 'EC',
  'EKVATOR GINESI': 'GQ',
  ERITRE: 'ER',
  ESTONYA: 'EE',
  'FILDISI SAHILI': 'CI',
  FILISTIN: 'PS',
  GAMBIYA: 'GM',
  GRONLAND: 'GL',
  GUADELOPE: 'GP',
  'GUAM ISLAND': 'GU',
  'HONG KONG': 'HK',
  IZLANDA: 'IS',
  JAMAIKA: 'JM',
  KAMBOCYA: 'KH',
  KARADAG: 'ME',
  KATAR: 'QA',
  KIRGIZHSTAN: 'KG',
  KOLOMBIYA: 'CO',
  KOMORLAR: 'KM',
  KOSOVA: 'XK',
  KOSTARIKA: 'CR',
  'NORTH CYPRUS': 'CY',
  LESOTO: 'LS',
  LIBERYA: 'LR',
  MADAGASKAR: 'MG',
  MAKAO: 'MO',
  MACEDONIA: 'MK',
  MALAVI: 'MW',
  MALDIVLER: 'MV',
  'MAN ISLAND': 'IM',
  MARTINIK: 'MQ',
  'MAURITIUS ADASI': 'MU',
  MIKRONEZYA: 'FM',
  MOLDAVYA: 'MD',
  'MONTSERRAT UK': 'MS',
  MORITANYA: 'MR',
  MOZAMBIK: 'MZ',
  MYANMAR: 'MM',
  NAMIBYA: 'NA',
  NIJER: 'NE',
  NIKARAGUA: 'NI',
  'ORTA AFRIKA CUMHURIYETI': 'CF',
  'PAPUA YENI GINE': 'PG',
  'PITCAIRN ADASI': 'PN',
  RUANDA: 'RW',
  'SEYSEL ADALARI': 'SC',
  SIRBISTAN: 'RS',
  SURINAM: 'SR',
  SVALBARD: 'SJ',
  TANZANYA: 'TZ',
  'TRINIDAT VE TOBAGO': 'TT',
  TUNUSIA: 'TN',
  UMMAN: 'OM',
  VATIKAN: 'VA',
  'YENI KALEDONYA': 'NC',
  'YESIL BURUN': 'CV',
  ZAMBIYA: 'ZM',
  ZIMBABVE: 'ZW',
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

/**
 * Codes ISO has withdrawn or exceptionally reserved, which `Intl.DisplayNames`
 * still resolves to the SAME English name as the code actually in use. Left in,
 * they collide: "France" resolves for both FR and FX, "Russia" for RU and SU,
 * and so on. The collision is silent and worse than a miss — `countryIso2`
 * returns a plausible code that matches nothing in GeoNames, so the country
 * disappears from the output without ever appearing in the unmatched report.
 */
const DEPRECATED_ISO2 = new Set([
  'AN', // Netherlands Antilles  -> CW
  'BU', // Burma                 -> MM
  'CS', // Serbia and Montenegro -> RS
  'DD', // East Germany          -> DE
  'DY', // Dahomey               -> BJ
  'FX', // France, Metropolitan  -> FR
  'HV', // Upper Volta           -> BF
  'NH', // New Hebrides          -> VU
  'RH', // Southern Rhodesia     -> ZW
  'SU', // Soviet Union          -> RU
  'TP', // East Timor            -> TL
  'UK', // reserved for the UK   -> GB
  'VD', // North Vietnam         -> VN
  'YD', // Democratic Yemen      -> YE
  'YU', // Yugoslavia            -> RS
  'ZR', // Zaire                 -> CD
])

/**
 * ISO2 -> normalised English name, built once from the runtime's own data.
 *
 * With every withdrawn code excluded, each name maps to exactly one live code
 * and iteration order stops mattering. If a future ICU update introduces a new
 * alias, this throws at load rather than silently picking one — the failure
 * mode we are guarding against is a country vanishing from the output while
 * `countryIso2` still returns a plausible-looking code.
 */
const BY_ENGLISH_NAME: Map<string, string> = (() => {
  const display = new Intl.DisplayNames(['en'], { type: 'region' })
  const map = new Map<string, string>()
  const collisions: string[] = []
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const iso2 = String.fromCharCode(a, b)
      if (DEPRECATED_ISO2.has(iso2)) continue
      let name: string | undefined
      try {
        name = display.of(iso2)
      } catch {
        continue
      }
      // Unknown codes echo themselves back.
      if (!name || name === iso2) continue
      const key = normalize(name)
      const existing = map.get(key)
      if (existing) collisions.push(`${name}: ${existing} and ${iso2}`)
      else map.set(key, iso2)
    }
  }
  if (collisions.length) {
    throw new Error(
      `ambiguous ISO2 names, add the withdrawn code to DEPRECATED_ISO2:\n  ${collisions.join('\n  ')}`,
    )
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
/**
 * Comparable forms of one name. Diyanet qualifies many districts
 * parenthetically, and the parenthesis carries different information each time:
 *
 *   "SAO PAULO (S.P.)"   the state code is noise — strip it
 *   "BUKRES(bucharest)"  the English name is INSIDE the parens — keep it
 *   "ADAMCLISI "         trailing space, which normalize() does not trim
 *
 * Each of these silently cost us a city, São Paulo (12.4M) among them, so all
 * three forms are generated and any one may match.
 */
function keys(s: string): string[] {
  const out = new Set<string>()
  const add = (v: string) => {
    const k = normalize(v).trim().replace(/\s+/g, ' ')
    if (k) out.add(k)
  }
  add(s)
  add(s.replace(/\([^)]*\)/g, ' '))
  const inner = /\(([^)]+)\)/.exec(s)
  if (inner) add(inner[1])
  return [...out]
}

const districtKeys = (d: DiyanetDistrict): string[] => [...keys(d.nameEn), ...keys(d.name)]

export function matchDistrict(
  city: GeoCity,
  districts: DiyanetDistrict[],
): DiyanetDistrict | null {
  const exact = new Set([...keys(city.name), ...keys(city.ascii)])

  for (const d of districts) {
    if (districtKeys(d).some((k) => exact.has(k))) return d
  }

  const alt = new Set(city.alt.flatMap(keys))
  if (!alt.size) return null

  for (const d of districts) {
    if (districtKeys(d).some((k) => alt.has(k))) return d
  }
  return null
}
