// Stage 2: decide which cities the globe shows. Touches no Diyanet endpoint —
// it reads the cached tree from stage 1.
//
//   npm run prayer:select              # capital + top 5 per country
//   npm run prayer:select -- --per 10  # capital + top 10
//
// Everything that fails to match is written to data/unmatched.json rather than
// guessed at. A city with no Diyanet district must not reach the globe: the app
// promises Diyanet times for every dot it draws.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { loadGeoNames } from './geonames.ts'
import type { GeoCity } from './geonames.ts'
import { countryIso2, matchDistrict } from './match.ts'
import type { DiyanetTree, DiyanetDistrict } from './discover.ts'

export interface SelectedCity {
  n: string
  la: number
  lo: number
  tz: string
  iso2: string
  country: string
  pop: number
  ilceID: string
  ilceUrl: string
  /** Diyanet CountryId — kept so the live-API fallback still resolves. */
  u: number
  p: string
  d: string[]
}

/** Biggest N misses per country kept in the report; the rest are noise. */
const UNMATCHED_REPORTED = 5

/**
 * ISO2 codes the globe does not show, regardless of what Diyanet publishes.
 * A product decision, not a data one — Diyanet lists these districts and the
 * crawler could fetch them perfectly well.
 */
const EXCLUDED_ISO2 = new Set([
  'IL', // Palestinian territories (FILISTIN) are shown instead.
])

/**
 * Cities that ship regardless of population, because something on the globe
 * depends on them existing.
 *
 * A 3D mosque model *replaces* its city's dot, so it has nowhere to stand if
 * that city was not selected — the model silently never renders and the console
 * carries an `unknown city` warning nobody reads. Both entries here were found
 * exactly that way.
 *
 * `matchIn` covers a city GeoNames files under one country and Diyanet under
 * another. `ilceID` pins the district outright, for the case where the two
 * sources' spellings are too far apart to match.
 */
interface RequiredCity {
  /** GeoNames ascii name. */
  name: string
  /** The ISO2 GeoNames files it under. */
  geoIso2: string
  /** Whose districts to match against, when that differs. */
  matchIn?: string
  /** Pinned district, when name matching cannot bridge the spellings. */
  ilceID?: string
  why: string
}

const REQUIRED_CITIES: RequiredCity[] = [
  {
    name: 'Jerusalem',
    geoIso2: 'IL',
    matchIn: 'PS',
    why: 'Al-Aqsa has a 3D model; Diyanet lists it as KUDUS under FILISTIN',
  },
  {
    name: 'Samarkand',
    geoIso2: 'UZ',
    ilceID: '15762',
    why: 'Bibi-Khanym has a 3D model; Diyanet spells it SEMERKAND, which no GeoNames alternate name reaches',
  },
]

const perCountryArg = process.argv.indexOf('--per')
const PER_COUNTRY = perCountryArg > -1 ? Number(process.argv[perCountryArg + 1]) : 5

function pick(cities: GeoCity[]): GeoCity[] {
  const byPop = [...cities].sort((a, b) => b.pop - a.pop)
  const chosen = byPop.filter((c) => c.featureCode === 'PPLC').slice(0, 1)
  for (const c of byPop) {
    if (chosen.length >= PER_COUNTRY + 1) break
    if (!chosen.includes(c)) chosen.push(c)
  }
  return chosen
}

/**
 * Make display names unique.
 *
 * `public/times/index.json` is keyed by display name, and the app looks a city
 * up by `city.n`. Five names are genuinely shared by two countries — Barcelona
 * (ES/VE), Valencia (VE/ES), Tripoli (LY/LB), Victoria (HK/SC), Hamilton
 * (NZ/BM) — so an unqualified key silently resolved both dots to one ilceID and
 * showed one city the other's prayer times. Wrong data, not missing data.
 *
 * Both members of a collision are suffixed, not just the smaller one: leaving
 * one bare would make the naming flip if the populations ever reordered.
 */
export function disambiguate<T extends { n: string; iso2: string }>(cities: T[]): T[] {
  const counts = new Map<string, number>()
  for (const c of cities) counts.set(c.n, (counts.get(c.n) ?? 0) + 1)
  return cities.map((c) => (counts.get(c.n)! > 1 ? { ...c, n: `${c.n} (${c.iso2})` } : c))
}

async function main() {
  const tree = JSON.parse(readFileSync('data/diyanet-tree.json', 'utf8')) as DiyanetTree
  const geo = await loadGeoNames()

  // Diyanet country -> ISO2, and the flattened district list for that country.
  const byIso2 = new Map<string, { country: DiyanetTree[number]; districts: DiyanetDistrict[]; stateOf: Map<string, string> }>()
  const unresolvedCountries: string[] = []

  for (const country of tree) {
    const iso2 = countryIso2(country.name)
    if (!iso2) {
      unresolvedCountries.push(country.name)
      continue
    }
    const districts: DiyanetDistrict[] = []
    const stateOf = new Map<string, string>()
    for (const state of country.states) {
      for (const d of state.districts) {
        districts.push(d)
        stateOf.set(d.ilceID, state.name)
      }
    }
    // Two Diyanet countries resolving to one ISO2 would silently drop whichever
    // lost the race, with no entry in the unmatched report to show for it.
    const claimed = byIso2.get(iso2)
    if (claimed) {
      throw new Error(
        `${iso2} claimed by both "${claimed.country.name}" and "${country.name}" — ` +
          `remove one from COUNTRY_OVERRIDES in match.ts`,
      )
    }
    byIso2.set(iso2, { country, districts, stateOf })
  }

  const geoByIso2 = new Map<string, GeoCity[]>()
  for (const c of geo) {
    if (!geoByIso2.has(c.iso2)) geoByIso2.set(c.iso2, [])
    geoByIso2.get(c.iso2)!.push(c)
  }

  const selected: SelectedCity[] = []
  const unmatchedCities: { name: string; iso2: string; pop: number }[] = []
  // GeoNames ISO2 codes with no Diyanet country mapping. unresolvedCountries
  // records the opposite direction (Diyanet names that would not resolve), so
  // without this these vanish from every report.
  const countriesWithoutDiyanet: { iso2: string; pop: number }[] = []

  for (const [iso2, cities] of geoByIso2) {
    if (EXCLUDED_ISO2.has(iso2)) continue

    const entry = byIso2.get(iso2)
    if (!entry) {
      countriesWithoutDiyanet.push({ iso2, pop: Math.max(...cities.map((c) => c.pop)) })
      continue
    }

    // Match FIRST, pick second. Picking the biggest six and then asking whether
    // Diyanet has them spends slots on cities it never publishes: Thailand's
    // top six by population are Bangkok plus four Bangkok suburbs, so four
    // slots died and Chiang Mai — which Diyanet does publish — was never even
    // considered. Matching first and then taking the biggest six of what
    // matched costs nothing and gained 175 cities.
    const matched: { city: GeoCity; district: DiyanetDistrict }[] = []
    const missed: GeoCity[] = []
    for (const city of cities) {
      const district = matchDistrict(city, entry.districts)
      if (district) matched.push({ city, district })
      else missed.push(city)
    }

    // Every GeoNames city is now tested, so reporting all the misses would bury
    // the report in ~30,000 rows. Only the biggest few per country are worth a
    // human's attention — those are the ones a missing district actually costs.
    for (const city of missed.sort((a, b) => b.pop - a.pop).slice(0, UNMATCHED_REPORTED)) {
      unmatchedCities.push({ name: city.ascii, iso2, pop: city.pop })
    }

    const chosen = pick(matched.map((m) => m.city))
    const districtOf = new Map(matched.map((m) => [m.city, m.district]))

    for (const city of chosen) {
      const district = districtOf.get(city)!
      selected.push({
        n: city.ascii,
        la: Number(city.lat.toFixed(4)),
        lo: Number(city.lon.toFixed(4)),
        tz: city.tz,
        iso2,
        country: entry.country.name,
        pop: city.pop,
        ilceID: district.ilceID,
        ilceUrl: district.url,
        u: Number(entry.country.countryId),
        p: entry.stateOf.get(district.ilceID) ?? '',
        d: [district.nameEn || district.name],
      })
    }
  }

  // Pull in the cities something else on the globe depends on, which the
  // population cut would otherwise drop. Runs before the ilceID dedup, so a
  // required city competing with a larger one for a district still loses
  // honestly rather than producing two dots on one timetable.
  for (const req of REQUIRED_CITIES) {
    const city = geo.find((c) => c.ascii === req.name && c.iso2 === req.geoIso2)
    if (!city) throw new Error(`required city ${req.name} (${req.geoIso2}) is not in GeoNames`)

    const hostIso2 = req.matchIn ?? req.geoIso2
    const entry = byIso2.get(hostIso2)
    if (!entry) throw new Error(`required city ${req.name} wants ${hostIso2}, which has no Diyanet country`)

    const district = req.ilceID
      ? entry.districts.find((d) => d.ilceID === req.ilceID)
      : matchDistrict(city, entry.districts)
    if (!district) {
      throw new Error(
        `required city ${req.name} matched no district in ${hostIso2} — ${req.why}`,
      )
    }

    if (selected.some((c) => c.ilceID === district.ilceID)) continue
    selected.push({
      n: city.ascii,
      la: Number(city.lat.toFixed(4)),
      lo: Number(city.lon.toFixed(4)),
      tz: city.tz,
      iso2: hostIso2,
      country: entry.country.name,
      // Ranked above the population cut so the dedup below never discards it.
      pop: city.pop,
      ilceID: district.ilceID,
      ilceUrl: district.url,
      u: Number(entry.country.countryId),
      p: entry.stateOf.get(district.ilceID) ?? '',
      d: [district.nameEn || district.name],
    })
  }

  // A district serving two selected cities would fetch the same page twice and
  // draw two dots on one timetable. Keep the larger city — but the discarded
  // one must still be reported, or it vanishes from the globe with no trace.
  const byIlceID = new Map<string, SelectedCity>()
  const duplicates: { name: string; iso2: string; pop: number; ilceID: string; keptName: string }[] = []
  for (const c of selected.sort((a, b) => b.pop - a.pop)) {
    const kept = byIlceID.get(c.ilceID)
    if (!kept) {
      byIlceID.set(c.ilceID, c)
    } else {
      duplicates.push({ name: c.n, iso2: c.iso2, pop: c.pop, ilceID: c.ilceID, keptName: kept.n })
    }
  }
  const final = disambiguate([...byIlceID.values()]).sort((a, b) => a.n.localeCompare(b.n))

  countriesWithoutDiyanet.sort((a, b) => b.pop - a.pop)

  mkdirSync('src/data', { recursive: true })
  writeFileSync('src/data/cities.json', JSON.stringify(final, null, 2))
  writeFileSync(
    'data/unmatched.json',
    JSON.stringify(
      { countries: unresolvedCountries, cities: unmatchedCities, duplicates, countriesWithoutDiyanet },
      null,
      2,
    ),
  )

  console.log(`selected ${final.length} cities across ${byIso2.size} countries`)
  console.log(
    `unmatched: ${unresolvedCountries.length} countries, ${unmatchedCities.length} cities, ` +
      `${duplicates.length} duplicate-district cities, ${countriesWithoutDiyanet.length} countries without Diyanet`,
  )
  console.log('review data/unmatched.json')
}

// Only select when run as a script, so tests can import the helpers above.
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
