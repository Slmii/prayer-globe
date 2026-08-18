// Whether the new crescent can be seen — the question the Hijri calendar turns on.
//
// After conjunction the moon is not visible: it is too close to the sun, too
// thin, and it sets too soon after it. Some hours later, somewhere on earth, it
// becomes visible for the first time, and the boundary between "seen" and "not
// seen" sweeps across the globe as a set of curved bands trailing sunset. This
// module answers, for one place on one evening, which side of that boundary it
// falls on.
//
// WHY IT HAS ITS OWN EPHEMERIS
//
// `astro.ts` positions the sun and moon well enough to draw them on a globe:
// its `moon()` keeps a single periodic term in longitude and returns no
// distance at all. That is fine for a dot. It is nowhere near enough here, for
// two reasons that both come down to the same thing — the numbers that decide
// visibility are small, and the errors are not.
//
//   * Parallax. The moon is close enough that where you stand shifts it by up
//     to about a degree. The whole judgement turns on the moon's altitude
//     above the horizon at sunset, which is often only a few degrees, so a
//     geocentric position puts the bands visibly in the wrong place. Parallax
//     needs distance, which requires the real periodic series.
//   * The Danjon limit. Below roughly 7° of elongation no crescent has ever
//     been seen, at any aperture. Deciding which side of that a place falls on
//     with a half-degree ephemeris is not deciding anything.
//
// So: Meeus, abridged. The lunar series here is the largest terms of tables
// 47.A and 47.B, which is accurate to well under an arcminute — two orders
// better than the thresholds care about, and small enough to read.
//
// WHAT IT DOES NOT KNOW
//
// Geometry only. It has nothing to say about haze, cloud, dust, a mountain on
// the western horizon, or the observer's eyesight. A "visible" verdict means
// the sky permits it, never that anyone did see it.

import { D } from './astro';

/** Earth's equatorial radius, km — for the moon's horizontal parallax. */
const EARTH_KM = 6378.14;

const sin = (deg: number) => Math.sin(deg * D);
const cos = (deg: number) => Math.cos(deg * D);
const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** Julian Day from a JS instant. */
export const toJD = (ms: number): number => ms / 86400000 + 2440587.5;
export const fromJD = (jd: number): number => (jd - 2440587.5) * 86400000;

/**
 * Terms of Meeus table 47.A, as [D, M, M', F, Σl, Σr].
 *
 * Truncated to the terms that matter at this precision: everything dropped is
 * below ~300 in Σl, which is 0.0003° — a hundredth of the smallest quantity any
 * criterion here tests. Σl is in 1e-6 degrees, Σr in 1e-3 km.
 */
const LR: [number, number, number, number, number, number][] = [
	[0, 0, 1, 0, 6288774, -20905355],
	[2, 0, -1, 0, 1274027, -3699111],
	[2, 0, 0, 0, 658314, -2955968],
	[0, 0, 2, 0, 213618, -569925],
	[0, 1, 0, 0, -185116, 48888],
	[0, 0, 0, 2, -114332, -3149],
	[2, 0, -2, 0, 58793, 246158],
	[2, -1, -1, 0, 57066, -152138],
	[2, 0, 1, 0, 53322, -170733],
	[2, -1, 0, 0, 45758, -204586],
	[0, 1, -1, 0, -40923, -129620],
	[1, 0, 0, 0, -34720, 108743],
	[0, 1, 1, 0, -30383, 104755],
	[2, 0, 0, -2, 15327, 10321],
	[0, 0, 1, 2, -12528, 0],
	[0, 0, 1, -2, 10980, 79661],
	[4, 0, -1, 0, 10675, -34782],
	[0, 0, 3, 0, 10034, -23210],
	[4, 0, -2, 0, 8548, -21636],
	[2, 1, -1, 0, -7888, 24208],
	[2, 1, 0, 0, -6766, 30824],
	[1, 0, -1, 0, -5163, -8379],
	[1, 1, 0, 0, 4987, -16675],
	[2, -1, 1, 0, 4036, -12831],
	[2, 0, 2, 0, 3994, -10445],
	[4, 0, 0, 0, 3861, -11650],
	[2, 0, -3, 0, 3665, 14403],
	[0, 1, -2, 0, -2689, -7003],
	[2, 0, -1, 2, -2602, 0],
	[2, -1, -2, 0, 2390, 10056],
	[1, 0, 1, 0, -2348, 6322],
	[2, -2, 0, 0, 2236, -9884],
	[0, 1, 2, 0, -2120, 5751],
	[0, 2, 0, 0, -2069, 0],
	[2, -2, -1, 0, 2048, -4950],
	[2, 0, 1, -2, -1773, 4130],
	[2, 0, 0, 2, -1595, 0],
	[4, -1, -1, 0, 1215, -3958],
	[0, 0, 2, 2, -1110, 0],
	[3, 0, -1, 0, -892, 3258],
	[2, 1, 1, 0, -810, 2616],
	[4, -1, -2, 0, 759, -1897],
	[0, 2, -1, 0, -713, -2117],
	[2, 2, -1, 0, -700, 2354],
	[2, 1, -2, 0, 691, 0],
	[2, -1, 0, -2, 596, 0],
	[4, 0, 1, 0, 549, -1423],
	[0, 0, 4, 0, 537, -1117],
	[4, -1, 0, 0, 520, -1571],
	[1, 0, -2, 0, -487, -1739],
	[2, 1, 0, -2, -399, 0],
	[0, 0, 2, -2, -381, -4421],
	[1, 1, 1, 0, 351, 0],
	[3, 0, -2, 0, -340, 0],
	[4, 0, -3, 0, 330, 0],
	[2, -1, 2, 0, 327, 0],
	[0, 2, 1, 0, -323, 1165],
	[1, 1, -1, 0, 299, 0],
	[2, 0, 3, 0, 294, 0],
	[2, 0, -1, -2, 0, 8752]
];

/** Terms of Meeus table 47.B, as [D, M, M', F, Σb], Σb in 1e-6 degrees. */
const B: [number, number, number, number, number][] = [
	[0, 0, 0, 1, 5128122],
	[0, 0, 1, 1, 280602],
	[0, 0, 1, -1, 277693],
	[2, 0, 0, -1, 173237],
	[2, 0, -1, 1, 55413],
	[2, 0, -1, -1, 46271],
	[2, 0, 0, 1, 32573],
	[0, 0, 2, 1, 17198],
	[2, 0, 1, -1, 9266],
	[0, 0, 2, -1, 8822],
	[2, -1, 0, -1, 8216],
	[2, 0, -2, -1, 4324],
	[2, 0, 1, 1, 4200],
	[2, 1, 0, -1, -3359],
	[2, -1, -1, 1, 2463],
	[2, -1, 0, 1, 2211],
	[2, -1, -1, -1, 2065],
	[0, 1, -1, -1, -1870],
	[4, 0, -1, -1, 1828],
	[0, 1, 0, 1, -1794],
	[0, 0, 0, 3, -1749],
	[0, 1, -1, 1, -1565],
	[1, 0, 0, 1, -1491],
	[0, 1, 1, 1, -1475],
	[0, 1, 1, -1, -1410],
	[0, 1, 0, -1, -1344],
	[1, 0, 0, -1, -1335],
	[0, 0, 3, 1, 1107],
	[4, 0, 0, -1, 1021],
	[4, 0, -1, 1, 833]
];

export interface Ecliptic {
	/** Apparent geocentric ecliptic longitude, degrees. */
	lam: number;
	/** Ecliptic latitude, degrees. */
	bet: number;
	/** Distance from earth's centre — km for the moon, AU for the sun. */
	dist: number;
}

/** The moon's geocentric position. Meeus ch. 47, abridged. */
export function moonPosition(jd: number): Ecliptic {
	const T = (jd - 2451545) / 36525;
	const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + (T * T * T) / 538841;
	const Dm = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + (T * T * T) / 545868;
	const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T;
	const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + (T * T * T) / 69699;
	const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T * T - (T * T * T) / 3526000;
	// The sun's eccentricity drifts, and terms in M are scaled by it.
	const E = 1 - 0.002516 * T - 0.0000074 * T * T;

	let sl = 0;
	let sr = 0;
	for (const [d, m, mp, f, cl, cr] of LR) {
		const arg = d * Dm + m * M + mp * Mp + f * F;
		const e = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
		sl += cl * e * sin(arg);
		sr += cr * e * cos(arg);
	}
	let sb = 0;
	for (const [d, m, mp, f, cb] of B) {
		const arg = d * Dm + m * M + mp * Mp + f * F;
		const e = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
		sb += cb * e * sin(arg);
	}

	// Additive terms: Venus (A1), Jupiter (A2) and the flattening of the earth.
	const A1 = 119.75 + 131.849 * T;
	const A2 = 53.09 + 479264.29 * T;
	const A3 = 313.45 + 481266.484 * T;
	sl += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
	sb +=
		-2235 * sin(Lp) +
		382 * sin(A3) +
		175 * sin(A1 - F) +
		175 * sin(A1 + F) +
		127 * sin(Lp - Mp) -
		115 * sin(Lp + Mp);

	return { lam: norm(Lp + sl / 1e6), bet: sb / 1e6, dist: 385000.56 + sr / 1000 };
}

/** The sun's geocentric position. Meeus ch. 25, low accuracy — ~0.01°. */
export function sunPosition(jd: number): Ecliptic {
	const T = (jd - 2451545) / 36525;
	const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
	const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
	const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
	const C =
		(1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) +
		(0.019993 - 0.000101 * T) * sin(2 * M) +
		0.000289 * sin(3 * M);
	const trueLon = L0 + C;
	const v = M + C;
	const R = (1.000001018 * (1 - e * e)) / (1 + e * cos(v));
	const omega = 125.04 - 1934.136 * T;
	// Apparent: aberration, and the largest nutation term.
	return { lam: norm(trueLon - 0.00569 - 0.00478 * sin(omega)), bet: 0, dist: R };
}

/** True obliquity of the ecliptic, degrees. */
export function obliquity(jd: number): number {
	const T = (jd - 2451545) / 36525;
	const e0 = 23.43929111 - 0.013004167 * T - 1.6389e-7 * T * T + 5.0361e-7 * T * T * T;
	const omega = 125.04 - 1934.136 * T;
	return e0 + 0.00256 * cos(omega);
}

export interface Equatorial {
	/** Right ascension, degrees. */
	ra: number;
	/** Declination, degrees. */
	dec: number;
}

export function toEquatorial(p: Ecliptic, eps: number): Equatorial {
	const ra = Math.atan2(sin(p.lam) * cos(eps) - Math.tan(p.bet * D) * sin(eps), cos(p.lam)) / D;
	const dec = Math.asin(sin(p.bet) * cos(eps) + cos(p.bet) * sin(eps) * sin(p.lam)) / D;
	return { ra: norm(ra), dec };
}

/** Greenwich apparent sidereal time, degrees. Meeus 12.4. */
export function gmst(jd: number): number {
	const T = (jd - 2451545) / 36525;
	return norm(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - (T * T * T) / 38710000);
}

/**
 * Shift a geocentric position to where an observer on the surface sees it.
 *
 * Meeus ch. 40. For the sun this is a rounding error; for the moon it is the
 * difference between a band in the right place and one a hundred kilometres
 * off, because the parallax is comparable to the altitude being measured.
 */
export function topocentric(eq: Equatorial, distKm: number, lat: number, lon: number, jd: number): Equatorial {
	const par = Math.asin(EARTH_KM / distKm) / D;
	// Observer's geocentric coordinates, on the reference ellipsoid at sea level.
	const u = Math.atan(0.99664719 * Math.tan(lat * D));
	const rhoSin = 0.99664719 * Math.sin(u);
	const rhoCos = Math.cos(u);
	const H = norm(gmst(jd) + lon - eq.ra);
	const denom = cos(eq.dec) - rhoCos * sin(par) * cos(H);
	const dRa = Math.atan2(-rhoCos * sin(par) * sin(H), denom) / D;
	const dec = Math.atan2((sin(eq.dec) - rhoSin * sin(par)) * cos(dRa), denom) / D;
	return { ra: norm(eq.ra + dRa), dec };
}

export interface AltAz {
	/** Altitude above the true horizon, degrees. */
	alt: number;
	/** Azimuth east of north, degrees. */
	az: number;
}

export function altAz(eq: Equatorial, lat: number, lon: number, jd: number): AltAz {
	const H = norm(gmst(jd) + lon - eq.ra);
	const alt = Math.asin(sin(lat) * sin(eq.dec) + cos(lat) * cos(eq.dec) * cos(H)) / D;
	const az = norm(Math.atan2(sin(H), cos(H) * sin(lat) - Math.tan(eq.dec * D) * cos(lat)) / D + 180);
	return { alt, az };
}

/** Geometric altitude of the sun's centre, degrees. */
function sunAlt(jd: number, lat: number, lon: number): number {
	const eps = obliquity(jd);
	return altAz(toEquatorial(sunPosition(jd), eps), lat, lon, jd).alt;
}

export type MoonTrack = (jd: number) => { eq: Equatorial; dist: number };

/**
 * The moon's geocentric track over an evening, sampled once.
 *
 * Finding moonset means asking for the moon's altitude a hundred-odd times
 * while the search closes in, and the full series behind each answer is ninety
 * periodic terms — twenty times the cost of the sun's. Evaluating it at every
 * step recomputes, to nine decimal places, something that has barely moved: the
 * moon travels about half a degree an hour.
 *
 * So it is sampled hourly and interpolated with a three-point Lagrange, which
 * over an hour of the moon's smooth motion is accurate to far below an
 * arcsecond — orders under the arcminute the criteria care about. The
 * topocentric shift is still applied per query, because that one really does
 * change fast: it depends on where the observer is and how the earth has
 * turned.
 *
 * Right ascension is unwrapped as it is sampled, or an interpolation spanning
 * the 360° seam would run the moon backwards across the sky.
 */
export function moonTrack(fromJd: number, hours: number): MoonTrack {
	const n = Math.ceil(hours) + 3;
	const ra = new Float64Array(n);
	const dec = new Float64Array(n);
	const dist = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const jd = fromJd + i / 24;
		const m = moonPosition(jd);
		const eq = toEquatorial(m, obliquity(jd));
		ra[i] = i > 0 && eq.ra < ra[i - 1] - 180 ? eq.ra + 360 : eq.ra;
		dec[i] = eq.dec;
		dist[i] = m.dist;
	}
	return (jd: number) => {
		const x = (jd - fromJd) * 24;
		const i = Math.min(Math.max(Math.round(x) - 1, 0), n - 3);
		const t = x - i;
		const l0 = ((t - 1) * (t - 2)) / 2;
		const l1 = -t * (t - 2);
		const l2 = (t * (t - 1)) / 2;
		return {
			eq: {
				ra: ra[i] * l0 + ra[i + 1] * l1 + ra[i + 2] * l2,
				dec: dec[i] * l0 + dec[i + 1] * l1 + dec[i + 2] * l2
			},
			dist: dist[i] * l0 + dist[i + 1] * l1 + dist[i + 2] * l2
		};
	};
}

/**
 * When a body's altitude next falls through `target`, searched forward.
 *
 * A scan then a bisection, rather than the closed-form hour-angle solve: the
 * moon moves fast enough that its own motion during the day matters, and the
 * closed form assumes a body fixed on the celestial sphere. Scanning costs a
 * few dozen evaluations and is right for both bodies.
 *
 * Returns null when no crossing happens in the window — a polar summer, where
 * the sun does not set and the question has no answer.
 */
function setting(
	alt: (jd: number) => number,
	target: number,
	fromJd: number,
	hours: number,
	stepMin = 10
): number | null {
	const step = stepMin / 1440;
	let prev = alt(fromJd) - target;
	for (let t = fromJd + step; t <= fromJd + hours / 24; t += step) {
		const cur = alt(t) - target;
		if (prev > 0 && cur <= 0) {
			// Bracketed: bisect to the second.
			let lo = t - step;
			let hi = t;
			for (let i = 0; i < 24; i++) {
				const mid = (lo + hi) / 2;
				if (alt(mid) - target > 0) lo = mid;
				else hi = mid;
			}
			return (lo + hi) / 2;
		}
		prev = cur;
	}
	return null;
}

/**
 * The criteria this app can apply.
 *
 * They disagree, sometimes about the same evening in the same place, which is
 * why the choice is offered rather than made silently. `istanbul` is the
 * default because everything else on this globe comes from Diyanet, and a map
 * that used a different standard from the timetable beside it would be quietly
 * inconsistent.
 */
export type Criterion = 'istanbul' | 'yallop' | 'odeh';

export const CRITERIA: { id: Criterion; label: string; note: string }[] = [
	{
		id: 'istanbul',
		label: 'Istanbul 1978',
		note: 'Elongation ≥ 8° and altitude ≥ 5°. The rule Diyanet applies, agreed at the 1978 Istanbul conference.'
	},
	{
		id: 'yallop',
		label: 'Yallop 1997',
		note: "HM Nautical Almanac Office's q-test, evaluated at the best time. The most widely published zones."
	},
	{
		id: 'odeh',
		label: 'Odeh 2004',
		note: 'Fitted to a larger body of recorded sightings than Yallop, and used by ICOP.'
	}
];

/**
 * How well the crescent can be seen, coarsest first.
 *
 * One scale for all three criteria, so the map's colours mean the same thing
 * whichever is chosen — the criteria differ in where they draw the lines, not
 * in what the lines mean.
 */
export type Zone = 'easy' | 'visible' | 'optical-then-eye' | 'optical' | 'none';

/**
 * Which zones each rule can actually produce.
 *
 * Yallop grades the marginal band twice — findable with aid, then possibly
 * naked-eye once found — where the other two do not. Listing every zone under
 * every criterion put a row in the legend that was structurally zero for ever,
 * which reads as a bug in the data rather than as a distinction the rule does
 * not draw.
 */
export const ZONES_OF: Record<Criterion, Zone[]> = {
	istanbul: ['easy', 'visible', 'optical', 'none'],
	yallop: ['easy', 'visible', 'optical-then-eye', 'optical', 'none'],
	odeh: ['easy', 'visible', 'optical', 'none']
};

export const ZONES: { id: Zone; label: string; colour: string }[] = [
	{ id: 'easy', label: 'Easily visible', colour: '#3ec98a' },
	{ id: 'visible', label: 'Visible in clear air', colour: '#9ed94f' },
	{ id: 'optical-then-eye', label: 'Needs binoculars to find', colour: '#f4c56a' },
	{ id: 'optical', label: 'Optical aid only', colour: '#e08b4a' },
	{ id: 'none', label: 'Not visible', colour: '#8b4a4a' }
];

export interface Sighting {
	/** Zone under the chosen criterion. */
	zone: Zone;
	/** The criterion's own score — q for Yallop, V for Odeh, unused by Istanbul. */
	score: number;
	/** Arc of vision: the moon's topocentric altitude above the sun, degrees. */
	arcv: number;
	/** Elongation from the sun, degrees. Below ~7° nothing has ever been seen. */
	arcl: number;
	/** Difference in azimuth, degrees. */
	daz: number;
	/** Crescent width, arcminutes. */
	width: number;
	/** Moonset minus sunset, minutes. Negative means it sets first — hopeless. */
	lag: number;
	/** Hours since conjunction at the best time. */
	age: number;
	/** The instant the judgement is made at, ms. */
	bestMs: number;
	/** Sunset that evening, ms. */
	sunsetMs: number;
}

/**
 * The most recent conjunction (new moon) at or before `jd`.
 *
 * Geocentric, so it is one instant for the whole earth — which is why every
 * caller that works over a grid must compute it once and pass it down. Doing it
 * per point walks a month of the ephemeris for each of twelve thousand places
 * to arrive at the same answer every time, and it dominated everything else in
 * the field by an order of magnitude.
 */
export function lastConjunction(jd: number): number {
	// The difference in ecliptic longitude passes through zero at conjunction.
	const elong = (t: number) => norm(moonPosition(t).lam - sunPosition(t).lam + 180) - 180;
	// Six-hourly to bracket — the moon gains about 12° a day, so a crossing
	// cannot hide inside a step — then bisect to the minute.
	const step = 0.25;
	let t = jd;
	for (let i = 0; i < 30 * 4; i++) {
		if (elong(t - step) < 0 && elong(t) >= 0) {
			let lo = t - step;
			let hi = t;
			for (let k = 0; k < 20; k++) {
				const mid = (lo + hi) / 2;
				if (elong(mid) < 0) lo = mid;
				else hi = mid;
			}
			return (lo + hi) / 2;
		}
		t -= step;
	}
	return jd;
}

/**
 * The next conjunction after `jd`.
 *
 * A synodic month is 29.53 days, so the conjunction at or before "a month from
 * now" is the next one — unless `jd` sits within a few hours of a conjunction
 * itself, which the caller wants to skip past anyway.
 */
export const nextConjunction = (jd: number): number => lastConjunction(jd + 29.53);

/**
 * Judge one place on one evening.
 *
 * `eveningMs` is any instant during the local day in question; the sunset that
 * follows local noon is the one used, so passing "now" asks about tonight.
 *
 * Null when there is no sunset to reckon from — inside a polar day or night the
 * question does not arise, and inventing an answer there would be worse than
 * admitting the map has nothing to say.
 */
export function sighting(
	lat: number,
	lon: number,
	eveningMs: number,
	criterion: Criterion = 'istanbul',
	/** The evening's conjunction, when the caller already knows it. */
	conjJd?: number,
	/**
	 * A moon track covering this evening, when the caller has one.
	 *
	 * The moon's geocentric position does not depend on where the observer is,
	 * so a field of twelve thousand points can share a single sampling of the
	 * lunar series instead of each building its own. That is the difference
	 * between three hundred thousand evaluations of a ninety-term series and
	 * about fifty.
	 */
	shared?: MoonTrack
): Sighting | null {
	// Local noon on the day in question, as the search's starting point.
	const dayStart = Math.floor(toJD(eveningMs) - 0.5) + 0.5;
	const noon = dayStart + 0.5 - lon / 360;

	/*
	 * Sunset, estimated and then refined — not searched for from noon.
	 *
	 * The sun is near enough fixed on the celestial sphere across a day for the
	 * hour-angle formula to put sunset within a couple of minutes, so scanning
	 * fourteen hours in ten-minute steps to find it was a hundred evaluations
	 * spent rediscovering something a cosine already knew. The estimate also
	 * answers the polar case for free: no solution to the hour angle means the
	 * sun does not set, and the point can be dropped before any searching.
	 */
	const sunNoon = sunPosition(noon);
	const sdec = Math.asin(sin(obliquity(noon)) * sin(sunNoon.lam)) / D;
	const cosH = (sin(-0.8333) - sin(lat) * sin(sdec)) / (cos(lat) * cos(sdec));
	if (!(cosH > -1 && cosH < 1)) return null;
	const guess = noon + Math.acos(cosH) / D / 360;

	// Bisect the estimate to the second. Altitude falls monotonically through
	// sunset, so a bracket an hour either side of the guess always contains it.
	const sunsetJd = setting(t => sunAlt(t, lat, lon), -0.8333, guess - 1 / 24, 2, 10);
	if (sunsetJd == null) return null;

	// The moon's own horizon allows for its parallax and its disc: it is "set"
	// when its upper limb touches the horizon, not its centre.
	const track = shared ?? moonTrack(sunsetJd - 3 / 24, 24);
	const trackAlt = (t: number) => {
		const s = track(t);
		return altAz(topocentric(s.eq, s.dist, lat, lon, t), lat, lon, t).alt;
	};
	const moonH0 = 0.7275 * (Math.asin(EARTH_KM / track(sunsetJd).dist) / D) - 0.5667;
	const moonsetJd = setting(trackAlt, moonH0, sunsetJd - 2 / 24, 20);
	if (moonsetJd == null) return null;

	const lag = (moonsetJd - sunsetJd) * 1440;
	// Yallop's best time: four ninths of the way from sunset to moonset, which
	// is when the sky is dark enough and the crescent still high enough.
	const best = sunsetJd + (4 / 9) * (moonsetJd - sunsetJd);

	const eps = obliquity(best);
	const m = moonPosition(best);
	const s = sunPosition(best);
	const mTopo = topocentric(toEquatorial(m, eps), m.dist, lat, lon, best);
	const sEq = toEquatorial(s, eps);
	const mAA = altAz(mTopo, lat, lon, best);
	const sAA = altAz(sEq, lat, lon, best);

	const arcv = mAA.alt - sAA.alt;
	const daz = Math.abs(norm(mAA.az - sAA.az + 180) - 180);
	// Topocentric elongation, from the two altitudes and their azimuth gap.
	const arcl = Math.acos(cos(arcv) * cos(daz)) / D;

	// Semi-diameter as seen from the surface, and the width of the lit limb.
	const sd = 0.2725 * (Math.asin(EARTH_KM / m.dist) / D) * (1 + sin(mAA.alt) * (EARTH_KM / m.dist)) * 60;
	const width = sd * (1 - cos(arcl));

	const conj = conjJd ?? lastConjunction(best);
	const age = (best - conj) * 24;

	const score = criterion === 'yallop' ? yallopQ(arcv, width) : criterion === 'odeh' ? odehV(arcv, width) : arcl;
	const zone = classify(criterion, { arcv, arcl, width, lag });

	return {
		zone,
		score,
		arcv,
		arcl,
		daz,
		width,
		lag,
		age,
		bestMs: fromJD(best),
		sunsetMs: fromJD(sunsetJd)
	};
}

/** Yallop's q, from arc of vision and crescent width. */
export function yallopQ(arcv: number, width: number): number {
	return (arcv - (11.8371 - 6.3226 * width + 0.7319 * width * width - 0.1018 * width * width * width)) / 10;
}

/** Odeh's V, the same shape with a different offset. */
export function odehV(arcv: number, width: number): number {
	return arcv - (7.1651 - 6.3226 * width + 0.7319 * width * width - 0.1018 * width * width * width);
}

/**
 * The Danjon limit: below about 7° of elongation the crescent has no arc left
 * to see, whatever the aperture. Every criterion is capped by it.
 */
const DANJON = 6.4;

function classify(criterion: Criterion, g: { arcv: number; arcl: number; width: number; lag: number }): Zone {
	// Nothing to see if it sets with or before the sun, or is inside Danjon.
	if (g.lag <= 0 || g.arcl < DANJON) return 'none';

	if (criterion === 'istanbul') {
		// The 1978 conference rule, as Diyanet applies it: both must hold.
		if (g.arcl >= 8 && g.arcv >= 5) return g.arcl >= 12 && g.arcv >= 8 ? 'easy' : 'visible';
		// Short of the rule, but the geometry still allows an instrument.
		return g.arcv >= 3 ? 'optical' : 'none';
	}

	if (criterion === 'yallop') {
		const q = yallopQ(g.arcv, g.width);
		if (q > 0.216) return 'easy';
		if (q > -0.014) return 'visible';
		if (q > -0.16) return 'optical-then-eye';
		if (q > -0.293) return 'optical';
		return 'none';
	}

	const v = odehV(g.arcv, g.width);
	if (v >= 5.65) return 'easy';
	if (v >= 2.0) return 'visible';
	if (v >= -0.96) return 'optical';
	return 'none';
}
