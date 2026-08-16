// Major mosques that get a 3D model on the globe in place of a city dot.
//
// The model *replaces* that city's dot, so its position is taken from the city
// rather than from the mosque's own coordinates — otherwise the building floats
// away from the dot it stands for. That constraint also means each entry has to
// name a mosque genuinely in that city: an earlier version paired Dubai with
// Sheikh Zayed (Abu Dhabi, ~100 km away) and Tunis with Kairouan (~130 km).

import { CITIES } from './cities'

/**
 * Which 3D model stands for a site.
 *
 * Most get the generic mosque, which is the point of it — one building that
 * reads as "a mosque" at marker size. Makkah and Madinah get their own, because
 * those two are not generic: nobody looking for the Kaaba would accept a
 * stand-in with a dome and minarets.
 */
export type MosqueModel = 'mosque' | 'kaaba' | 'nabawi'

/** Mosque name paired with the city whose dot it replaces. */
const PAIRS: { name: string; city: string; model?: MosqueModel }[] = [
  { name: 'Masjid al-Haram', city: 'Makkah', model: 'kaaba' },
  { name: 'Al-Masjid an-Nabawi', city: 'Madinah', model: 'nabawi' },
  { name: 'Al-Aqsa', city: 'Jerusalem' },
  { name: 'Sultan Ahmed (Blue Mosque)', city: 'Istanbul' },
  { name: 'Jumeirah Mosque', city: 'Dubai' },
  { name: 'Hassan II Mosque', city: 'Casablanca' },
  { name: 'Faisal Mosque', city: 'Islamabad' },
  { name: 'Badshahi Mosque', city: 'Lahore' },
  { name: 'Istiqlal Mosque', city: 'Jakarta' },
  { name: 'Imam Reza Shrine', city: 'Mashhad' },
  { name: 'Shah Mosque', city: 'Isfahan' },
  { name: 'Zaytuna Mosque', city: 'Tunis' },
  { name: 'Al-Azhar Mosque', city: 'Cairo' },
  { name: 'Bamako Grand Mosque', city: 'Bamako' },
  { name: 'Masjid Negara', city: 'Kuala Lumpur' },
  { name: 'Jama Masjid', city: 'Delhi' },
  { name: 'Bibi-Khanym', city: 'Samarkand' },
  { name: 'Kul Sharif', city: 'Kazan' },
  { name: 'Gazi Husrev-beg', city: 'Sarajevo' },
  { name: 'Lagos Central Mosque', city: 'Lagos' },
  { name: 'Imam Muhammad ibn Abd al-Wahhab Mosque', city: 'Doha' },
  { name: 'Great Mosque of Damascus', city: 'Damascus' },
]

export interface Mosque {
  name: string
  /** City.n in cities.ts — always resolvable. */
  city: string
  lat: number
  lon: number
  model: MosqueModel
}

export const MOSQUES: Mosque[] = PAIRS.flatMap(({ name, city, model }) => {
  const c = CITIES.find((x) => x.n === city)
  // A typo in `city` would otherwise place a mosque at 0°,0° in the Atlantic.
  if (!c) {
    console.warn(`[mosques] unknown city "${city}" for ${name}`)
    return []
  }
  return [{ name, city, lat: c.la, lon: c.lo, model: model ?? 'mosque' }]
})
