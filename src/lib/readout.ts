// Assembles everything the side panel shows for one instant.
//
// Prefers real Diyanet times for the selected city and falls back to the local
// solar model when the API has no coverage, hasn't answered yet, or the scrubbed
// instant falls outside the 32-day window it returned.

import {
  D,
  PHASES,
  ROWS,
  fmt,
  latTxt,
  lonTxt,
  phaseAt,
  skyState,
  solarTable,
  qibla,
  wrap,
} from './astro'
import type { PrayerKey } from './astro'
import { CITIES } from './cities'
import type { City } from './cities'
import { dayFor, lookup } from './diyanet'
import type { TimetableDay } from './diyanet'
import { phaseOf } from './phases'
import type { PhaseTable } from './phases'

export interface TimeRow {
  label: string
  ar: string
  time: string
  bg: string
  mark: string
  fg: string
  dim: string
}

export interface CountChip {
  label: string
  color: string
  /** Index into PHASES, so a click can ask the globe for these cities. */
  phase: number
  n: number
  /** Share of the 143 cities, for the proportional bar. */
  flex: number
  title: string
}

/** A prayer boundary placed on the day arc. */
export interface ArcMark {
  label: string
  color: string
  /** Fraction of the local day, 0 = midnight, 1 = the next midnight. */
  f: number
  active: boolean
}

export type Source = 'diyanet' | 'local'

export interface Readout {
  prayer: string
  ar: string
  city: string
  coord: string
  clock: string
  /** Milliseconds until the next prayer, for a live countdown. */
  nextMs: number
  nextLabel: string
  times: TimeRow[]
  counts: CountChip[]
  utc: string
  qibla: string
  qiblaRot: string
  sunPos: string
  moonPos: string
  /** Geometric sunrise/sunset for the city's coordinates, local civil time. */
  sunriseGeo: string
  sunsetGeo: string
  /** Raw sub-solar / sub-lunar coordinates, so the panel can fly to them. */
  sunAt: { lat: number; lon: number }
  moonAt: { lat: number; lon: number }
  /** Illuminated fraction 0..1, for the panel's moon icon. */
  moonIllum: number
  ptrPos: string
  hovering: boolean
  selMode: string
  selHint: string
  source: Source
  /** Hijri date, only available from Diyanet. */
  hijri: string
  /** The selected city's local date, written out. */
  dateLine: string
  /** The scrubbed instant as DD-MM-YYYY HH:MM in the city's local time. */
  stamp: string
  /** Prayer boundaries around the day arc, plus where "now" sits on it. */
  arcMarks: ArcMark[]
  nowF: number
  /** Which prayer holds the most cities right now. */
  countLead: string
}

/** Nearest city to the pointer, or to the centre of the globe when not hovering. */
export function pickCity(
  hover: { lat: number; lng: number } | null,
  centerLng: number,
  centerLat: number,
): City {
  let best = CITIES[0]
  let bestScore = Infinity
  if (hover) {
    for (const c of CITIES) {
      const dl = wrap(c.lo - hover.lng) * Math.cos(((c.la + hover.lat) / 2) * D)
      const s = Math.hypot(c.la - hover.lat, dl)
      if (s < bestScore) {
        bestScore = s
        best = c
      }
    }
  } else {
    for (const c of CITIES) {
      const s = Math.abs(wrap(c.lo - centerLng)) + Math.abs(c.la - centerLat) * 0.5
      if (s < bestScore) {
        bestScore = s
        best = c
      }
    }
  }
  return best
}

const ROW_STYLE = (on: boolean, phase: number) => ({
  bg: on ? 'rgba(150,138,224,.17)' : 'rgba(233,233,237,.035)',
  mark: on ? PHASES[phase].c : 'transparent',
  fg: on ? '#f5f4ff' : 'rgba(233,233,237,.6)',
  dim: on ? PHASES[phase].c : 'rgba(233,233,237,.35)',
})

/**
 * One city's prayer, preferring Diyanet and falling back to the sun.
 *
 * The fallback is not decoration: the published window is finite, so scrubbing
 * past its end has to land somewhere, and a geometric estimate is a much better
 * answer there than a stale one.
 */
export function cityPhase(
  c: City,
  nowMs: number,
  phases: PhaseTable | null,
  utcH: number,
  eot: number,
  dec: number,
): number {
  if (phases) {
    const p = phaseOf(phases, c.ilceID, nowMs)
    if (p != null) return p
  }
  const st = (((utcH + c.lo / 15 + eot / 60) % 24) + 24) % 24
  return phaseAt(c.la, st, dec)
}

export interface ReadoutInput {
  city: City
  nowMs: number
  hover: { lat: number; lng: number } | null
  centerLng: number
  /** Diyanet timetable for `city`, when loaded and current. */
  days: TimetableDay[] | null
  /** Every city's Diyanet boundaries, for the tally. Null until loaded. */
  phases: PhaseTable | null
}

export function buildReadout({
  city,
  nowMs,
  hover,
  centerLng,
  days,
  phases,
}: ReadoutInput): Readout {
  const date = new Date(nowMs)
  const sky = skyState(date)
  const { dec, eot, utcH } = sky

  // Local solar model — always computed; it backs the globe and the fallback.
  const table = solarTable(city.la, dec)
  const solarNow = (((utcH + city.lo / 15 + eot / 60) % 24) + 24) % 24
  const localPhase = phaseAt(city.la, solarNow, dec, table)

  const hit = days?.length ? lookup(days, nowMs) : null
  const day = days?.length ? dayFor(days, nowMs) : null
  const source: Source = hit && day ? 'diyanet' : 'local'
  const phase = hit ? hit.phase : localPhase

  // Prayer rows: Diyanet's published wall-clock strings, or the solar model.
  const times: TimeRow[] = ROWS.map((row) => {
    const on = row.phase === phase
    const style = ROW_STYLE(on, row.phase)
    let time: string
    if (source === 'diyanet' && day) {
      time = day.local[row.key] || '—:—'
    } else {
      const v = table[row.key]
      time = isNaN(v) ? '—:—' : fmt(v - eot / 60)
    }
    return { label: row.label, ar: row.ar, time, ...style }
  })

  // Wall clock: real UTC offset when we have it, mean solar time otherwise.
  const offsetHours = source === 'diyanet' && day ? day.offsetMin / 60 : city.lo / 15
  const clock = fmt(utcH + offsetHours)

  // Sunrise and sunset straight from the city's coordinates — the geometric
  // event at -0.833° (refraction plus the sun's semi-diameter), with no temkin.
  // Diyanet publishes sunrise a few minutes early and sunset a few minutes late
  // as a precaution, so these deliberately differ from the table above.
  // Solar hour -> UTC -> the city's civil time.
  const civilFromSolar = (solarHour: number) =>
    isNaN(solarHour) ? '—:—' : fmt(solarHour - eot / 60 - city.lo / 15 + offsetHours)
  const sunriseGeo = civilFromSolar(table.rise)
  const sunsetGeo = civilFromSolar(table.set)

  // Countdown to the next boundary, in milliseconds so the panel can tick it.
  let nextMs: number
  let nextLabel: string
  if (hit) {
    nextMs = hit.msToNext
    nextLabel = ROWS.find((r) => r.key === hit.next.key)?.label ?? hit.next.key
  } else {
    const bounds = ROWS.map((r) => ({ label: r.label, solar: table[r.key] })).filter(
      (b) => !isNaN(b.solar),
    )
    const next =
      bounds.find((b) => b.solar > solarNow) ??
      ({
        label: bounds.length ? bounds[0].label : 'Fajr',
        solar: (bounds.length ? bounds[0].solar : 4) + 24,
      } as { label: string; solar: number })
    nextMs = (next.solar - solarNow) * 3600000
    nextLabel = next.label
  }

  // How many cities are in each phase right now — a whole-earth sweep, so it
  // reads the precomputed Diyanet boundaries rather than making 723 requests.
  const countIdx: Record<number, number> = { 0: 0, 2: 1, 3: 2, 4: 3, 5: 4 }
  const counts: CountChip[] = [0, 2, 3, 4, 5].map((i) => ({
    label: PHASES[i].tr,
    color: PHASES[i].c,
    phase: i,
    n: 0,
    flex: 1,
    title: '',
  }))
  for (const c of CITIES) {
    const p = cityPhase(c, nowMs, phases, utcH, eot, dec)
    const slot = countIdx[p]
    if (slot !== undefined) counts[slot].n++
  }

  // Where each prayer and "now" sit on the day arc, as a fraction of the local
  // day. Midnight is both ends of the arc, noon its apex.
  const dayFraction = (h: number) => (((h % 24) + 24) % 24) / 24
  const nowF = dayFraction(utcH + offsetHours)
  const arcMarks: ArcMark[] = ROWS.map((row) => {
    let hour: number
    if (source === 'diyanet' && day) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(day.local[row.key] ?? '')
      hour = m ? +m[1] + +m[2] / 60 : NaN
    } else {
      const v = table[row.key]
      hour = isNaN(v) ? NaN : v - eot / 60 - city.lo / 15 + offsetHours
    }
    return {
      label: row.label,
      color: PHASES[row.phase].c,
      f: isNaN(hour) ? NaN : dayFraction(hour),
      active: row.phase === phase,
    }
  }).filter((m) => !isNaN(m.f))

  const total = counts.reduce((sum, c) => sum + c.n, 0) || 1
  const lead = counts.reduce((best, c) => (c.n > best.n ? c : best), counts[0])
  for (const c of counts) {
    c.flex = Math.max(c.n, 0.4)
    c.title = `${c.label} · ${c.n} cities`
  }

  const localDate = new Date(nowMs + offsetHours * 3600000)
  const dateLine = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(localDate)

  // The scrubber reads better as a real moment than as an offset from now.
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${two(localDate.getUTCDate())}-${two(localDate.getUTCMonth() + 1)}-${localDate.getUTCFullYear()}` +
    ` ${two(localDate.getUTCHours())}:${two(localDate.getUTCMinutes())}`

  const qb = qibla(city.la, city.lo)

  return {
    prayer: PHASES[phase].tr,
    ar: PHASES[phase].ar,
    city: city.n,
    coord: latTxt(city.la) + ' · ' + lonTxt(city.lo),
    clock,
    nextMs,
    nextLabel,
    times,
    counts,
    utc: fmt(utcH),
    qibla: Math.round(qb) + '°',
    qiblaRot: Math.round(qb) + 'deg',
    sunPos: latTxt(sky.sun.lat) + ' · ' + lonTxt(sky.sun.lon),
    sunriseGeo,
    sunsetGeo,
    sunAt: { lat: sky.sun.lat, lon: sky.sun.lon },
    moonAt: { lat: sky.moon.lat, lon: sky.moon.lon },
    moonIllum: sky.moon.illum,
    moonPos:
      latTxt(sky.moon.lat) +
      ' · ' +
      lonTxt(sky.moon.lon) +
      ' · ' +
      Math.round(sky.moon.illum * 100) +
      '%',
    ptrPos: hover ? latTxt(hover.lat) + ' · ' + lonTxt(hover.lng) : lonTxt(centerLng),
    hovering: !!hover,
    selMode: 'SELECTED',
    selHint: 'click a city on the globe, or search',
    source,
    hijri: day?.hijri ?? '',
    dateLine,
    stamp,
    arcMarks,
    nowF,
    countLead: `${lead.label.toUpperCase()} LEADS · ${Math.round((lead.n / total) * 100)}%`,
  }
}

/**
 * The cities in one prayer phase at an instant, and where to look to see them.
 *
 * Computed on demand rather than carried in the readout: it is the same sweep
 * the counts already do, and only a click ever needs the names.
 */
export function citiesInPhase(nowMs: number, phase: number, phases: PhaseTable | null) {
  const { dec, eot, utcH } = skyState(new Date(nowMs))
  const cities = CITIES.filter((c) => cityPhase(c, nowMs, phases, utcH, eot, dec) === phase)

  // Averaging longitudes directly would fail across the antimeridian, so take
  // the mean of the direction vectors and read the centre back off that.
  let x = 0
  let y = 0
  let z = 0
  for (const c of cities) {
    const la = c.la * D
    const lo = c.lo * D
    x += Math.cos(la) * Math.cos(lo)
    y += Math.cos(la) * Math.sin(lo)
    z += Math.sin(la)
  }
  const centre = cities.length
    ? { lat: Math.atan2(z, Math.hypot(x, y)) / D, lon: Math.atan2(y, x) / D }
    : null

  return { cities, centre }
}

export type { PrayerKey }
