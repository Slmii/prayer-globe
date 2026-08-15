// GeoNames supplies the three things Diyanet does not publish: coordinates,
// population, and the IANA timezone. cities15000 is every city over 15,000
// people — about 30,000 rows.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'

const URL = 'https://download.geonames.org/export/dump/cities15000.zip'
const ZIP = 'data/cities15000.zip'
const TXT = 'data/cities15000.txt'

export interface GeoCity {
  name: string
  ascii: string
  alt: string[]
  lat: number
  lon: number
  /** PPLC marks a national capital. */
  featureCode: string
  iso2: string
  pop: number
  tz: string
}

export async function loadGeoNames(): Promise<GeoCity[]> {
  mkdirSync('data', { recursive: true })

  if (!existsSync(TXT)) {
    console.log('downloading cities15000.zip …')
    const res = await fetch(URL)
    if (!res.ok) throw new Error(`GeoNames → HTTP ${res.status}`)
    writeFileSync(ZIP, Buffer.from(await res.arrayBuffer()))
    writeFileSync(TXT, execFileSync('unzip', ['-p', ZIP, 'cities15000.txt'], {
      maxBuffer: 128 * 1024 * 1024,
    }))
  }

  const cities: GeoCity[] = []
  for (const line of readFileSync(TXT, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const f = line.split('\t')
    cities.push({
      name: f[1],
      ascii: f[2],
      alt: f[3] ? f[3].split(',') : [],
      lat: Number(f[4]),
      lon: Number(f[5]),
      featureCode: f[7],
      iso2: f[8],
      pop: Number(f[14]),
      tz: f[17],
    })
  }
  console.log(`${cities.length} GeoNames cities`)
  return cities
}
