import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodePhases, phaseOf, blendOf } from './phases'
import type { PhasesFile } from './phases'
import { phaseAt, skyState, solarTable } from './astro'
import { CITIES } from './cities'

const file = JSON.parse(readFileSync('public/phases.json', 'utf8')) as PhasesFile
const table = decodePhases(file)

const idOf = (name: string) => {
  const c = CITIES.find((x) => x.n === name)
  if (!c) throw new Error(`no city ${name}`)
  return c
}

/** The instant a wall clock in `tz` reads `HH:MM` on `date`. */
function at(date: string, hhmm: string, tz: string): number {
  // Probe with a guessed offset, then correct using what that instant actually
  // reads in the zone — one pass is enough for any real offset.
  const guess = Date.parse(`${date}T${hhmm}:00Z`)
  const shown = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(guess))
  const [h, m] = shown.split(':').map(Number)
  const [wantH, wantM] = hhmm.split(':').map(Number)
  let drift = (h * 60 + m - (wantH * 60 + wantM)) % 1440
  if (drift > 720) drift -= 1440
  if (drift < -720) drift += 1440
  return guess - drift * 60000
}

describe('decodePhases', () => {
  it('recovers ascending absolute minutes', () => {
    for (const id of Object.keys(file.cities).slice(0, 40)) {
      const arr = table.byCity.get(id)!
      expect(arr.length).toBe(file.cities[id].length)
      for (let i = 1; i < arr.length; i++) expect(arr[i]).toBeGreaterThan(arr[i - 1])
    }
  })

  it('covers every city for the whole published window', () => {
    expect(table.byCity.size).toBe(CITIES.length)
    for (const c of CITIES) {
      expect(table.byCity.get(c.ilceID)?.length, c.n).toBe(file.days * file.perDay)
    }
  })
})

describe('phaseOf', () => {
  /**
   * The bug this whole file exists for.
   *
   * Amsterdam in August is exactly where a literal 17° solve and Diyanet part
   * company: the solar model puts Isha at 23:24 and Diyanet publishes it before
   * 23:00, so at 23:10 the city was being counted under Maghrib while its own
   * card read Isha.
   */
  it('puts Amsterdam in Isha when Diyanet says Isha, not Maghrib', () => {
    const city = idOf('Amsterdam')
    const snapshot = JSON.parse(
      readFileSync(`public/times/${city.ilceID}.json`, 'utf8'),
    ) as { tz: string; days: Record<string, string[]> }

    const date = '2026-08-17'
    const [, , , , maghrib, isha] = snapshot.days[date]
    const after = at(date, isha, snapshot.tz) + 10 * 60000

    expect(phaseOf(table, city.ilceID, after)).toBe(5)

    // And the solar model — still the fallback — really does disagree here.
    const sky = skyState(new Date(after))
    const st = (((sky.utcH + city.lo / 15 + sky.eot / 60) % 24) + 24) % 24
    const solar = phaseAt(city.la, st, sky.dec, solarTable(city.la, sky.dec))
    expect(solar, 'solar model should still say Maghrib, which is the bug').toBe(4)

    // Just before maghrib it is Asr by both accounts.
    expect(phaseOf(table, city.ilceID, at(date, maghrib, snapshot.tz) - 60000)).toBe(3)
  })

  it('agrees with the published times it was built from', () => {
    // Cross-check the bundle against its own source, for cities whose offsets
    // are the ones most likely to be mishandled.
    for (const name of ['Berlin', 'Kathmandu', 'Adelaide', 'Reykjavik', 'Los Angeles']) {
      const city = idOf(name)
      const snapshot = JSON.parse(
        readFileSync(`public/times/${city.ilceID}.json`, 'utf8'),
      ) as { tz: string; days: Record<string, string[]> }

      const date = '2026-08-20'
      const row = snapshot.days[date]
      // One minute after each boundary is unambiguously inside that phase.
      row.slice(0, 6).forEach((hhmm, i) => {
        const t = at(date, hhmm, snapshot.tz) + 60000
        expect(phaseOf(table, city.ilceID, t), `${name} after ${hhmm}`).toBe(i)
      })
    }
  })

  it('returns null past the published window so the caller can fall back', () => {
    const city = idOf('Istanbul')
    const arr = table.byCity.get(city.ilceID)!
    const past = (arr[arr.length - 1] + 60) * 60000
    expect(phaseOf(table, city.ilceID, past)).toBeNull()
  })

  it('returns null for a city it has never heard of', () => {
    expect(phaseOf(table, '000000', Date.now())).toBeNull()
  })
})

describe('blendOf', () => {
  it('ramps into the next phase only near a boundary', () => {
    const city = idOf('Istanbul')
    const snapshot = JSON.parse(
      readFileSync(`public/times/${city.ilceID}.json`, 'utf8'),
    ) as { tz: string; days: Record<string, string[]> }
    const date = '2026-08-20'
    const dhuhr = at(date, snapshot.days[date][2], snapshot.tz)

    // Well before the boundary: settled, no crossfade.
    const early = blendOf(table, city.ilceID, dhuhr - 3 * 3600000)!
    expect(early.t).toBe(0)
    expect(early.next).toBe(early.phase)

    // Just before it: fading from sunrise's phase into dhuhr's.
    const close = blendOf(table, city.ilceID, dhuhr - 6 * 60000)!
    expect(close.phase).toBe(1)
    expect(close.next).toBe(2)
    expect(close.t).toBeGreaterThan(0.7)
    expect(close.t).toBeLessThan(1)
  })

  it('is null past the window, like phaseOf', () => {
    const city = idOf('Istanbul')
    const arr = table.byCity.get(city.ilceID)!
    expect(blendOf(table, city.ilceID, (arr[arr.length - 1] + 60) * 60000)).toBeNull()
  })
})
