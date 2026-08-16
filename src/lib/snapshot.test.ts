import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { offsetMinutesFor, toVakitRows } from './snapshot'
import type { SnapshotFile } from './snapshot'
import { buildTimetable } from './diyanet'

describe('offsetMinutesFor', () => {
  it('follows DST across the year', () => {
    expect(offsetMinutesFor('Europe/London', '2027-01-15')).toBe(0)
    expect(offsetMinutesFor('Europe/London', '2027-07-15')).toBe(60)
  })

  it('handles zones that never shift', () => {
    expect(offsetMinutesFor('Europe/Istanbul', '2027-01-15')).toBe(180)
    expect(offsetMinutesFor('Europe/Istanbul', '2027-07-15')).toBe(180)
  })

  it('handles negative and half-hour offsets', () => {
    expect(offsetMinutesFor('America/New_York', '2027-01-15')).toBe(-300)
    expect(offsetMinutesFor('Asia/Kolkata', '2027-01-15')).toBe(330)
  })

  it('returns 0 for UTC', () => {
    expect(offsetMinutesFor('UTC', '2027-01-15')).toBe(0)
  })
})

describe('toVakitRows', () => {
  const file = {
    ilceID: '13880',
    name: 'Emmen',
    tz: 'Europe/Amsterdam',
    days: {
      '2027-01-01': ['06:37', '08:38', '12:41', '14:15', '16:34', '18:21', '23 Recep 1448'],
      '2027-07-01': ['03:30', '05:25', '13:40', '17:50', '21:55', '23:30', '26 Muharrem 1449'],
    },
  } as const

  it('maps the compact row onto Diyanet field names', () => {
    const rows = toVakitRows(file as never)
    expect(rows[0].Imsak).toBe('06:37')
    expect(rows[0].Gunes).toBe('08:38')
    expect(rows[0].Ogle).toBe('12:41')
    expect(rows[0].Ikindi).toBe('14:15')
    expect(rows[0].Aksam).toBe('16:34')
    expect(rows[0].Yatsi).toBe('18:21')
    expect(rows[0].HicriTarihUzun).toBe('23 Recep 1448')
  })

  it('synthesizes the ISO date with the zone offset that day', () => {
    const rows = toVakitRows(file as never)
    expect(rows[0].MiladiTarihUzunIso8601).toBe('2027-01-01T00:00:00.0000000+01:00')
    expect(rows[1].MiladiTarihUzunIso8601).toBe('2027-07-01T00:00:00.0000000+02:00')
  })

  it('feeds buildTimetable so the app gets correct UTC instants', () => {
    const days = buildTimetable(toVakitRows(file as never), 0)
    expect(days).toHaveLength(2)
    expect(days[0].offsetMin).toBe(60)
    // 06:37 local at +01:00 is 05:37 UTC.
    expect(new Date(days[0].utc.fajr!).toISOString()).toBe('2027-01-01T05:37:00.000Z')
    expect(days[0].hijri).toBe('23 Recep 1448')
  })
})

/**
 * Everything above works on rows written by hand. This works on the files the
 * app actually ships.
 *
 * The two halves of this dataset are produced by different code at different
 * times — a Node crawler writes the JSON, the browser reads it — and the only
 * thing tying them together is an unwritten agreement about field order and
 * what `tz` means. A crawler that reordered the array, or tagged a city with the
 * wrong zone, would sail past every synthetic test here and simply show the
 * wrong prayer times. So this reads the real snapshots and checks the whole
 * chain end to end: published wall clock -> UTC instant -> back to wall clock in
 * that city's own timezone.
 */
describe('the shipped snapshots', () => {
  const load = (ilceID: string): SnapshotFile =>
    JSON.parse(readFileSync(`public/times/${ilceID}.json`, 'utf8')) as SnapshotFile

  /** What a clock in `tz` reads at instant `ms`. */
  const wallClock = (ms: number, tz: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms))

  // Chosen for the offsets that break naive conversion: DST in both
  // hemispheres, a 45-minute zone, a zone that never shifts, and cities far
  // enough west that the UTC date differs from the local one at fajr.
  const CASES: [string, string][] = [
    ['Berlin', 'Europe/Berlin'],
    ['Kathmandu', 'Asia/Kathmandu'],
    ['Adelaide', 'Australia/Adelaide'],
    ['Reykjavik', 'Atlantic/Reykjavik'],
    ['Los Angeles', 'America/Los_Angeles'],
    ['Alofi', 'Pacific/Niue'],
  ]

  const index = JSON.parse(readFileSync('public/times/index.json', 'utf8')) as Record<
    string,
    { ilceID: string }
  >

  for (const [city, tz] of CASES) {
    it(`round-trips ${city} through ${tz}`, () => {
      const entry = index[city]
      expect(entry, `${city} missing from index.json`).toBeTruthy()

      const file = load(entry.ilceID)
      expect(file.tz).toBe(tz)

      const days = buildTimetable(toVakitRows(file), 0)
      expect(days.length).toBeGreaterThan(300)

      // Sample across the year so both sides of any DST switch are covered.
      for (let i = 0; i < days.length; i += 17) {
        const day = days[i]
        const date = `${day.y}-${String(day.mo).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`
        const published = file.days[date]
        expect(published, `${city} has no published row for ${date}`).toBeTruthy()

        const order = ['fajr', 'rise', 'dhuhr', 'asr', 'set', 'isha'] as const
        order.forEach((key, k) => {
          const ms = day.utc[key]
          expect(ms, `${city} ${date} ${key} has no instant`).not.toBeNull()
          expect(wallClock(ms as number, tz), `${city} ${date} ${key}`).toBe(published[k])
        })
      }
    })
  }

  it('gives every city a snapshot whose id matches the index', () => {
    const cities = JSON.parse(readFileSync('src/data/cities.json', 'utf8')) as {
      n: string
      ilceID: string
    }[]
    for (const c of cities) {
      expect(index[c.n]?.ilceID, `${c.n} is not in index.json`).toBe(c.ilceID)
      expect(existsSync(`public/times/${c.ilceID}.json`), `${c.n} has no snapshot file`).toBe(true)
    }
  })

  it('keeps the prayers in ascending order through each day', () => {
    const file = load(index.Istanbul.ilceID)
    const days = buildTimetable(toVakitRows(file), 0)
    for (const day of days.slice(0, 120)) {
      const seq = [day.utc.fajr, day.utc.rise, day.utc.dhuhr, day.utc.asr, day.utc.set, day.utc.isha]
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i], `${day.gregorian} step ${i}`).toBeGreaterThan(seq[i - 1] as number)
      }
    }
  })
})
