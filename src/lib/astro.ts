// Local astronomy, ported unchanged from the design canvas.
//
// This still drives everything the Diyanet API cannot give us: the terminator
// rings, the night polygon, the sub-solar / sub-lunar / midnight points, and the
// instant phase colour of all 143 city dots as you scrub time. Diyanet data
// takes over for the selected city's actual prayer times.

export const D = Math.PI / 180

export interface Phase {
  tr: string
  ar: string
  c: string
}

export const PHASES: Phase[] = [
  { tr: 'Fajr', ar: 'الفجر', c: '#b5abfc' },
  { tr: 'Duha', ar: 'الضحى', c: '#cfd3e5' },
  { tr: 'Dhuhr', ar: 'الظهر', c: '#f5f4ff' },
  { tr: 'Asr', ar: 'العصر', c: '#d2cefd' },
  { tr: 'Maghrib', ar: 'المغرب', c: '#968ae0' },
  { tr: 'Isha', ar: 'العشاء', c: '#6f63ad' },
]

/** Keys of the solar table, in the order they occur through a day. */
export type PrayerKey = 'fajr' | 'rise' | 'dhuhr' | 'asr' | 'set' | 'isha'

export interface RowSpec {
  label: string
  ar: string
  key: PrayerKey
  /** Index into PHASES that this row highlights. */
  phase: number
}

export const ROWS: RowSpec[] = [
  { label: 'Fajr', ar: 'الفجر', key: 'fajr', phase: 0 },
  { label: 'Shuruq', ar: 'الشروق', key: 'rise', phase: 1 },
  { label: 'Dhuhr', ar: 'الظهر', key: 'dhuhr', phase: 2 },
  { label: 'Asr', ar: 'العصر', key: 'asr', phase: 3 },
  { label: 'Maghrib', ar: 'المغرب', key: 'set', phase: 4 },
  { label: 'Isha', ar: 'العشاء', key: 'isha', phase: 5 },
]

export const pad = (n: number): string => String(n).padStart(2, '0')

export const fmt = (h: number): string => {
  const x = ((h % 24) + 24) % 24
  const m = Math.round(x * 60)
  return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60)
}

/**
 * Fold a longitude into [-180, 180).
 *
 * The obvious `((v + 540) % 360) - 180` only holds while `v + 540 >= 0`, because
 * JavaScript's `%` keeps the sign of the dividend. That is not a theoretical
 * concern here: `moon()` subtracts a GMST that accumulates ~361° per day since
 * J2000, so its argument runs to millions of degrees negative and the naive form
 * returns values in (-540, -180]. Normalising to a positive residue first is
 * correct for any magnitude.
 */
export const wrap = (v: number): number => (((((v + 180) % 360) + 360) % 360) - 180)

export const lonTxt = (v: number): string => {
  const x = wrap(v)
  return Math.abs(x).toFixed(1) + '° ' + (x >= 0 ? 'E' : 'W')
}

export const latTxt = (v: number): string => Math.abs(v).toFixed(1) + '° ' + (v >= 0 ? 'N' : 'S')

export interface SunState {
  /** Declination, radians. */
  dec: number
  /** Equation of time, minutes. */
  eot: number
}

export function sun(date: Date): SunState {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  const n = (date.getTime() - start) / 86400000
  const g = ((2 * Math.PI) / 365) * n
  const dec =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)
  const eot =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g))
  return { dec, eot }
}

export interface MoonState {
  /** Sub-lunar latitude, degrees. */
  lat: number
  /** Sub-lunar longitude, degrees. */
  lon: number
  /** Illuminated fraction, 0..1. */
  illum: number
}

export function moon(date: Date): MoonState {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0
  const r = (x: number) => x * D
  const L = 218.316 + 13.176396 * d
  const M = 134.963 + 13.064993 * d
  const F = 93.272 + 13.22935 * d
  const lam = L + 6.289 * Math.sin(r(M))
  const bet = 5.128 * Math.sin(r(F))
  const e = r(23.4397)
  const sl = Math.sin(r(lam))
  const cl = Math.cos(r(lam))
  const tb = Math.tan(r(bet))
  const ra = Math.atan2(sl * Math.cos(e) - tb * Math.sin(e), cl) / D
  const dec = Math.asin(Math.sin(r(bet)) * Math.cos(e) + Math.cos(r(bet)) * Math.sin(e) * sl) / D
  const gmst = 280.147 + 360.9856235 * d
  const Ms = 357.529 + 0.98560028 * d
  const lamS = 280.459 + 0.98564736 * d + 1.915 * Math.sin(r(Ms)) + 0.02 * Math.sin(r(2 * Ms))
  return { lat: dec, lon: wrap(ra - gmst), illum: (1 - Math.cos(r(lam - lamS))) / 2 }
}

export type SolarTable = Record<PrayerKey, number>

// Recomputed constantly by the render loop but only varies meaningfully by whole
// degrees of latitude, so memoise on that.
const tableCache = new Map<string, SolarTable>()

/** Prayer boundaries in local *solar* hours, Diyanet angles (18° Fajr / 17° Isha). */
export function solarTable(lat: number, dec: number): SolarTable {
  const key = Math.round(lat) + '_' + Math.round(dec * 400)
  const hit = tableCache.get(key)
  if (hit) return hit
  const f = lat * D
  const H = (deg: number) => {
    const x = (Math.sin(deg * D) - Math.sin(f) * Math.sin(dec)) / (Math.cos(f) * Math.cos(dec))
    return Math.abs(x) > 1 ? NaN : Math.acos(x) / D / 15
  }
  const asrAlt = Math.atan(1 / (1 + Math.tan(Math.abs(f - dec)))) / D
  const t: SolarTable = {
    fajr: 12 - H(-18),
    rise: 12 - H(-0.833),
    dhuhr: 12.05,
    asr: 12 + H(asrAlt),
    set: 12 + H(-0.833),
    isha: 12 + H(-17),
  }
  tableCache.set(key, t)
  return t
}

export function altitude(lat: number, hourAngle: number, dec: number): number {
  return (
    Math.asin(
      Math.sin(lat * D) * Math.sin(dec) -
        Math.cos(lat * D) * Math.cos(dec) * Math.cos(hourAngle * 15 * D),
    ) / D
  )
}

/** Index into PHASES for a location at local solar time `st` (hours). */
export function phaseAt(lat: number, st: number, dec: number, table?: SolarTable): number {
  const t = table || solarTable(lat, dec)
  const ok = (v: number) => !isNaN(v)
  const x = ((st % 24) + 24) % 24
  if (!ok(t.rise)) return altitude(lat, x - 12, dec) > 0 ? 2 : 5
  if (ok(t.fajr) && x >= t.fajr && x < t.rise) return 0
  if (x >= t.rise && x < t.dhuhr) return 1
  if (ok(t.asr) && x >= t.dhuhr && x < t.asr) return 2
  if (ok(t.asr) && x >= t.asr && x < t.set) return 3
  if (ok(t.isha) && x >= t.set && x < t.isha) return 4
  return 5
}

/**
 * The current phase plus how far into the run-up to the next one we are.
 *
 * A city's dot changes colour the instant it crosses a boundary, which as the
 * terminator sweeps reads as a rank of dots snapping in turn. Returning the
 * approach to the next boundary lets the colour be crossfaded instead.
 */
export function phaseBlend(
  lat: number,
  st: number,
  dec: number,
  table?: SolarTable,
  /** Solar hours over which the next colour fades in. */
  window = 0.6,
): { phase: number; next: number; t: number } {
  const t0 = table || solarTable(lat, dec)
  const phase = phaseAt(lat, st, dec, t0)
  const x = ((st % 24) + 24) % 24

  // The next boundary ahead of `st`, wrapping past midnight.
  let bestGap = Infinity
  let nextPhase = phase
  for (const row of ROWS) {
    const b = t0[row.key]
    if (isNaN(b)) continue
    const gap = (((b - x) % 24) + 24) % 24
    if (gap > 0 && gap < bestGap) {
      bestGap = gap
      nextPhase = row.phase
    }
  }
  if (!isFinite(bestGap) || bestGap > window || nextPhase === phase) {
    return { phase, next: phase, t: 0 }
  }
  return { phase, next: nextPhase, t: 1 - bestGap / window }
}

/** Great-circle initial bearing from a point to the Kaaba, degrees. */
export function qibla(la: number, lo: number): number {
  const f1 = la * D
  const f2 = 21.4225 * D
  const dl = (39.8262 - lo) * D
  return (
    (Math.atan2(Math.sin(dl), Math.cos(f1) * Math.tan(f2) - Math.sin(f1) * Math.cos(dl)) / D + 360) %
    360
  )
}

export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const f1 = lat1 * D
  const f2 = lat2 * D
  const dl = (lon2 - lon1) * D
  return (
    Math.atan2(
      Math.sin(dl) * Math.cos(f2),
      Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl),
    ) / D
  )
}

/** A circle of `radiusDeg` angular radius around a point, as [lon,lat] pairs. */
export function ring(lat: number, lon: number, radiusDeg: number): [number, number][] {
  const pts: [number, number][] = []
  const f = lat * D
  const l = lon * D
  const r = radiusDeg * D
  for (let b = 0; b <= 360; b += 3) {
    const br = b * D
    const p = Math.asin(Math.sin(f) * Math.cos(r) + Math.cos(f) * Math.sin(r) * Math.cos(br))
    const q =
      l +
      Math.atan2(Math.sin(br) * Math.sin(r) * Math.cos(f), Math.cos(r) - Math.sin(f) * Math.sin(p))
    pts.push([wrap(q / D), p / D])
  }
  return pts
}

/**
 * Cut a ring wherever it crosses the antimeridian, interpolating a point exactly
 * on the seam so the halves still meet.
 *
 * Ring longitudes come out of `wrap()` folded into [-180, 180), so a circle
 * straddling ±180° contains a jump from +179 to -179. Drawn as a single
 * LineString that jump becomes a straight line clean across the globe. Emitting
 * the pieces as a MultiLineString instead is the whole fix for the edge curves.
 */
export function splitAtAntimeridian(points: [number, number][]): [number, number][][] {
  const out: [number, number][][] = []
  let seg: [number, number][] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (i > 0) {
      const prev = points[i - 1]
      if (Math.abs(p[0] - prev[0]) > 180) {
        // Which seam we crossed, and where along the step we crossed it.
        const side = p[0] - prev[0] < 0 ? 1 : -1
        const contLon = p[0] + 360 * side
        const t = (180 * side - prev[0]) / (contLon - prev[0])
        const lat = prev[1] + t * (p[1] - prev[1])
        seg.push([180 * side, lat])
        if (seg.length > 1) out.push(seg)
        seg = [[-180 * side, lat]]
      }
    }
    seg.push(p)
  }
  if (seg.length > 1) out.push(seg)
  return out
}

/**
 * Solar altitude that counts as the edge of daylight: refraction (~34′) plus the
 * sun's semi-diameter (~16′). The night fill and the drawn sunrise/sunset lines
 * must share this, or the shading sits a few degrees off its own boundary.
 */
export const SUN_EDGE_DEG = -0.833

/** Latitude beyond which Web Mercator (and therefore MapLibre's tiles) cannot go. */
export const MERCATOR_LIMIT = 85.0511

/**
 * Latitude at which the sun sits at `altDeg` for a given longitude.
 *
 * Solves sin(alt) = sinφ·sinδ + cosφ·cosδ·cos(H) for φ by writing the right-hand
 * side as R·sin(φ + ψ). That has two roots; only one is a real latitude, so both
 * are folded and the one inside ±90° wins.
 */
export function terminatorLatitude(
  dec: number,
  lonDeg: number,
  subLon: number,
  altDeg = SUN_EDGE_DEG,
): number {
  const H = (lonDeg - subLon) * D
  const A = Math.sin(dec)
  const B = Math.cos(dec) * Math.cos(H)
  const R = Math.hypot(A, B)
  if (R < 1e-9) return 0

  const s = Math.max(-1, Math.min(1, Math.sin(altDeg * D) / R))
  const psi = Math.atan2(B, A)
  const fold = (x: number) => {
    let v = x
    while (v > Math.PI) v -= 2 * Math.PI
    while (v < -Math.PI) v += 2 * Math.PI
    return v
  }
  for (const root of [Math.asin(s) - psi, Math.PI - Math.asin(s) - psi]) {
    const f = fold(root)
    if (f >= -Math.PI / 2 - 1e-9 && f <= Math.PI / 2 + 1e-9) {
      return Math.max(-90, Math.min(90, f / D))
    }
  }
  // Degenerate only at an exact equinox on the 6-hour meridian.
  return Math.atan(-Math.cos(H) / Math.tan(dec)) / D
}

/**
 * The night hemisphere as a polygon.
 *
 * A fill cannot be split the way a line can, and the night cap almost always
 * encloses a pole — so tracing it as a circle around the anti-solar point is
 * doubly broken. Walking longitude from -180 to 180 and closing over the dark
 * pole avoids the seam by construction and handles polar day/night for free.
 */
export function nightPolygon(
  dec: number,
  subLon: number,
  altDeg = SUN_EDGE_DEG,
): [number, number][] {
  const pts: [number, number][] = []
  for (let lon = -180; lon <= 180; lon += 1) {
    pts.push([lon, terminatorLatitude(dec, lon, subLon, altDeg)])
  }
  // Northern summer leaves the south pole dark, and vice versa.
  //
  // Close at the Mercator limit rather than the true pole: MapLibre tiles in
  // Web Mercator, where ±90° is infinitely far away and gets clipped at
  // ±85.0511°. Closing at ±90 leaves a degenerate edge that renders as a
  // straight chord slashing across the globe. Tracing back along the parallel
  // keeps the ring well-formed; the sliver beyond 85° is polar day or night in
  // its entirety, so nothing meaningful is lost.
  const pole = dec > 0 ? -MERCATOR_LIMIT : MERCATOR_LIMIT
  for (let lon = 180; lon >= -180; lon -= 10) pts.push([lon, pole])
  pts.push(pts[0])
  return pts
}

/**
 * The sunrise/sunset circle, split into the limb where the sun is coming up and
 * the limb where it is going down.
 *
 * Geometrically these are one closed curve, so the only thing separating them is
 * hour angle: west of the sub-solar meridian the sun is still rising, east of it
 * the sun is setting. The curve crosses that meridian exactly twice — at its
 * northern and southern extremes — giving two contiguous arcs.
 */
export function terminatorArcs(
  subLat: number,
  subLon: number,
  altDeg = SUN_EDGE_DEG,
): { sunrise: [number, number][][]; sunset: [number, number][][] } {
  // Drop the duplicated closing point so the runs below join cleanly.
  const loop = ring(-subLat, subLon + 180, 90 + altDeg).slice(0, -1)

  const runs: { rising: boolean; pts: [number, number][] }[] = []
  for (const p of loop) {
    const rising = wrap(p[0] - subLon) < 0
    const last = runs[runs.length - 1]
    if (last && last.rising === rising) last.pts.push(p)
    else runs.push({ rising, pts: [p] })
  }
  // The ring is closed, so a run straddling the array boundary arrives in two
  // halves — stitch the tail back onto the head.
  if (runs.length > 1 && runs[0].rising === runs[runs.length - 1].rising) {
    runs[runs.length - 1].pts.push(...runs[0].pts)
    runs.shift()
  }

  const collect = (want: boolean) =>
    runs.filter((r) => r.rising === want).flatMap((r) => splitAtAntimeridian(r.pts))

  return { sunrise: collect(true), sunset: collect(false) }
}

/** Simulated minutes between path samples. */
export const PATH_STEP_MIN = 12
/** Guard against an unbounded span; 1300 samples covers the full 10-day scrub. */
const PATH_MAX_SAMPLES = 1300

/**
 * The tracks the sun and moon trace between two instants.
 *
 * Sampled analytically from the clock rather than recorded while playing, so the
 * path is identical whether you scrubbed there or played there, and it unwinds
 * correctly when you rewind.
 *
 * Samples sit on a fixed grid anchored at `fromMs` rather than being spread
 * evenly across the span. Spreading them means every redraw resamples the whole
 * line on a slightly shifted grid, so the entire path shimmers as it grows; on a
 * fixed grid a point never moves once placed and only the tip advances.
 */
export function bodyPaths(fromMs: number, toMs: number, stepMinutes = PATH_STEP_MIN) {
  const sun: [number, number][] = []
  const moon: [number, number][] = []
  const span = toMs - fromMs
  const dir = span >= 0 ? 1 : -1
  const stepMs = stepMinutes * 60000
  const count = Math.min(PATH_MAX_SAMPLES, Math.floor(Math.abs(span) / stepMs))

  const at = (ms: number) => {
    const sky = skyState(new Date(ms))
    sun.push([sky.sun.lon, sky.sun.lat])
    moon.push([sky.moon.lon, sky.moon.lat])
  }

  for (let i = 0; i <= count; i++) at(fromMs + dir * i * stepMs)
  // Exact endpoint, so the tip tracks the body continuously between grid points.
  if (count * stepMs < Math.abs(span)) at(toMs)

  return { sun: splitAtAntimeridian(sun), moon: splitAtAntimeridian(moon) }
}

/** Hours since UTC midnight, fractional. */
export const utcHours = (date: Date): number =>
  date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600

export interface SkyState extends SunState {
  utcH: number
  sun: { lat: number; lon: number }
  moon: MoonState
}

/** Everything the globe overlays need for a given instant. */
export function skyState(date: Date): SkyState {
  const { dec, eot } = sun(date)
  const uh = utcHours(date)
  return {
    dec,
    eot,
    utcH: uh,
    sun: { lat: dec / D, lon: wrap(-15 * (uh + eot / 60 - 12)) },
    moon: moon(date),
  }
}
