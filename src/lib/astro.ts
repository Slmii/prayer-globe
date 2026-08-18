// Local astronomy, ported unchanged from the design canvas.
//
// This still drives everything the Diyanet API cannot give us: the terminator
// rings, the night polygon, the sub-solar / sub-lunar / midnight points, and the
// instant phase colour of all 143 city dots as you scrub time. Diyanet data
// takes over for the selected city's actual prayer times.

export const D = Math.PI / 180;

export interface Phase {
	tr: string;
	ar: string;
	c: string;
}

export const PHASES: Phase[] = [
	{ tr: 'Fajr', ar: 'الفجر', c: '#b5abfc' },
	{ tr: 'Duha', ar: 'الضحى', c: '#cfd3e5' },
	{ tr: 'Dhuhr', ar: 'الظهر', c: '#f5f4ff' },
	{ tr: 'Asr', ar: 'العصر', c: '#d2cefd' },
	{ tr: 'Maghrib', ar: 'المغرب', c: '#968ae0' },
	{ tr: 'Isha', ar: 'العشاء', c: '#6f63ad' }
];

/** Keys of the solar table, in the order they occur through a day. */
export type PrayerKey = 'fajr' | 'rise' | 'dhuhr' | 'asr' | 'set' | 'isha';

export interface RowSpec {
	label: string;
	ar: string;
	key: PrayerKey;
	/** Index into PHASES that this row highlights. */
	phase: number;
}

export const ROWS: RowSpec[] = [
	{ label: 'Fajr', ar: 'الفجر', key: 'fajr', phase: 0 },
	{ label: 'Shuruq', ar: 'الشروق', key: 'rise', phase: 1 },
	{ label: 'Dhuhr', ar: 'الظهر', key: 'dhuhr', phase: 2 },
	{ label: 'Asr', ar: 'العصر', key: 'asr', phase: 3 },
	{ label: 'Maghrib', ar: 'المغرب', key: 'set', phase: 4 },
	{ label: 'Isha', ar: 'العشاء', key: 'isha', phase: 5 }
];

export const pad = (n: number): string => String(n).padStart(2, '0');

export const fmt = (h: number): string => {
	const x = ((h % 24) + 24) % 24;
	const m = Math.round(x * 60);
	return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
};

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
export const wrap = (v: number): number => ((((v + 180) % 360) + 360) % 360) - 180;

export const lonTxt = (v: number): string => {
	const x = wrap(v);
	return Math.abs(x).toFixed(1) + '° ' + (x >= 0 ? 'E' : 'W');
};

export const latTxt = (v: number): string => Math.abs(v).toFixed(1) + '° ' + (v >= 0 ? 'N' : 'S');

export interface SunState {
	/** Declination, radians. */
	dec: number;
	/** Equation of time, minutes. */
	eot: number;
}

export function sun(date: Date): SunState {
	const start = Date.UTC(date.getUTCFullYear(), 0, 1);
	const n = (date.getTime() - start) / 86400000;
	const g = ((2 * Math.PI) / 365) * n;
	const dec =
		0.006918 -
		0.399912 * Math.cos(g) +
		0.070257 * Math.sin(g) -
		0.006758 * Math.cos(2 * g) +
		0.000907 * Math.sin(2 * g) -
		0.002697 * Math.cos(3 * g) +
		0.00148 * Math.sin(3 * g);
	const eot =
		229.18 *
		(0.000075 +
			0.001868 * Math.cos(g) -
			0.032077 * Math.sin(g) -
			0.014615 * Math.cos(2 * g) -
			0.040849 * Math.sin(2 * g));
	return { dec, eot };
}

export interface MoonState {
	/** Sub-lunar latitude, degrees. */
	lat: number;
	/** Sub-lunar longitude, degrees. */
	lon: number;
	/** Illuminated fraction, 0..1. */
	illum: number;
}

export function moon(date: Date): MoonState {
	const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
	const r = (x: number) => x * D;
	const L = 218.316 + 13.176396 * d;
	const M = 134.963 + 13.064993 * d;
	const F = 93.272 + 13.22935 * d;
	const lam = L + 6.289 * Math.sin(r(M));
	const bet = 5.128 * Math.sin(r(F));
	const e = r(23.4397);
	const sl = Math.sin(r(lam));
	const cl = Math.cos(r(lam));
	const tb = Math.tan(r(bet));
	const ra = Math.atan2(sl * Math.cos(e) - tb * Math.sin(e), cl) / D;
	const dec = Math.asin(Math.sin(r(bet)) * Math.cos(e) + Math.cos(r(bet)) * Math.sin(e) * sl) / D;
	const gmst = 280.147 + 360.9856235 * d;
	const Ms = 357.529 + 0.98560028 * d;
	const lamS = 280.459 + 0.98564736 * d + 1.915 * Math.sin(r(Ms)) + 0.02 * Math.sin(r(2 * Ms));
	return { lat: dec, lon: wrap(ra - gmst), illum: (1 - Math.cos(r(lam - lamS))) / 2 };
}

export type SolarTable = Record<PrayerKey, number>;

/**
 * Solar altitude that counts as the edge of daylight: refraction (~34′) plus the
 * sun's semi-diameter (~16′). The night fill and the drawn sunrise/sunset lines
 * must share this, or the shading sits a few degrees off its own boundary.
 */
export const SUN_EDGE_DEG = -0.833;

/**
 * Prayer boundaries in local *solar* hours, at an exact latitude.
 *
 * Uncached. `solarTable` is the one to reach for from the render loop; this is
 * for anything drawing a *boundary* rather than testing a point, where rounding
 * latitude to the nearest degree turns a smooth curve into a staircase.
 */
export function solarTableAt(lat: number, dec: number): SolarTable {
	const f = lat * D;
	const H = (deg: number) => {
		const x = (Math.sin(deg * D) - Math.sin(f) * Math.sin(dec)) / (Math.cos(f) * Math.cos(dec));
		return Math.abs(x) > 1 ? NaN : Math.acos(x) / D / 15;
	};
	const asrAlt = Math.atan(1 / (1 + Math.tan(Math.abs(f - dec)))) / D;
	return {
		fajr: 12 - H(-18),
		rise: 12 - H(SUN_EDGE_DEG),
		dhuhr: 12.05,
		asr: 12 + H(asrAlt),
		set: 12 + H(SUN_EDGE_DEG),
		isha: 12 + H(-17)
	};
}

// Recomputed constantly by the render loop for hundreds of city dots, and for a
// point a whole degree of latitude is close enough, so memoise on that.
const tableCache = new Map<string, SolarTable>();

/** `solarTableAt`, rounded to the nearest degree and cached. */
export function solarTable(lat: number, dec: number): SolarTable {
	const rounded = Math.round(lat);
	const key = rounded + '_' + Math.round(dec * 400);
	const hit = tableCache.get(key);
	if (hit) {
		return hit;
	}
	// Computed *at* the rounded latitude, so every caller sharing this key gets
	// the same answer rather than whichever one happened to ask first.
	const t = solarTableAt(rounded, dec);
	tableCache.set(key, t);
	return t;
}

/**
 * The sun's altitude in degrees at local solar time `st` (hours).
 *
 * Note the second argument is solar time itself — 0 is midnight, 12 is noon —
 * and not an hour angle measured from noon. The minus sign in front of the
 * cosine is what makes that so, and reading it as hours-from-noon puts every
 * answer exactly twelve hours out.
 */
export function altitude(lat: number, st: number, dec: number): number {
	return Math.asin(Math.sin(lat * D) * Math.sin(dec) - Math.cos(lat * D) * Math.cos(dec) * Math.cos(st * 15 * D)) / D;
}

/**
 * Which phase covers a whole day above the polar circles: Dhuhr or Isha.
 *
 * When the sun neither rises nor sets there are no boundaries to divide the day
 * with, so the whole day is one phase. Which one is settled by the sun's *lowest*
 * point — solar midnight — against the same horizon that defines sunrise and
 * sunset. Testing it against a flat zero instead, as both callers used to,
 * misjudged the ring where the midnight sun grazes between −0.833° and 0°: the
 * sun there never sets, yet it was called night and painted Isha across every
 * longitude at once, a cap over the pole that no city agreed with.
 */
export function polarPhase(lat: number, dec: number): 2 | 5 {
	return altitude(lat, 0, dec) > SUN_EDGE_DEG ? 2 : 5;
}

/** Index into PHASES for a location at local solar time `st` (hours). */
export function phaseAt(lat: number, st: number, dec: number, table?: SolarTable): number {
	const t = table || solarTable(lat, dec);
	const ok = (v: number) => !isNaN(v);
	const x = ((st % 24) + 24) % 24;
	if (!ok(t.rise)) {
		return polarPhase(lat, dec);
	}
	if (ok(t.fajr) && x >= t.fajr && x < t.rise) {
		return 0;
	}
	if (x >= t.rise && x < t.dhuhr) {
		return 1;
	}
	if (ok(t.asr) && x >= t.dhuhr && x < t.asr) {
		return 2;
	}
	if (ok(t.asr) && x >= t.asr && x < t.set) {
		return 3;
	}
	if (ok(t.isha) && x >= t.set && x < t.isha) {
		return 4;
	}
	return 5;
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
	window = 0.6
): { phase: number; next: number; t: number } {
	const t0 = table || solarTable(lat, dec);
	const phase = phaseAt(lat, st, dec, t0);
	const x = ((st % 24) + 24) % 24;

	// The next boundary ahead of `st`, wrapping past midnight.
	let bestGap = Infinity;
	let nextPhase = phase;
	for (const row of ROWS) {
		const b = t0[row.key];
		if (isNaN(b)) continue;
		const gap = (((b - x) % 24) + 24) % 24;
		if (gap > 0 && gap < bestGap) {
			bestGap = gap;
			nextPhase = row.phase;
		}
	}
	if (!isFinite(bestGap) || bestGap > window || nextPhase === phase) {
		return { phase, next: phase, t: 0 };
	}
	return { phase, next: nextPhase, t: 1 - bestGap / window };
}

/** The Kaaba, to the precision anything here needs. */
export const KAABA: [number, number] = [39.8262, 21.4225];

/**
 * The great-circle path between two points, as [lon, lat] pairs.
 *
 * This is what makes the qibla worth drawing. A bearing in degrees is correct
 * and says nothing; the path itself is the surprise — from Cape Town it leaves
 * heading north-east, from Alaska it goes over the pole, and neither looks
 * remotely like the straight line a flat map would draw between the same two
 * points. Sampling the true arc is the whole point, so this interpolates along
 * the sphere (spherical linear interpolation of the two unit vectors) rather
 * than between the coordinates.
 *
 * The result is fed straight to a GeoJSON LineString, so it has the same
 * antimeridian problem as everything else here: a path crossing ±180 has to be
 * split before drawing or it will be painted straight back across the map. Pass
 * the result through `splitAtAntimeridian`.
 */
export function greatCircle(from: [number, number], to: [number, number], steps = 128): [number, number][] {
	const [lo1, la1] = from;
	const [lo2, la2] = to;
	const f1 = la1 * D;
	const f2 = la2 * D;
	const l1 = lo1 * D;
	const l2 = lo2 * D;

	const a = [Math.cos(f1) * Math.cos(l1), Math.cos(f1) * Math.sin(l1), Math.sin(f1)];
	const b = [Math.cos(f2) * Math.cos(l2), Math.cos(f2) * Math.sin(l2), Math.sin(f2)];

	const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
	const arc = Math.acos(dot);
	const pts: [number, number][] = [];

	// Coincident, or as near as makes no difference: the interpolation below
	// divides by sin(arc), so bail before it goes to infinity.
	if (arc < 1e-9) {
		return [[lo1, la1]];
	}

	const sin = Math.sin(arc);
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const ka = Math.sin((1 - t) * arc) / sin;
		const kb = Math.sin(t * arc) / sin;
		const x = ka * a[0] + kb * b[0];
		const y = ka * a[1] + kb * b[1];
		const z = ka * a[2] + kb * b[2];
		pts.push([Math.atan2(y, x) / D, Math.atan2(z, Math.hypot(x, y)) / D]);
	}
	return pts;
}

/** The great circle from a city to the Kaaba — the qibla, drawn. */
export const qiblaPath = (la: number, lo: number, steps = 128): [number, number][] =>
	greatCircle([lo, la], KAABA, steps);

/** Great-circle initial bearing from a point to the Kaaba, degrees. */
export function qibla(la: number, lo: number): number {
	const f1 = la * D;
	const f2 = 21.4225 * D;
	const dl = (39.8262 - lo) * D;
	return (Math.atan2(Math.sin(dl), Math.cos(f1) * Math.tan(f2) - Math.sin(f1) * Math.cos(dl)) / D + 360) % 360;
}

export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const f1 = lat1 * D;
	const f2 = lat2 * D;
	const dl = (lon2 - lon1) * D;
	return (
		Math.atan2(
			Math.sin(dl) * Math.cos(f2),
			Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)
		) / D
	);
}

/** A circle of `radiusDeg` angular radius around a point, as [lon,lat] pairs. */
export function ring(lat: number, lon: number, radiusDeg: number): [number, number][] {
	const pts: [number, number][] = [];
	const f = lat * D;
	const l = lon * D;
	const r = radiusDeg * D;
	for (let b = 0; b <= 360; b += 3) {
		const br = b * D;
		const p = Math.asin(Math.sin(f) * Math.cos(r) + Math.cos(f) * Math.sin(r) * Math.cos(br));
		const q = l + Math.atan2(Math.sin(br) * Math.sin(r) * Math.cos(f), Math.cos(r) - Math.sin(f) * Math.sin(p));
		pts.push([wrap(q / D), p / D]);
	}
	return pts;
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
	const out: [number, number][][] = [];
	let seg: [number, number][] = [];
	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		if (i > 0) {
			const prev = points[i - 1];
			if (Math.abs(p[0] - prev[0]) > 180) {
				// Which seam we crossed, and where along the step we crossed it.
				const side = p[0] - prev[0] < 0 ? 1 : -1;
				const contLon = p[0] + 360 * side;
				const t = (180 * side - prev[0]) / (contLon - prev[0]);
				const lat = prev[1] + t * (p[1] - prev[1]);
				seg.push([180 * side, lat]);
				if (seg.length > 1) out.push(seg);
				seg = [[-180 * side, lat]];
			}
		}
		seg.push(p);
	}
	if (seg.length > 1) out.push(seg);
	return out;
}

/** Latitude beyond which Web Mercator (and therefore MapLibre's tiles) cannot go. */
export const MERCATOR_LIMIT = 85.0511;

/**
 * How far a fill can actually be drawn towards a pole.
 *
 * Not the same thing as `MERCATOR_LIMIT`, which is where the tile pyramid stops.
 * MapLibre's globe keeps drawing past it: measured on the running map, a fill
 * whose vertices reach 89.9° paints continuously from 85° to about 88° and then
 * gives out. Ending the polar cap at the tile limit therefore left three degrees
 * of *renderable* surface empty — a hole around each pole whose edge is a circle
 * of latitude, which is exactly what the chain band's "circles and half circles"
 * turned out to be.
 *
 * Geometry beyond what the renderer will draw costs nothing and is simply
 * clipped, so this asks for the pole itself and takes whatever it is given.
 */
export const FILL_LIMIT = 89.9;

/**
 * Where a prayer band stops following longitude and becomes a plain polar cap.
 *
 * Close to the Mercator limit, so it overrides as little real ground as
 * possible, but below it, because the last half-degree is what MapLibre smears
 * over the whole pole.
 */
export const CAP_LAT = 84.5;

/**
 * Latitude at which the sun sits at `altDeg` for a given longitude.
 *
 * Solves sin(alt) = sinφ·sinδ + cosφ·cosδ·cos(H) for φ by writing the right-hand
 * side as R·sin(φ + ψ). That has two roots; only one is a real latitude, so both
 * are folded and the one inside ±90° wins.
 */
export function terminatorLatitude(dec: number, lonDeg: number, subLon: number, altDeg = SUN_EDGE_DEG): number {
	const H = (lonDeg - subLon) * D;
	const A = Math.sin(dec);
	const B = Math.cos(dec) * Math.cos(H);
	const R = Math.hypot(A, B);
	if (R < 1e-9) {
		return 0;
	}

	const s = Math.max(-1, Math.min(1, Math.sin(altDeg * D) / R));
	const psi = Math.atan2(B, A);
	const fold = (x: number) => {
		let v = x;
		while (v > Math.PI) v -= 2 * Math.PI;
		while (v < -Math.PI) v += 2 * Math.PI;
		return v;
	};
	for (const root of [Math.asin(s) - psi, Math.PI - Math.asin(s) - psi]) {
		const f = fold(root);
		if (f >= -Math.PI / 2 - 1e-9 && f <= Math.PI / 2 + 1e-9) {
			return Math.max(-90, Math.min(90, f / D));
		}
	}
	// Degenerate only at an exact equinox on the 6-hour meridian.
	return Math.atan(-Math.cos(H) / Math.tan(dec)) / D;
}

/**
 * The night hemisphere as a polygon.
 *
 * A fill cannot be split the way a line can, and the night cap almost always
 * encloses a pole — so tracing it as a circle around the anti-solar point is
 * doubly broken. Walking longitude from -180 to 180 and closing over the dark
 * pole avoids the seam by construction and handles polar day/night for free.
 */
export function nightPolygon(dec: number, subLon: number, altDeg = SUN_EDGE_DEG): [number, number][] {
	const pts: [number, number][] = [];
	for (let lon = -180; lon <= 180; lon += 1) {
		pts.push([lon, terminatorLatitude(dec, lon, subLon, altDeg)]);
	}
	// Northern summer leaves the south pole dark, and vice versa.
	//
	// Close at the Mercator limit rather than the true pole: MapLibre tiles in
	// Web Mercator, where ±90° is infinitely far away and gets clipped at
	// ±85.0511°. Closing at ±90 leaves a degenerate edge that renders as a
	// straight chord slashing across the globe. Tracing back along the parallel
	// keeps the ring well-formed; the sliver beyond 85° is polar day or night in
	// its entirety, so nothing meaningful is lost.
	const pole = dec > 0 ? -MERCATOR_LIMIT : MERCATOR_LIMIT;
	for (let lon = 180; lon >= -180; lon -= 10) pts.push([lon, pole]);
	pts.push(pts[0]);
	return pts;
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
	altDeg = SUN_EDGE_DEG
): { sunrise: [number, number][][]; sunset: [number, number][][] } {
	// Drop the duplicated closing point so the runs below join cleanly.
	const loop = ring(-subLat, subLon + 180, 90 + altDeg).slice(0, -1);

	const runs: { rising: boolean; pts: [number, number][] }[] = [];
	for (const p of loop) {
		const rising = wrap(p[0] - subLon) < 0;
		const last = runs[runs.length - 1];
		if (last && last.rising === rising) last.pts.push(p);
		else runs.push({ rising, pts: [p] });
	}
	// The ring is closed, so a run straddling the array boundary arrives in two
	// halves — stitch the tail back onto the head.
	if (runs.length > 1 && runs[0].rising === runs[runs.length - 1].rising) {
		runs[runs.length - 1].pts.push(...runs[0].pts);
		runs.shift();
	}

	const collect = (want: boolean) => runs.filter(r => r.rising === want).flatMap(r => splitAtAntimeridian(r.pts));

	return { sunrise: collect(true), sunset: collect(false) };
}

/** Simulated minutes between path samples. */
export const PATH_STEP_MIN = 12;
/** Guard against an unbounded span; 1300 samples covers the full 10-day scrub. */
const PATH_MAX_SAMPLES = 1300;

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
	const sun: [number, number][] = [];
	const moon: [number, number][] = [];
	const span = toMs - fromMs;
	const dir = span >= 0 ? 1 : -1;
	const stepMs = stepMinutes * 60000;
	const count = Math.min(PATH_MAX_SAMPLES, Math.floor(Math.abs(span) / stepMs));

	const at = (ms: number) => {
		const sky = skyState(new Date(ms));
		sun.push([sky.sun.lon, sky.sun.lat]);
		moon.push([sky.moon.lon, sky.moon.lat]);
	};

	for (let i = 0; i <= count; i++) at(fromMs + dir * i * stepMs);
	// Exact endpoint, so the tip tracks the body continuously between grid points.
	if (count * stepMs < Math.abs(span)) at(toMs);

	return { sun: splitAtAntimeridian(sun), moon: splitAtAntimeridian(moon) };
}

/** Hours since UTC midnight, fractional. */
export const utcHours = (date: Date): number =>
	date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

export interface SkyState extends SunState {
	utcH: number;
	sun: { lat: number; lon: number };
	moon: MoonState;
}

/** Everything the globe overlays need for a given instant. */
export function skyState(date: Date): SkyState {
	const { dec, eot } = sun(date);
	const uh = utcHours(date);
	return {
		dec,
		eot,
		utcH: uh,
		sun: { lat: dec / D, lon: wrap(-15 * (uh + eot / 60 - 12)) },
		moon: moon(date)
	};
}

/**
 * The band of the earth currently standing in one prayer.
 *
 * The chain mode's whole point is that a prayer is a *place* as well as a time —
 * a strip of the world moving steadily westward. The dots already say which
 * cities are in it; this says which ground is.
 *
 * Built by latitude row, not by sampling a grid. For any latitude the prayer
 * occupies one exact interval of local solar time, and solar time maps straight
 * onto longitude, so each row's eastern and western edges are computed rather
 * than searched for. That matters for motion as much as accuracy: an earlier
 * version tested a fixed grid of meridians, which meant the band could only ever
 * be a whole grid cell wide and lurched two degrees sideways each time the sun
 * crossed a column. These edges move continuously with the clock.
 *
 * Rows are still discrete — the band is a stack of quads — but that only
 * quantises it vertically, and vertically is the one direction it does not move.
 */
export function phaseBand(phase: number, dec: number, utcH: number, eot: number, latStep = 0.75): [number, number][][] {
	const quads: [number, number][][] = [];

	/** The solar-hour interval this phase runs over, at one latitude. */
	const spanFor = (t: SolarTable, lat: number): [number, number] | null => {
		const ok = (v: number) => !isNaN(v);

		// Above the circles the sun may never rise or never set, and there are no
		// boundaries to work from. `phaseAt` calls the whole day Dhuhr under a
		// midnight sun and Isha under a polar night, so the band has to agree or it
		// simply loses the poles — which is exactly how it first failed, with a
		// quarter of Dhuhr's ground missing in mid-August.
		if (!ok(t.rise)) {
			return phase === polarPhase(lat, dec) ? [0, 24] : null;
		}

		switch (phase) {
			case 0:
				return ok(t.fajr) && ok(t.rise) ? [t.fajr, t.rise] : null;
			case 1:
				return ok(t.rise) ? [t.rise, t.dhuhr] : null;
			case 2:
				return ok(t.asr) ? [t.dhuhr, t.asr] : null;
			case 3:
				return ok(t.asr) && ok(t.set) ? [t.asr, t.set] : null;
			case 4:
				return ok(t.set) && ok(t.isha) ? [t.set, t.isha] : null;
			// Isha runs from nightfall to the next dawn, so it crosses midnight — and
			// it is also `phaseAt`'s catch-all, which matters more than it sounds.
			//
			// Between roughly 58° and 75° in August the sun sets but never reaches 17°
			// below the horizon, so isha and fajr are both undefined. `phaseAt` falls
			// through to Isha for that whole stretch, and requiring both boundaries
			// here left a band that simply stopped at 58°N while the dots above it
			// stayed lit — the two disagreeing about the same sky. So the ends fall
			// back to sunset and sunrise, which always exist once the sun rises at all.
			case 5:
				return ok(t.set) ? [ok(t.isha) ? t.isha : t.set, (ok(t.fajr) ? t.fajr : t.rise) + 24] : null;
			default:
				return null;
		}
	};

	/**
	 * Emit the quads for one latitude row, splitting it if the phase begins partway
	 * through.
	 *
	 * A row is described by its middle, which is right almost everywhere and wrong
	 * at the polar circles, where whether the sun rises at all can change within
	 * three quarters of a degree. At the December solstice the sun rises at 67.3°N
	 * and does not at 67.6°N: sampling the middle dropped the entire Fajr ring at
	 * that latitude while the dots sitting on it stayed lit. So when a row's two
	 * edges disagree about whether the phase exists there, halve it and ask again.
	 * Only boundary rows recurse, and three levels put the edge within a tenth of
	 * a degree of where it truly falls.
	 */
	const emitRow = (lo: number, hi: number, depth: number): void => {
		const mid = (lo + hi) / 2;

		if (depth < 4) {
			const atLo = spanFor(solarTableAt(lo, dec), lo);
			const atHi = spanFor(solarTableAt(hi, dec), hi);
			const gone = (atLo === null) !== (atHi === null);
			// A width that jumps is the same fault as one that appears. Crossing the
			// midnight-sun limit, Dhuhr goes from a few hours wide to the whole day at
			// once, so a row landing on that step is either a thin band or a complete
			// ring — and picking the ring painted a spurious hoop right round the
			// globe three quarters of a degree from where it belonged.
			const jumped = atLo != null && atHi != null && Math.abs(atHi[1] - atHi[0] - (atLo[1] - atLo[0])) * 15 > 45;
			if (gone || jumped) {
				emitRow(lo, mid, depth + 1);
				emitRow(mid, hi, depth + 1);
				return;
			}
		}

		const span = spanFor(solarTableAt(mid, dec), mid);
		if (!span) return;

		const width = (span[1] - span[0]) * 15;
		if (width <= 0) return;

		// Solar time to longitude: st = utcH + lon/15 + eot/60.
		const west = wrap((span[0] - utcH - eot / 60) * 15);

		// A row wider than the map, or one running off the eastern edge, is cut at
		// the antimeridian rather than drawn back across the whole world.
		let start = west;
		let left = Math.min(width, 360);
		while (left > 0.001) {
			const end = Math.min(180, start + left);
			quads.push([
				[start, lo],
				[end, lo],
				[end, hi],
				[start, hi],
				[start, lo]
			]);
			left -= end - start;
			start = -180;
		}
	};

	// A cap is only one phase when the sun has stopped rising and setting there.
	// At the equinoxes 84.5° still has an ordinary twelve-hour day, and the ground
	// under the cap runs through every prayer like anywhere else — so the rows
	// carry on to the edge of the map and no cap is drawn.
	const capped = (pole: 1 | -1) => isNaN(solarTableAt(pole * CAP_LAT, dec).rise);
	// Where no cap is drawn — at the equinoxes, when 84.5° still has an ordinary
	// day — the rows themselves run to the fill limit instead, for the same
	// reason: whatever the renderer will draw should be drawn.
	const north = capped(1) ? CAP_LAT : FILL_LIMIT;
	const south = capped(-1) ? CAP_LAT : FILL_LIMIT;

	for (let lat = -south; lat < north; lat += latStep) {
		emitRow(lat, Math.min(north, lat + latStep), 0);
	}

	// The caps stop where the hatch can be drawn; `phaseCap` covers the rest.
	//
	// Longitude is meaningless at 90°: solar time is undefined there, every
	// boundary in the table degenerates, and the pole belongs to exactly one
	// phase — Dhuhr under a midnight sun, Isha under a polar night. So the last
	// stretch is drawn as what the pole actually is: one phase, the whole way
	// round, or nothing at all.
	for (const pole of [1, -1] as const) {
		if (!capped(pole)) continue;
		if (phase !== polarPhase(pole * CAP_LAT, dec)) continue;
		const lo = pole === 1 ? CAP_LAT : -MERCATOR_LIMIT;
		const hi = pole === 1 ? MERCATOR_LIMIT : -CAP_LAT;
		quads.push(capRing(lo, hi));
	}

	return quads;
}

/**
 * Where a prayer's band is centred, as somewhere to point the camera.
 *
 * Taken from the geometry rather than from the cities in it, so it still has an
 * answer when the band is out over an ocean holding none — which is exactly when
 * you most want to be shown where it went.
 *
 * The equator is tried first and latitudes are walked outward from there: a
 * prayer that does not occur at the equator (Fajr under a midnight sun, say)
 * still occurs somewhere, and the first row that has it is a fair target.
 */
export function phaseCentre(
	phase: number,
	dec: number,
	utcH: number,
	eot: number
): { lat: number; lon: number } | null {
	for (let step = 0; step <= 80; step += 5) {
		for (const lat of step === 0 ? [0] : [step, -step]) {
			const quads = phaseBand(phase, dec, utcH, eot, 2).filter(q => {
				const mid = (q[0][1] + q[2][1]) / 2;
				return Math.abs(mid - lat) <= 1.5;
			});
			if (!quads.length) continue;
			// Middle of the widest run at this latitude — with a band cut at the
			// antimeridian, the widest piece is the one worth looking at.
			const widest = quads.reduce((a, b) => (b[1][0] - b[0][0] > a[1][0] - a[0][0] ? b : a));
			return { lat, lon: wrap((widest[0][0] + widest[1][0]) / 2) };
		}
	}
	return null;
}

/**
 * A ring right round the earth between two latitudes.
 *
 * Densified rather than four corners: as four points a cap is two 360°-long
 * edges, which tessellate into a shape with no useful area near a pole, and the
 * fill never appears at all.
 */
function capRing(lo: number, hi: number): [number, number][] {
	const ring: [number, number][] = [];
	for (let lon = -180; lon <= 180; lon += 10) ring.push([lon, lo]);
	for (let lon = 180; lon >= -180; lon -= 10) ring.push([lon, hi]);
	ring.push([-180, lo]);
	return ring;
}

/**
 * The very top of the world, which the hatched band cannot reach.
 *
 * MapLibre will not render a `fill-pattern` above the Mercator tile limit — the
 * pattern needs tile-space texture coordinates that stop existing at 85.05° —
 * but it renders a plain `fill-color` there perfectly well. Measured on the
 * running map: a solid fill paints to about 88°, a patterned one paints nothing.
 *
 * That single fact was the whole of the band's polar trouble. Everything above
 * the limit stayed empty, and the edge of an empty region bounded by a parallel
 * is a circle — the "circles and half circles" that kept appearing over the
 * poles no matter how the geometry below them was fixed.
 *
 * So this returns the cap above the limit, to be drawn by a second layer in flat
 * colour. Empty when the pole is not in this phase, or when it still has days
 * and therefore has no single phase to be.
 */
export function phaseCap(phase: number, dec: number): [number, number][][] {
	const out: [number, number][][] = [];
	for (const pole of [1, -1] as const) {
		if (!isNaN(solarTableAt(pole * CAP_LAT, dec).rise)) continue;
		if (phase !== polarPhase(pole * CAP_LAT, dec)) continue;
		out.push(pole === 1 ? capRing(MERCATOR_LIMIT, FILL_LIMIT) : capRing(-FILL_LIMIT, -MERCATOR_LIMIT));
	}
	return out;
}
