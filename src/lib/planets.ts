// Positions of the planets.
//
// Earth is absent by design rather than by omission: it is the globe, so its
// place in the orrery is the origin every other position is measured from. What
// is drawn is the other seven — the five naked-eye classical planets that carry
// the app's sun-and-moon framing, plus Uranus and Neptune, which need a
// telescope but complete the system.
//
// Elements are JPL's "Approximate Positions of the Planets" (Standish), valid
// 1800–2050 to a few arc-minutes: far better than needed for an orrery, and
// cheap enough to evaluate every frame. Note the outer two are the least
// accurate of the set — Neptune has not completed one orbit since discovery, so
// its elements are fitted over a short arc — but at orrery scale that is
// invisible.

import { D, wrap } from './astro'

interface Elements {
  name: string
  /** Semi-major axis (au) and its rate per Julian century. */
  a: [number, number]
  /** Eccentricity. */
  e: [number, number]
  /** Inclination (deg). */
  i: [number, number]
  /** Mean longitude (deg). */
  L: [number, number]
  /** Longitude of perihelion (deg). */
  peri: [number, number]
  /** Longitude of the ascending node (deg). */
  node: [number, number]
  /** Display colour. */
  color: string
}

const EARTH: Elements = {
  name: 'Earth',
  a: [1.00000261, 0.00000562],
  e: [0.01671123, -0.00004392],
  i: [-0.00001531, -0.01294668],
  L: [100.46457166, 35999.37244981],
  peri: [102.93768193, 0.32327364],
  node: [0, 0],
  color: '#8fd3ff',
}

export const PLANETS: Elements[] = [
  {
    name: 'Mercury',
    a: [0.38709927, 0.00000037],
    e: [0.20563593, 0.00001906],
    i: [7.00497902, -0.00594749],
    L: [252.2503235, 149472.67411175],
    peri: [77.45779628, 0.16047689],
    node: [48.33076593, -0.12534081],
    color: '#b9b2a4',
  },
  {
    name: 'Venus',
    a: [0.72333566, 0.0000039],
    e: [0.00677672, -0.00004107],
    i: [3.39467605, -0.0007889],
    L: [181.9790995, 58517.81538729],
    peri: [131.60246718, 0.00268329],
    node: [76.67984255, -0.27769418],
    color: '#f0d9a8',
  },
  {
    name: 'Mars',
    a: [1.52371034, 0.00001847],
    e: [0.0933941, 0.00007882],
    i: [1.84969142, -0.00813131],
    L: [-4.55343205, 19140.30268499],
    peri: [-23.94362959, 0.44441088],
    node: [49.55953891, -0.29257343],
    color: '#e0785a',
  },
  {
    name: 'Jupiter',
    a: [5.202887, -0.00011607],
    e: [0.04838624, -0.00013253],
    i: [1.30439695, -0.00183714],
    L: [34.39644051, 3034.74612775],
    peri: [14.72847983, 0.21252668],
    node: [100.47390909, 0.20469106],
    color: '#dcb894',
  },
  {
    name: 'Saturn',
    a: [9.53667594, -0.0012506],
    e: [0.05386179, -0.00050991],
    i: [2.48599187, 0.00193609],
    L: [49.95424423, 1222.49362201],
    peri: [92.59887831, -0.41897216],
    node: [113.66242448, -0.28867794],
    color: '#e6d6a8',
  },
  {
    name: 'Uranus',
    a: [19.18916464, -0.00196176],
    e: [0.04725744, -0.00004397],
    i: [0.77263783, -0.00242939],
    L: [313.23810451, 428.48202785],
    peri: [170.9542763, 0.40805281],
    node: [74.01692503, 0.04240589],
    color: '#a5dde4',
  },
  {
    name: 'Neptune',
    a: [30.06992276, 0.00026291],
    e: [0.00859048, 0.00005105],
    i: [1.77004347, 0.00035372],
    L: [-55.12002969, 218.45945325],
    peri: [44.96476227, -0.32241464],
    node: [131.78422574, -0.00508664],
    color: '#6d8ae0',
  },
]

/** Julian centuries since J2000.0. */
export const centuriesSinceJ2000 = (date: Date) =>
  (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525

interface Vec3 {
  x: number
  y: number
  z: number
}

/** Heliocentric ecliptic rectangular coordinates, in au. */
function heliocentric(el: Elements, T: number): Vec3 {
  const a = el.a[0] + el.a[1] * T
  const e = el.e[0] + el.e[1] * T
  const i = (el.i[0] + el.i[1] * T) * D
  const L = el.L[0] + el.L[1] * T
  const peri = el.peri[0] + el.peri[1] * T
  const node = (el.node[0] + el.node[1] * T) * D

  // Mean anomaly, folded to ±180° before solving.
  const M = wrap(L - peri) * D

  // Kepler's equation by Newton–Raphson; a handful of steps is ample at these
  // eccentricities (Mercury's 0.206 is the worst case).
  let E = M + e * Math.sin(M)
  for (let k = 0; k < 8; k++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
    E -= dE
    if (Math.abs(dE) < 1e-12) break
  }

  // Position in the orbital plane.
  const xv = a * (Math.cos(E) - e)
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E)

  // Rotate perihelion -> node -> ecliptic.
  const w = peri * D - node
  const cw = Math.cos(w)
  const sw = Math.sin(w)
  const cn = Math.cos(node)
  const sn = Math.sin(node)
  const ci = Math.cos(i)
  const si = Math.sin(i)

  return {
    x: (cw * cn - sw * sn * ci) * xv + (-sw * cn - cw * sn * ci) * yv,
    y: (cw * sn + sw * cn * ci) * xv + (-sw * sn + cw * cn * ci) * yv,
    z: sw * si * xv + cw * si * yv,
  }
}

/** Greenwich mean sidereal time in degrees — same convention as astro.ts. */
export const gmstDeg = (date: Date) =>
  280.147 + 360.9856235 * (date.getTime() / 86400000 + 2440587.5 - 2451545.0)

/**
 * Where the north ecliptic pole stands over the earth.
 *
 * The planets orbit in the ecliptic plane, so this direction is the plane's
 * normal — everything the 3D orrery draws is oriented from it. The pole sits at
 * RA 18h, Dec 90° − obliquity, and turning that into an earth-fixed longitude is
 * the same GMST subtraction used for the sub-solar point.
 */
export function eclipticPole(date: Date): { lat: number; lon: number } {
  return {
    lat: 90 - 23.43928,
    lon: wrap(270 - gmstDeg(date)),
  }
}

export interface PlanetState {
  name: string
  color: string
  /** Sub-planetary point: where on earth it is directly overhead. */
  lat: number
  lon: number
  /** Geocentric ecliptic longitude, degrees — the orrery angle. */
  eclipticLon: number
  /** Distance from earth, in au. */
  distance: number
  /** Angular separation from the sun as seen from earth, degrees. */
  elongation: number
}

const OBLIQUITY = 23.43928 * D

/** Where every planet in PLANETS is, for one instant. */
export function planetStates(date: Date): PlanetState[] {
  const T = centuriesSinceJ2000(date)
  const earth = heliocentric(EARTH, T)

  const gmst = gmstDeg(date)

  // The sun as seen from earth is simply the reversed earth vector.
  const sunLon = Math.atan2(-earth.y, -earth.x) / D

  return PLANETS.map((el) => {
    const p = heliocentric(el, T)
    const gx = p.x - earth.x
    const gy = p.y - earth.y
    const gz = p.z - earth.z

    const distance = Math.sqrt(gx * gx + gy * gy + gz * gz)
    const eclipticLon = wrap(Math.atan2(gy, gx) / D)
    const eclipticLat = Math.asin(gz / distance) / D

    // Ecliptic -> equatorial -> the point it stands over.
    const sl = Math.sin(eclipticLon * D)
    const cl = Math.cos(eclipticLon * D)
    const tb = Math.tan(eclipticLat * D)
    const ra = Math.atan2(sl * Math.cos(OBLIQUITY) - tb * Math.sin(OBLIQUITY), cl) / D
    const dec =
      Math.asin(
        Math.sin(eclipticLat * D) * Math.cos(OBLIQUITY) +
          Math.cos(eclipticLat * D) * Math.sin(OBLIQUITY) * sl,
      ) / D

    return {
      name: el.name,
      color: el.color,
      lat: dec,
      lon: wrap(ra - gmst),
      eclipticLon,
      distance,
      elongation: Math.abs(wrap(eclipticLon - sunLon)),
    }
  })
}
