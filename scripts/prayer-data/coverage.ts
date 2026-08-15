// The promise the app makes is that every displayed prayer time comes from
// Diyanet, never from the solar model. That holds only if the snapshot covers
// the scrubber's whole reach for every city it ships. This is the check that
// turns that promise into a build failure rather than a silent fallback.

export interface CoverageProblem {
  ilceID: string
  name: string
  reason: string
}

interface Coverable {
  ilceID: string
  name: string
  days: Record<string, unknown>
}

/** The scrubber reaches +10 days; +25 leaves slack to notice a failed run. */
const FORWARD_DAYS = 25

function shift(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const TIME_RE = /^\d{1,2}:\d{2}$/

/**
 * A date key alone is not a usable row: a file whose dates all map to `null`,
 * a truncated array, or an invalid time string passes a key-only check, then
 * produces missing prayer instants in the app. Returns null when the row is
 * usable, otherwise a human-readable reason.
 */
function invalidDay(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 7) {
    return `not a 7-element array (got ${JSON.stringify(value)})`
  }
  for (let i = 0; i < 6; i++) {
    if (typeof value[i] !== 'string' || !TIME_RE.test(value[i])) {
      return `invalid time at index ${i} (got ${JSON.stringify(value[i])})`
    }
  }
  return null
}

export function checkCoverage(
  files: Coverable[],
  today: string,
  forwardDays: number = FORWARD_DAYS,
): CoverageProblem[] {
  const problems: CoverageProblem[] = []

  for (const file of files) {
    const dates = Object.keys(file.days)
    if (!dates.length) {
      problems.push({ ilceID: file.ilceID, name: file.name, reason: 'no days at all' })
      continue
    }

    const have = new Set(dates)
    const earliest = dates.reduce((a, b) => (a < b ? a : b))
    let reason: string | null = null

    // Yesterday: needed because a city at UTC-11 is still on the previous local
    // date. Diyanet serves no archive, so on a first run it was never
    // obtainable — grandfather it against the earliest date ever captured.
    const yesterday = shift(today, -1)
    if (yesterday >= earliest) {
      if (!have.has(yesterday)) {
        reason = `missing ${yesterday} (yesterday)`
      } else {
        const bad = invalidDay(file.days[yesterday])
        if (bad) reason = `invalid ${yesterday} (yesterday): ${bad}`
      }
    }

    for (let i = 0; !reason && i <= forwardDays; i++) {
      const date = shift(today, i)
      if (!have.has(date)) {
        reason = `missing ${date} (today+${i})`
      } else {
        const bad = invalidDay(file.days[date])
        if (bad) reason = `invalid ${date} (today+${i}): ${bad}`
      }
    }

    if (reason) problems.push({ ilceID: file.ilceID, name: file.name, reason })
  }

  return problems
}
