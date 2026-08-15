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
    byIso2.set(iso2, { country, districts, stateOf })
  }

  const geoByIso2 = new Map<string, GeoCity[]>()
  for (const c of geo) {
    if (!geoByIso2.has(c.iso2)) geoByIso2.set(c.iso2, [])
    geoByIso2.get(c.iso2)!.push(c)
  }

  const selected: SelectedCity[] = []
  const unmatchedCities: { name: string; iso2: string; pop: number }[] = []

  for (const [iso2, cities] of geoByIso2) {
    const entry = byIso2.get(iso2)
    if (!entry) continue

    for (const city of pick(cities)) {
      const district = matchDistrict(city, entry.districts)
      if (!district) {
        unmatchedCities.push({ name: city.ascii, iso2, pop: city.pop })
        continue
      }
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

  // A district serving two selected cities would fetch the same page twice and
  // draw two dots on one timetable. Keep the larger city.
  const byIlceID = new Map<string, SelectedCity>()
  for (const c of selected.sort((a, b) => b.pop - a.pop)) {
    if (!byIlceID.has(c.ilceID)) byIlceID.set(c.ilceID, c)
  }
  const final = [...byIlceID.values()].sort((a, b) => a.n.localeCompare(b.n))

  mkdirSync('src/data', { recursive: true })
  writeFileSync('src/data/cities.json', JSON.stringify(final, null, 2))
  writeFileSync(
    'data/unmatched.json',
    JSON.stringify({ countries: unresolvedCountries, cities: unmatchedCities }, null, 2),
  )

  console.log(`selected ${final.length} cities across ${byIso2.size} countries`)
  console.log(`unmatched: ${unresolvedCountries.length} countries, ${unmatchedCities.length} cities`)
  console.log('review data/unmatched.json')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
