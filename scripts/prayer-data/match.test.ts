import { describe, it, expect } from 'vitest'
import { countryIso2, matchDistrict } from './match.ts'
import type { DiyanetDistrict } from './discover.ts'
import type { GeoCity } from './geonames.ts'

const district = (nameEn: string, name = nameEn, ilceID = '1'): DiyanetDistrict => ({
  ilceID,
  name,
  nameEn,
  url: `/en-US/${ilceID}/x`,
})

const city = (over: Partial<GeoCity>): GeoCity => ({
  name: 'X',
  ascii: 'X',
  alt: [],
  lat: 0,
  lon: 0,
  featureCode: 'PPL',
  iso2: 'XX',
  pop: 1,
  tz: 'UTC',
  ...over,
})

describe('countryIso2', () => {
  it('resolves plain English names', () => {
    expect(countryIso2('NETHERLANDS')).toBe('NL')
    expect(countryIso2('GERMANY')).toBe('DE')
  })

  it('resolves the Turkish-flavoured names in the dropdown', () => {
    expect(countryIso2('HOLLANDA')).toBe('NL')
    expect(countryIso2('USA')).toBe('US')
    expect(countryIso2('S. ARABISTAN')).toBe('SA')
  })

  it('returns null for entries that are not countries', () => {
    expect(countryIso2('ATLANTIC OCEAN')).toBeNull()
  })
})

describe('matchDistrict', () => {
  it('matches on the English name', () => {
    const d = [district('EMMEN')]
    expect(matchDistrict(city({ ascii: 'Emmen' }), d)?.ilceID).toBe('1')
  })

  it('folds diacritics and Turkish dotted I', () => {
    const d = [district('ISTANBUL', 'İSTANBUL')]
    expect(matchDistrict(city({ ascii: 'Istanbul', name: 'İstanbul' }), d)).not.toBeNull()
  })

  it('bridges transliterations through GeoNames alternate names', () => {
    const d = [district('MECCA', 'MEKKE')]
    const c = city({ ascii: 'Mecca', alt: ['Makkah', 'Mekke'] })
    expect(matchDistrict(c, d)?.ilceID).toBe('1')
  })

  it('prefers an exact name match over an alternate-name match', () => {
    const d = [district('MAKKAH', 'MAKKAH', 'alt'), district('MECCA', 'MEKKE', 'exact')]
    expect(matchDistrict(city({ ascii: 'Mecca', alt: ['Makkah'] }), d)?.ilceID).toBe('exact')
  })

  it('returns null rather than guessing', () => {
    expect(matchDistrict(city({ ascii: 'Nowhere' }), [district('EMMEN')])).toBeNull()
  })
})
