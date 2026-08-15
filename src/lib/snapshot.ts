// Reads the optional pre-fetched dataset in public/times/, produced by
// `npm run fetch-times`.
//
// When it is present the app never touches the upstream API and cannot be rate
// limited. When it is absent (fresh clone, crawler not run yet) every lookup
// falls through to the live API, so the app works either way.

import type { ResolvedDistrict, VakitRow } from './diyanet'

export type SnapshotIndex = Record<string, ResolvedDistrict>

const base = import.meta.env.BASE_URL

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
    const rows = (await res.json()) as VakitRow[]
    return Array.isArray(rows) && rows.length ? rows : null
  } catch {
    return null
  }
}
