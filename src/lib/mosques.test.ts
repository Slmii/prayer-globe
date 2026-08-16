import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { MOSQUES } from './mosques'
import { CITIES } from './cities'

// MOSQUES drops any entry whose city is not on the globe, with only a
// console.warn to show for it — so a mosque can go missing without anything
// failing. Al-Aqsa and Bibi-Khanym were both dropped this way and it surfaced
// only by reading the browser console. These assertions turn that into a test
// failure, and `REQUIRED_CITIES` in scripts/prayer-data/select-cities.ts is
// what keeps their cities in the generated list.
const declared = [...readFileSync('src/lib/mosques.ts', 'utf8').matchAll(/city:\s*'([^']+)'/g)].map(
  (m) => m[1],
)

describe('MOSQUES', () => {
  it('declares at least one mosque', () => {
    expect(declared.length).toBeGreaterThan(0)
  })

  it('keeps every declared mosque — none silently dropped for a missing city', () => {
    const missing = declared.filter((city) => !CITIES.some((c) => c.n === city))
    expect(missing, `no dot on the globe for: ${missing.join(', ')}`).toEqual([])
    expect(MOSQUES).toHaveLength(declared.length)
  })

  it('places every mosque at its city, never at 0°,0°', () => {
    for (const m of MOSQUES) {
      const city = CITIES.find((c) => c.n === m.city)
      expect(city, `${m.name} names a city that is not on the globe`).toBeDefined()
      expect(m.lat).toBe(city!.la)
      expect(m.lon).toBe(city!.lo)
      expect(Math.abs(m.lat) + Math.abs(m.lon)).toBeGreaterThan(0)
    }
  })
})
