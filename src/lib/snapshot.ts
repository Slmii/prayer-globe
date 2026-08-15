// Reads the pre-fetched dataset in public/times/, produced by
// `npm run prayer:fetch`.
//
// The files are stored compactly — one array per day rather than Diyanet's
// verbose row objects, which is the difference between ~26 MB and ~250 MB
// across 1,200 cities. They are expanded back into VakitRow here, with
// MiladiTarihUzunIso8601 synthesized from the city's IANA timezone, because
// that is the field buildTimetable already reads each day's UTC offset from.
// Nothing downstream needs to know the format changed.

import type { ResolvedDistrict, VakitRow } from './diyanet'

export type SnapshotIndex = Record<string, ResolvedDistrict>

/** [fajr, sunrise, dhuhr, asr, maghrib, isha, hijri] */
export type SnapshotDay = [string, string, string, string, string, string, string]

export interface SnapshotFile {
  ilceID: string
  name: string
  tz: string
  days: Record<string, SnapshotDay>
}

const base = import.meta.env.BASE_URL

/**
 * Minutes east of UTC for `tz` on `isoDate`. Probed at midday so a DST
 * transition — which happens in the small hours — never lands on the boundary.
 */
export function offsetMinutesFor(tz: string, isoDate: string): number {
  const probe = new Date(`${isoDate}T12:00:00Z`)
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(probe)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'

  const m = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(name)
  if (!m) return 0 // Plain "GMT" — zero offset.
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}

function isoWithOffset(date: string, offsetMin: number): string {
  const sign = offsetMin < 0 ? '-' : '+'
  const abs = Math.abs(offsetMin)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `${date}T00:00:00.0000000${sign}${hh}:${mm}`
}

export function toVakitRows(file: SnapshotFile): VakitRow[] {
  const rows: VakitRow[] = []
  for (const date of Object.keys(file.days).sort()) {
    const day = file.days[date]
    rows.push({
      Imsak: day[0],
      Gunes: day[1],
      Ogle: day[2],
      Ikindi: day[3],
      Aksam: day[4],
      Yatsi: day[5],
      HicriTarihUzun: day[6],
      MiladiTarihUzunIso8601: isoWithOffset(date, offsetMinutesFor(file.tz, date)),
    })
  }
  return rows
}

/** The city -> district map, or null when no snapshot has been built. */
export async function loadIndex(): Promise<SnapshotIndex | null> {
  try {
    const res = await fetch(`${base}times/index.json`)
    if (!res.ok) return null
    const data = (await res.json()) as SnapshotIndex
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

/** One district's timetable from the snapshot, or null to fall back to live. */
export async function loadTimetable(ilceID: string): Promise<VakitRow[] | null> {
  try {
    const res = await fetch(`${base}times/${ilceID}.json`)
    if (!res.ok) return null
    const file = (await res.json()) as SnapshotFile
    if (!file || typeof file !== 'object' || !file.days || !file.tz) return null
    const rows = toVakitRows(file)
    return rows.length ? rows : null
  } catch {
    return null
  }
}
