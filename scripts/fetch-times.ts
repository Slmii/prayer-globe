// Build-time crawler: snapshots Diyanet prayer times for every city in
// cities.ts into public/times/, so the running app makes no upstream calls at
// all and can never be rate-limited.
//
//   npm run fetch-times              # all cities, resumes where it left off
//   npm run fetch-times -- Istanbul London   # just these
//   npm run fetch-times -- --force   # re-fetch even if already on disk
//
// The upstream limit is ~100 requests per 15 minutes per IP, so this paces
// itself and backs off hard on 429. A full run takes roughly 45 minutes; it is
// resumable, so interrupting it is safe. /vakitler only returns ~32 days, so
// re-run it monthly (a cron job or CI schedule is enough).

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CITIES } from '../src/lib/cities.ts'
import type { City } from '../src/lib/cities.ts'
import { chooseProvince, chooseDistrict } from '../src/lib/diyanet.ts'
import type { Province, District, VakitRow } from '../src/lib/diyanet.ts'

const BASE = 'https://ezanvakti.emushaf.net'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'times')

// Stay comfortably under 100 requests / 15 min.
const BUDGET = 90
const WINDOW_MS = 15 * 60 * 1000

const args = process.argv.slice(2)
const force = args.includes('--force')
const only = args.filter((a) => !a.startsWith('--'))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let spent = 0
let windowStart = Date.now()

/** Paced GET with hard backoff on 429. */
async function get<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const elapsed = Date.now() - windowStart
    if (elapsed > WINDOW_MS) {
      windowStart = Date.now()
      spent = 0
    }
    if (spent >= BUDGET) {
      const wait = WINDOW_MS - elapsed + 5000
      console.log(`  · budget reached, waiting ${Math.ceil(wait / 60000)}m`)
      await sleep(wait)
      windowStart = Date.now()
      spent = 0
    }

    spent++
    try {
      const res = await fetch(BASE + path)
      if (res.ok) return (await res.json()) as T
      if (res.status === 429) {
        console.log('  · 429, backing off 5m')
        await sleep(5 * 60 * 1000)
        windowStart = Date.now()
        spent = 0
        continue
      }
      console.warn(`  · ${path} → HTTP ${res.status}`)
      return null
    } catch (err) {
      await sleep(2000 * (attempt + 1))
    }
  }
  return null
}

interface IndexEntry {
  ilceID: string
  districtName: string
  provinceName: string
}

const indexPath = join(OUT, 'index.json')
mkdirSync(OUT, { recursive: true })

const index: Record<string, IndexEntry> = existsSync(indexPath)
  ? JSON.parse(readFileSync(indexPath, 'utf8'))
  : {}

// Province and district lists are shared per country — fetch each at most once.
const provinceCache = new Map<number, Province[] | null>()
const districtCache = new Map<string, District[] | null>()

async function resolve(city: City): Promise<IndexEntry | null> {
  if (!force && index[city.n]) return index[city.n]

  if (!provinceCache.has(city.u)) provinceCache.set(city.u, await get<Province[]>(`/sehirler/${city.u}`))
  const province = chooseProvince(provinceCache.get(city.u) ?? [], city)
  if (!province) return null

  if (!districtCache.has(province.SehirID)) {
    districtCache.set(province.SehirID, await get<District[]>(`/ilceler/${province.SehirID}`))
  }
  const district = chooseDistrict(districtCache.get(province.SehirID) ?? [], city)
  if (!district) return null

  return {
    ilceID: district.IlceID,
    districtName: district.IlceAdiEn || district.IlceAdi,
    provinceName: province.SehirAdiEn || province.SehirAdi,
  }
}

const targets = only.length ? CITIES.filter((c) => only.includes(c.n)) : CITIES
if (only.length && targets.length !== only.length) {
  const missing = only.filter((n) => !CITIES.some((c) => c.n === n))
  console.warn(`unknown cities ignored: ${missing.join(', ')}`)
}

console.log(`fetching ${targets.length} cities into ${OUT}`)
let resolved = 0
let skipped = 0
let missing = 0

for (const city of targets) {
  const entry = await resolve(city)
  if (!entry) {
    console.log(`✗ ${city.n} — no Diyanet district`)
    missing++
    continue
  }
  index[city.n] = entry

  const file = join(OUT, `${entry.ilceID}.json`)
  if (!force && existsSync(file)) {
    skipped++
    resolved++
    continue
  }

  const rows = await get<VakitRow[]>(`/vakitler/${entry.ilceID}`)
  if (!rows?.length) {
    console.log(`✗ ${city.n} — no timetable`)
    missing++
    continue
  }
  writeFileSync(file, JSON.stringify(rows))
  writeFileSync(indexPath, JSON.stringify(index, null, 2))
  resolved++
  console.log(`✓ ${city.n} → ${entry.districtName} (${entry.ilceID}) · ${rows.length} days`)
}

writeFileSync(indexPath, JSON.stringify(index, null, 2))
console.log(`\ndone · ${resolved} resolved (${skipped} already cached) · ${missing} unavailable`)
