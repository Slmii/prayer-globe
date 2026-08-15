// Stage 3: one plain GET per city, parsed into public/times/.
//
//   npm run prayer:fetch                  # every selected city
//   npm run prayer:fetch -- --only London # just these
//   npm run prayer:fetch -- --prune       # also drop days older than 2 days
//
// A run yields the rolling ~31-day window plus all 365 days of the published
// next year. Writes MERGE: each run contributes a different 30 days, and
// Diyanet serves no archive, so overwriting would permanently narrow the
// snapshot to whatever the last run happened to see.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getText, mapPool, BlockedError } from './http.ts'
import { parseCityPage } from './parse-page.ts'
import { CITIES } from '../../src/lib/cities.ts'
import type { City } from '../../src/lib/cities.ts'

export type SnapshotDay = [string, string, string, string, string, string, string]

export interface SnapshotFile {
  ilceID: string
  name: string
  tz: string
  /** ISO date -> [fajr, sunrise, dhuhr, asr, maghrib, isha, hijri] */
  days: Record<string, SnapshotDay>
}

const OUT = 'public/times'
const STATE = 'data/fetch-state.json'
/** Yesterday is still needed: a city at UTC-11 is on the previous local date. */
const KEEP_DAYS_BACK = 2

const args = process.argv.slice(2)
const prune = args.includes('--prune')
const onlyIdx = args.indexOf('--only')
const only = onlyIdx > -1 ? args.slice(onlyIdx + 1).filter((a) => !a.startsWith('--')) : []

/** A stable id for this run, so resume never spans two different runs. */
const RUN_ID = new Date().toISOString().slice(0, 13)

interface RunState {
  runId: string
  done: string[]
}

function loadState(): RunState {
  if (!existsSync(STATE)) return { runId: RUN_ID, done: [] }
  const prev = JSON.parse(readFileSync(STATE, 'utf8')) as RunState
  return prev.runId === RUN_ID ? prev : { runId: RUN_ID, done: [] }
}

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function merge(city: City, fresh: SnapshotFile['days']): SnapshotFile {
  const path = join(OUT, `${city.ilceID}.json`)
  let days: SnapshotFile['days'] = {}
  if (existsSync(path)) {
    try {
      days = (JSON.parse(readFileSync(path, 'utf8')) as SnapshotFile).days ?? {}
    } catch {
      days = {}
    }
  }

  // Fresh wins, so a Diyanet correction propagates.
  Object.assign(days, fresh)

  if (prune) {
    const floor = isoDaysAgo(KEEP_DAYS_BACK)
    for (const date of Object.keys(days)) if (date < floor) delete days[date]
  }

  const sorted: SnapshotFile['days'] = {}
  for (const date of Object.keys(days).sort()) sorted[date] = days[date]

  return { ilceID: city.ilceID, name: city.n, tz: city.tz, days: sorted }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  mkdirSync('data', { recursive: true })

  const state = loadState()
  const done = new Set(state.done)
  const targets = (only.length ? CITIES.filter((c) => only.includes(c.n)) : CITIES).filter(
    (c) => !done.has(c.ilceID),
  )

  if (only.length && !targets.length && !done.size) {
    throw new Error(`no city matched ${only.join(', ')}`)
  }
  console.log(`${targets.length} cities to fetch (${done.size} already done this run)`)

  const failures: { city: string; reason: string }[] = []
  let n = 0

  await mapPool(targets, 3, async (city) => {
    try {
      const html = await getText(city.ilceUrl)
      const parsed = parseCityPage(html)

      const fresh: SnapshotFile['days'] = {}
      for (const day of parsed) {
        fresh[day.date] = [...day.times, day.hijri] as SnapshotDay
      }

      writeFileSync(
        join(OUT, `${city.ilceID}.json`),
        JSON.stringify(merge(city, fresh)),
      )

      done.add(city.ilceID)
      writeFileSync(STATE, JSON.stringify({ runId: RUN_ID, done: [...done] }))
    } catch (err) {
      if (err instanceof BlockedError) throw err
      failures.push({ city: city.n, reason: String(err) })
    }
    if (++n % 50 === 0) console.log(`  ${n}/${targets.length}`)
  })

  // The index the app uses to go from city name to snapshot file.
  const index: Record<string, { ilceID: string; districtName: string; provinceName: string }> = {}
  for (const c of CITIES) {
    if (existsSync(join(OUT, `${c.ilceID}.json`))) {
      index[c.n] = { ilceID: c.ilceID, districtName: c.d[0], provinceName: c.p ?? '' }
    }
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2))

  console.log(`\n${Object.keys(index).length} cities in the snapshot`)
  if (failures.length) {
    console.log(`${failures.length} failures:`)
    for (const f of failures.slice(0, 20)) console.log(`  ${f.city}: ${f.reason}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
