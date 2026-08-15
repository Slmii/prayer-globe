import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCityPage, extractRows } from './parse-page.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = readFileSync(join(here, '__fixtures__', 'emmen-tables.html'), 'utf8')

describe('extractRows', () => {
  it('pulls the yearly table including its header row', () => {
    const rows = extractRows(fixture, 'table-caption-yearly')
    expect(rows[0]).toEqual([
      'Gregorian Calendar Date',
      'Hijri Date',
      'Fajr',
      'Sun',
      'Dhuhr',
      'Asr',
      'Maghrib',
      'Isha',
    ])
    expect(rows).toHaveLength(366)
  })

  it('throws when the caption is absent', () => {
    expect(() => extractRows('<html></html>', 'table-caption-yearly')).toThrow(
      /table-caption-yearly/,
    )
  })
})

describe('parseCityPage', () => {
  const days = parseCityPage(fixture)

  it('returns a full year plus the rolling month, deduped', () => {
    expect(days.length).toBeGreaterThanOrEqual(365)
    const dates = days.map((d) => d.date)
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('converts dd.mm.yyyy to ISO and keeps the six times in order', () => {
    const jan1 = days.find((d) => d.date.endsWith('-01-01'))
    expect(jan1).toBeDefined()
    expect(jan1!.times).toHaveLength(6)
    for (const t of jan1!.times) expect(t).toMatch(/^\d{1,2}:\d{2}$/)
    expect(jan1!.hijri).toMatch(/\d{4}$/)
  })

  it('sorts ascending', () => {
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
    expect(days.map((d) => d.date)).toEqual(sorted.map((d) => d.date))
  })

  it('rejects a row whose times are malformed', () => {
    const broken = fixture.replace('<td>06:37</td>', '<td>oops</td>')
    expect(() => parseCityPage(broken)).toThrow(/malformed/i)
  })

  it('throws when the page has no tables at all', () => {
    expect(() => parseCityPage('<html><body>nothing</body></html>')).toThrow()
  })
})
