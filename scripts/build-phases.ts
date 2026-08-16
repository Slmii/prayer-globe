// Builds public/phases.json — every city's prayer boundaries as absolute
// instants, so the globe can colour all 723 dots from Diyanet instead of from
// the solar model.
//
//   npm run prayer:phases
//
// Why this exists at all: the per-city snapshots in public/times/ are 23 MB, and
// the tally needs *every* city's current prayer at once, every tick. Fetching
// 723 files to colour a bar is absurd, so the boundaries get flattened here into
// one file the app loads once.
//
// It is small because of two things. Only a slice of the 396 days on disk is
// published, and the instants are stored as deltas: consecutive boundaries sit
// a few hundred minutes apart, and those small repeated numbers compress
// roughly six times better than the absolute minute counts they are derived
// from (117 KB gzipped against 319 KB).
//
// The window is sized by the REFRESH INTERVAL, not by the scrubber. The
// scrubber only reaches +10 days, but this file is rebuilt solely when the
// scheduled workflow runs, and past its last day `phaseOf` returns null and
// every dot silently reverts to the solar model. At 30 days against a monthly
// cron it expired the same week its replacement was due, and a single failed
// run left the globe computed for a month. 45 days against a twice-monthly
// cron leaves about two weeks of slack, so a missed run is noticed and re-run
// long before anything degrades.
//
// Reads public/times/ but never writes to it — that directory belongs to the
// crawler.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

interface CityRow {
  n: string
  ilceID: string
}

interface SnapshotFile {
  tz: string
  days: Record<string, string[]>
}

/**
 * Days of boundaries to publish, measured from the first day on disk. Sized
 * against the twice-monthly refresh, not the +10-day scrubber — see above.
 */
const WINDOW = 45
/** fajr, sunrise, dhuhr, asr, maghrib, isha — the order the files use. */
const PER_DAY = 6

export interface PhasesFile {
  /** UTC minutes since the epoch at 00:00 on `from` — deltas are added to this. */
  base: number
  from: string
  days: number
  perDay: number
  /** ilceID -> [first instant, then deltas], in UTC minutes. */
  cities: Record<string, number[]>
}

/**
 * Minutes east of UTC for `tz` on `isoDate`, probed at midday.
 *
 * Same approach as the app's `offsetMinutesFor`, and for the same reason: a DST
 * transition happens in the small hours, so midday never lands on the boundary.
 */
function offsetMinutes(tz: string, isoDate: string): number {
  const probe = new Date(`${isoDate}T12:00:00Z`)
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(probe)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const m = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(name)
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function main() {
  const cities = JSON.parse(readFileSync('src/data/cities.json', 'utf8')) as CityRow[]

  // Start from the first day the snapshots actually cover, not from today: the
  // crawler decides the range, and guessing here would silently drop a day.
  const first = JSON.parse(
    readFileSync(`public/times/${cities[0].ilceID}.json`, 'utf8'),
  ) as SnapshotFile
  const from = Object.keys(first.days).sort()[0]
  const base = Math.floor(Date.parse(`${from}T00:00:00Z`) / 60000)

  const out: Record<string, number[]> = {}
  const skipped: string[] = []
  let shortest = Infinity

  for (const city of cities) {
    const path = `public/times/${city.ilceID}.json`
    if (!existsSync(path)) {
      skipped.push(city.n)
      continue
    }
    const file = JSON.parse(readFileSync(path, 'utf8')) as SnapshotFile

    const abs: number[] = []
    for (let k = 0; k < WINDOW; k++) {
      const date = addDays(from, k)
      const row = file.days[date]
      if (!row) break
      const offset = offsetMinutes(file.tz, date)
      const midnight = Math.floor(Date.parse(`${date}T00:00:00Z`) / 60000)
      for (let i = 0; i < PER_DAY; i++) {
        const t = row[i]
        const hh = Number(t.slice(0, 2))
        const mm = Number(t.slice(3, 5))
        abs.push(midnight + hh * 60 + mm - offset)
      }
    }

    // A day whose times run backwards would corrupt the binary search that reads
    // this, and would do it silently — so refuse to publish one.
    for (let i = 1; i < abs.length; i++) {
      if (abs[i] <= abs[i - 1]) {
        throw new Error(
          `${city.n} (${city.ilceID}): boundary ${i} is not after the one before ` +
            `(${abs[i]} <= ${abs[i - 1]})`,
        )
      }
    }

    shortest = Math.min(shortest, abs.length / PER_DAY)
    const deltas = [abs[0] - base]
    for (let i = 1; i < abs.length; i++) deltas.push(abs[i] - abs[i - 1])
    out[city.ilceID] = deltas
  }

  const doc: PhasesFile = {
    base,
    from,
    days: shortest === Infinity ? 0 : shortest,
    perDay: PER_DAY,
    cities: out,
  }
  writeFileSync('public/phases.json', JSON.stringify(doc))

  const kb = (readFileSync('public/phases.json').length / 1024).toFixed(0)
  console.log(`phases.json: ${Object.keys(out).length} cities, ${doc.days} days, ${kb} KB`)
  if (skipped.length) console.warn(`no snapshot for ${skipped.length}: ${skipped.slice(0, 5)}`)
}

main()
