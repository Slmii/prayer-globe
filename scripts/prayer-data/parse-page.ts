// The Diyanet city page ships its weekly, monthly and yearly tables as plain
// HTML. The yearly one holds 365 rows, so a single GET is a full calendar year
// — the PDF and Excel buttons are DataTables client-side exports of rows that
// are already here, and there is no server-side export to call.

export interface ParsedDay {
  /** ISO YYYY-MM-DD. */
  date: string
  /** fajr, sunrise, dhuhr, asr, maghrib, isha — wall-clock, as published. */
  times: [string, string, string, string, string, string]
  /** e.g. "23 Recep 1448". */
  hijri: string
}

const DDMMYYYY = /^(\d{2})\.(\d{2})\.(\d{4})$/
const HHMM = /^\d{1,2}:\d{2}$/

/** All `<tr>`s of the table carrying `captionId`, as arrays of cell text. */
export function extractRows(html: string, captionId: string): string[][] {
  const anchor = html.indexOf(`id="${captionId}"`)
  if (anchor < 0) throw new Error(`no table with caption ${captionId}`)
  const end = html.indexOf('</table>', anchor)
  if (end < 0) throw new Error(`unterminated table for ${captionId}`)

  const segment = html.slice(anchor, end)
  const rows: string[][] = []
  for (const tr of segment.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
      c[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim(),
    )
    if (cells.length) rows.push(cells)
  }
  return rows
}

function toDays(rows: string[][], captionId: string): ParsedDay[] {
  const days: ParsedDay[] = []
  for (const cells of rows) {
    // Skip the header, which carries no date.
    if (cells.length !== 8 || !DDMMYYYY.test(cells[0])) continue

    const [, d, mo, y] = DDMMYYYY.exec(cells[0])!
    const times = cells.slice(2, 8)
    for (const t of times) {
      if (!HHMM.test(t)) {
        throw new Error(`malformed time "${t}" on ${cells[0]} in ${captionId}`)
      }
    }
    days.push({
      date: `${y}-${mo}-${d}`,
      times: times as ParsedDay['times'],
      hijri: cells[1],
    })
  }
  return days
}

/**
 * Monthly and yearly merged. They overlap once the calendar reaches the
 * published year; the yearly table is applied second and wins, since both come
 * from the same source and disagreement would mean a mid-page correction.
 */
export function parseCityPage(html: string): ParsedDay[] {
  const byDate = new Map<string, ParsedDay>()
  let found = 0

  for (const caption of ['table-caption-monthly', 'table-caption-yearly']) {
    let rows: string[][]
    try {
      rows = extractRows(html, caption)
    } catch {
      continue
    }
    found++
    for (const day of toDays(rows, caption)) byDate.set(day.date, day)
  }

  if (!found) throw new Error('page contained neither a monthly nor a yearly table')
  if (!byDate.size) throw new Error('tables present but no parseable day rows')

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
