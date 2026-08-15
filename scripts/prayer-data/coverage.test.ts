import { describe, it, expect } from 'vitest'
import { checkCoverage } from './coverage.ts'

const day = ['05:00', '06:00', '13:00', '17:00', '20:00', '21:30', '1 Recep 1448'] as const

/** A file covering [from, to] inclusive, as ISO dates. */
function file(
  from: string,
  to: string,
  opts: { skip?: string; bad?: { date: string; value: unknown } } = {},
) {
  const days: Record<string, unknown> = {}
  for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    if (iso === opts.skip) continue
    days[iso] = opts.bad?.date === iso ? opts.bad.value : [...day]
  }
  return { ilceID: '1', name: 'Test', tz: 'UTC', days } as never
}

describe('checkCoverage', () => {
  const today = '2026-08-15'

  it('passes a snapshot covering yesterday through today+25', () => {
    expect(checkCoverage([file('2026-08-14', '2026-09-20')], today)).toEqual([])
  })

  it('fails when the forward window is too short', () => {
    const problems = checkCoverage([file('2026-08-14', '2026-09-01')], today)
    expect(problems).toHaveLength(1)
    expect(problems[0].reason).toMatch(/missing 2026-09-02/)
  })

  it('fails on a hole inside the forward window', () => {
    const problems = checkCoverage([file('2026-08-14', '2026-09-20', { skip: '2026-08-20' })], today)
    expect(problems[0].reason).toMatch(/missing 2026-08-20/)
  })

  it('fails when yesterday is missing but earlier dates exist', () => {
    const problems = checkCoverage([file('2026-08-10', '2026-09-20', { skip: '2026-08-14' })], today)
    expect(problems[0].reason).toMatch(/2026-08-14/)
  })

  it('grandfathers yesterday when it precedes the earliest capture', () => {
    // A first run: the snapshot starts today, so yesterday was never obtainable.
    expect(checkCoverage([file('2026-08-15', '2026-09-20')], today)).toEqual([])
  })

  it('fails an empty snapshot', () => {
    const empty = { ilceID: '1', name: 'Test', tz: 'UTC', days: {} } as never
    expect(checkCoverage([empty], today)).toHaveLength(1)
  })

  it('fails a day whose value is null', () => {
    const problems = checkCoverage(
      [file('2026-08-14', '2026-09-20', { bad: { date: '2026-08-15', value: null } })],
      today,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0].reason).toMatch(/2026-08-15/)
  })

  it('fails a day truncated to 6 elements', () => {
    const problems = checkCoverage(
      [file('2026-08-14', '2026-09-20', { bad: { date: '2026-08-15', value: day.slice(0, 6) } })],
      today,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0].reason).toMatch(/2026-08-15/)
  })

  it('fails a day with a malformed time', () => {
    const malformed: string[] = [...day]
    malformed[5] = 'not-a-time'
    const problems = checkCoverage(
      [file('2026-08-14', '2026-09-20', { bad: { date: '2026-08-15', value: malformed } })],
      today,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0].reason).toMatch(/2026-08-15/)
  })
})
