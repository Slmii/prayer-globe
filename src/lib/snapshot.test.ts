import { describe, it, expect } from 'vitest'
import { offsetMinutesFor, toVakitRows } from './snapshot'
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
