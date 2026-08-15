// Stage 1: build the full country -> state -> district tree.
//
//   npm run prayer:discover
//
// The dropdowns on the site are backed by an undocumented JSON endpoint:
//   /en-US/home/GetRegList?ChangeType=country&CountryId=13   -> states
//   /en-US/home/GetRegList?ChangeType=state&CountryId=13&StateId=850 -> districts
// The district payload includes IlceUrl, so no slug construction is needed.
//
// ~1,300 requests, ~11 minutes. IDs are stable, so this is run rarely; every
// later stage reads the cached tree.

import { mkdirSync, writeFileSync } from 'node:fs'
import { getText, getJson, mapPool } from './http.ts'

export interface DiyanetDistrict {
  ilceID: string
  name: string
  nameEn: string
  url: string
}

export interface DiyanetState {
  sehirID: string
  name: string
  nameEn: string
  districts: DiyanetDistrict[]
}

export interface DiyanetCountry {
  countryId: string
  name: string
  states: DiyanetState[]
}

export type DiyanetTree = DiyanetCountry[]

interface RegList {
  StateList: { SehirAdi: string; SehirAdiEn: string; SehirID: string }[] | null
  StateRegionList:
    | { IlceAdi: string; IlceAdiEn: string; IlceID: string; IlceUrl: string }[]
    | null
}

/** Any city page carries the full country dropdown. */
const SEED = '/en-US/9206/prayer-time-for-ankara'

/**
 * The dropdown HTML-escapes non-ASCII letters: Türkiye arrives as
 * `T&#220;RKİYE` and Curaçao as `CURA&#199;AO`. Left undecoded, Türkiye
 * normalises to `T220RKIYE`, matches no ISO country, and drops out of the city
 * list along with all 869 of its districts — the one country this app can
 * least afford to lose.
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

function parseCountries(html: string): { countryId: string; name: string }[] {
  const select = /<select[^>]*name="country"[\s\S]*?<\/select>/.exec(html)
  if (!select) throw new Error('country dropdown not found on the seed page')
  return [...select[0].matchAll(/<option value="(\d+)"[^>]*>([^<]+)<\/option>/g)].map((m) => ({
    countryId: m[1],
    name: decodeEntities(m[2].trim()),
  }))
}

async function statesOf(countryId: string): Promise<RegList['StateList']> {
  const res = await getJson<RegList>(
    `/en-US/home/GetRegList?ChangeType=country&CountryId=${countryId}`,
  )
  return res.StateList
}

async function districtsOf(countryId: string, stateId: string) {
  const res = await getJson<RegList>(
    `/en-US/home/GetRegList?ChangeType=state&CountryId=${countryId}&StateId=${stateId}`,
  )
  return res.StateRegionList ?? []
}

async function main() {
  const countries = parseCountries(await getText(SEED))
  console.log(`${countries.length} countries`)

  const tree: DiyanetTree = []
  for (const [i, country] of countries.entries()) {
    const states = (await statesOf(country.countryId)) ?? []
    const built = await mapPool(states, 3, async (s) => ({
      sehirID: s.SehirID,
      name: s.SehirAdi,
      nameEn: s.SehirAdiEn,
      districts: (await districtsOf(country.countryId, s.SehirID)).map((d) => ({
        ilceID: d.IlceID,
        name: d.IlceAdi,
        nameEn: d.IlceAdiEn,
        url: d.IlceUrl,
      })),
    }))
    tree.push({ ...country, states: built })

    const n = built.reduce((sum, s) => sum + s.districts.length, 0)
    console.log(`[${i + 1}/${countries.length}] ${country.name}: ${n} districts`)
  }

  mkdirSync('data', { recursive: true })
  writeFileSync('data/diyanet-tree.json', JSON.stringify(tree))

  const districts = tree.reduce(
    (sum, c) => sum + c.states.reduce((s, st) => s + st.districts.length, 0),
    0,
  )
  console.log(`\nwrote data/diyanet-tree.json — ${tree.length} countries, ${districts} districts`)
}

// Only crawl when run as a script. Without this guard, importing the module for
// its exported types or helpers kicks off a 28-minute crawl as a side effect.
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
