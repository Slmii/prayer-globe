import { describe, it, expect } from 'vitest';
import {
	D,
	PATH_STEP_MIN,
	SUN_EDGE_DEG,
	MERCATOR_LIMIT,
	FILL_LIMIT,
	CAP_LAT,
	bearing,
	bodyPaths,
	greatCircle,
	phaseAt,
	phaseBand,
	phaseCap,
	polarPhase,
	nightPolygon,
	qibla,
	skyState,
	solarTable,
	solarTableAt,
	splitAtAntimeridian,
	terminatorArcs,
	terminatorLatitude,
	wrap
} from './astro';
import { MOSQUES } from './mosques';
import { CITIES } from './cities';
import { planetStates, PLANETS } from './planets';

// Fixed instant so every assertion is deterministic: 2026-08-15 12:00 UTC.
const BASE = Date.UTC(2026, 7, 15, 12, 0, 0);
const HOUR = 3600000;
const DAY = 24 * HOUR;

/** Shortest signed difference between two longitudes, in degrees. */
const dLon = (a: number, b: number) => wrap(a - b);

/** Total signed longitude travelled along a list of samples. */
function travel(points: [number, number][]): number {
	let total = 0;
	for (let i = 1; i < points.length; i++) total += dLon(points[i][0], points[i - 1][0]);
	return total;
}

/** Raw (unsplit) samples on the same grid bodyPaths uses. */
function rawSamples(fromMs: number, toMs: number) {
	const step = PATH_STEP_MIN * 60000;
	const n = Math.floor(Math.abs(toMs - fromMs) / step);
	const dir = toMs >= fromMs ? 1 : -1;
	const sun: [number, number][] = [];
	const moon: [number, number][] = [];
	for (let i = 0; i <= n; i++) {
		const sky = skyState(new Date(fromMs + dir * i * step));
		sun.push([sky.sun.lon, sky.sun.lat]);
		moon.push([sky.moon.lon, sky.moon.lat]);
	}
	return { sun, moon };
}

describe('sub-solar point', () => {
	it('stays within the tropics all year', () => {
		// True obliquity is 23.44°; the Fourier approximation this port uses
		// overshoots it by about 0.015° at the solstices, hence 23.5.
		for (let d = 0; d < 365; d += 5) {
			const { sun } = skyState(new Date(BASE + d * DAY));
			expect(Math.abs(sun.lat)).toBeLessThanOrEqual(23.5);
		}
	});

	it('reaches the solstices and crosses zero at the equinoxes', () => {
		const decOn = (y: number, m: number, day: number) => skyState(new Date(Date.UTC(y, m, day, 12))).sun.lat;
		expect(decOn(2026, 5, 21)).toBeCloseTo(23.4, 0); // June solstice
		expect(decOn(2026, 11, 21)).toBeCloseTo(-23.4, 0); // December solstice
		expect(Math.abs(decOn(2026, 2, 20))).toBeLessThan(1.5); // March equinox
		expect(Math.abs(decOn(2026, 8, 22))).toBeLessThan(1.5); // September equinox
	});

	it('travels west at 15° per hour', () => {
		const start = skyState(new Date(BASE)).sun.lon;
		for (const h of [1, 3, 6, 11]) {
			const later = skyState(new Date(BASE + h * HOUR)).sun.lon;
			// Westward is negative longitude change; the equation of time drifts a
			// few arc-minutes over a day, hence the tolerance.
			expect(dLon(later, start)).toBeCloseTo(-15 * h, 0);
		}
	});

	it('returns to its starting longitude after a day', () => {
		const start = skyState(new Date(BASE)).sun.lon;
		const after = skyState(new Date(BASE + DAY)).sun.lon;
		expect(Math.abs(dLon(after, start))).toBeLessThan(1);
	});
});

describe('wrap', () => {
	it('folds any magnitude into [-180, 180)', () => {
		for (const v of [0, 179, 180, 181, -180, -181, 540, -540, -3510600, 4e6]) {
			const w = wrap(v);
			expect(w).toBeGreaterThanOrEqual(-180);
			expect(w).toBeLessThan(180);
			// Same point on the circle as the input.
			expect(Math.abs(Math.sin(((w - v) * Math.PI) / 180))).toBeLessThan(1e-6);
		}
	});
});

describe('sub-lunar point', () => {
	it('reports a longitude inside the valid range', () => {
		// Regression: gmst accumulates ~361°/day, so an unnormalised wrap pushed
		// this to roughly -538° and corrupted the moon's path geometry.
		for (let d = 0; d < 40; d++) {
			const { moon } = skyState(new Date(BASE + d * DAY));
			expect(moon.lon).toBeGreaterThanOrEqual(-180);
			expect(moon.lon).toBeLessThan(180);
		}
	});

	it('stays within the moon’s declination limits', () => {
		for (let d = 0; d < 60; d++) {
			const { moon } = skyState(new Date(BASE + d * DAY));
			expect(Math.abs(moon.lat)).toBeLessThanOrEqual(28.8);
		}
	});

	it('drifts about 12° east per day relative to the sun', () => {
		const a = skyState(new Date(BASE)).moon.lon;
		const b = skyState(new Date(BASE + DAY)).moon.lon;
		// Earth turns 360.99°/day, the moon advances ~13.2° along its orbit, so the
		// sub-lunar point lands ~12.2° further east each day.
		expect(dLon(b, a)).toBeGreaterThan(9);
		expect(dLon(b, a)).toBeLessThan(15);
	});

	it('reports illumination as a fraction that cycles with the synodic month', () => {
		for (let d = 0; d < 40; d++) {
			const { moon } = skyState(new Date(BASE + d * DAY));
			expect(moon.illum).toBeGreaterThanOrEqual(0);
			expect(moon.illum).toBeLessThanOrEqual(1);
		}
		const now = skyState(new Date(BASE)).moon.illum;
		const synodic = skyState(new Date(BASE + 29.53 * DAY)).moon.illum;
		expect(synodic).toBeCloseTo(now, 1);
	});
});

describe('bodyPaths sampling', () => {
	it('samples on a fixed grid, one point per PATH_STEP_MIN', () => {
		const { sun } = rawSamples(BASE, BASE + DAY);
		expect(sun).toHaveLength((24 * 60) / PATH_STEP_MIN + 1);
	});

	it('is a growing prefix: earlier samples never move as the span extends', () => {
		// This is the property that stops the whole path shimmering while playing.
		const short = rawSamples(BASE, BASE + 6 * HOUR).sun;
		const long = rawSamples(BASE, BASE + 5 * DAY).sun;
		expect(long.slice(0, short.length)).toEqual(short);
	});

	it('starts exactly at the from-instant and ends exactly at the to-instant', () => {
		const to = BASE + 3 * DAY + 7 * 60000; // deliberately off-grid
		const path = bodyPaths(BASE, to);
		const flat = path.sun.flat();
		const first = skyState(new Date(BASE)).sun;
		const last = skyState(new Date(to)).sun;
		expect(flat[0][0]).toBeCloseTo(first.lon, 6);
		expect(flat[flat.length - 1][0]).toBeCloseTo(last.lon, 6);
		expect(flat[flat.length - 1][1]).toBeCloseTo(last.lat, 6);
	});

	it('walks one full loop of the earth per day', () => {
		for (const days of [1, 3, 5]) {
			const total = travel(rawSamples(BASE, BASE + days * DAY).sun);
			expect(total).toBeCloseTo(-360 * days, -1); // westward, one loop per day
		}
	});

	it('breaks into one more segment than antimeridian crossings', () => {
		// One loop per day means one seam crossing per day.
		for (const days of [1, 2, 5]) {
			const { sun } = bodyPaths(BASE, BASE + days * DAY);
			expect(sun.length).toBe(days + 1);
		}
	});

	it('runs backwards for a span into the past', () => {
		const total = travel(rawSamples(BASE, BASE - DAY).sun);
		expect(total).toBeCloseTo(360, -1); // eastward when rewinding
	});

	it('tracks the declination drift across the span', () => {
		// Mid-August is past the June solstice, so the sun is heading south.
		const start = skyState(new Date(BASE)).sun.lat;
		const end = skyState(new Date(BASE + 5 * DAY)).sun.lat;
		expect(end).toBeLessThan(start);
		expect(start - end).toBeGreaterThan(1);
		expect(start - end).toBeLessThan(3);
	});
});

describe('geometric sunrise and sunset', () => {
	// Solar-hour boundary -> UTC hours for a place.
	const utcOf = (solarHour: number, eot: number, lon: number) => solarHour - eot / 60 - lon / 15;

	it('matches published sunrise/sunset for Istanbul', () => {
		const { dec, eot } = skyState(new Date(BASE));
		const t = solarTable(41.0082, dec);
		// 2026-08-15, Istanbul: sunrise 06:14 and sunset 20:04 local (UTC+3).
		expect(utcOf(t.rise, eot, 28.9784) + 3).toBeCloseTo(6 + 14 / 60, 1);
		expect(utcOf(t.set, eot, 28.9784) + 3).toBeCloseTo(20 + 4 / 60, 1);
	});

	it('gives a longer day further north in August', () => {
		const { dec } = skyState(new Date(BASE));
		const dayLength = (lat: number) => {
			const t = solarTable(lat, dec);
			return t.set - t.rise;
		};
		expect(dayLength(60)).toBeGreaterThan(dayLength(41));
		expect(dayLength(41)).toBeGreaterThan(dayLength(0));
		// Southern hemisphere is in winter, so its days are shorter than the equator.
		expect(dayLength(-40)).toBeLessThan(dayLength(0));
	});

	it('reports no sunrise inside the polar day', () => {
		const { dec } = skyState(new Date(BASE));
		// Mid-August still has midnight sun above ~80°N.
		expect(isNaN(solarTable(85, dec).rise)).toBe(true);
	});
});

describe('antimeridian splitting', () => {
	it('never leaves a jump across the seam inside a segment', () => {
		for (const days of [1, 5]) {
			for (const body of Object.values(bodyPaths(BASE, BASE + days * DAY))) {
				for (const seg of body) {
					for (let i = 1; i < seg.length; i++) {
						expect(Math.abs(seg[i][0] - seg[i - 1][0])).toBeLessThan(180);
					}
				}
			}
		}
	});

	it('cuts exactly on ±180 so the halves still meet', () => {
		const segs = splitAtAntimeridian([
			[170, 10],
			[179, 12],
			[-179, 13],
			[-170, 15]
		]);
		expect(segs).toHaveLength(2);
		expect(segs[0][segs[0].length - 1][0]).toBe(180);
		expect(segs[1][0][0]).toBe(-180);
		// The seam point carries the interpolated latitude, identical on both sides.
		expect(segs[0][segs[0].length - 1][1]).toBeCloseTo(segs[1][0][1], 10);
		expect(segs[0][segs[0].length - 1][1]).toBeCloseTo(12.5, 6);
	});

	it('leaves a path that never crosses the seam in one piece', () => {
		expect(
			splitAtAntimeridian([
				[10, 0],
				[20, 5],
				[30, 10]
			])
		).toHaveLength(1);
	});
});

describe('terminator', () => {
	it('splits sunrise and sunset by hour angle', () => {
		const { dec, sun } = skyState(new Date(BASE));
		const arcs = terminatorArcs(sun.lat, sun.lon);
		for (const [lon] of arcs.sunrise.flat()) {
			if (Math.abs(Math.abs(lon) - 180) < 0.001) continue; // seam point
			expect(dLon(lon, sun.lon)).toBeLessThanOrEqual(0);
		}
		for (const [lon] of arcs.sunset.flat()) {
			if (Math.abs(Math.abs(lon) - 180) < 0.001) continue;
			expect(dLon(lon, sun.lon)).toBeGreaterThanOrEqual(0);
		}
		expect(dec).toBeGreaterThan(0); // August: northern declination
	});

	it('places the night boundary exactly on the drawn sunrise/sunset line', () => {
		// Regression: the fill used altitude 0° while the lines used -0.833°, so the
		// shading sat a few degrees off its own boundary.
		const { dec, sun } = skyState(new Date(BASE));
		const antiLat = -sun.lat;
		const antiLon = wrap(sun.lon + 180);
		const wantRadius = 90 + SUN_EDGE_DEG;

		for (let lon = -170; lon <= 170; lon += 17) {
			const lat = terminatorLatitude(dec, lon, sun.lon);
			// Angular distance from the anti-solar point must equal the ring radius.
			const cosA =
				Math.sin(lat * D) * Math.sin(antiLat * D) +
				Math.cos(lat * D) * Math.cos(antiLat * D) * Math.cos((lon - antiLon) * D);
			const arc = Math.acos(Math.max(-1, Math.min(1, cosA))) / D;
			expect(arc).toBeCloseTo(wantRadius, 4);
		}
	});

	it('puts the terminator a quarter turn from the sub-solar point', () => {
		const { dec, sun } = skyState(new Date(BASE));
		// On the sub-solar meridian the edge of daylight sits at dec - (90 - h).
		const atNoon = terminatorLatitude(dec, sun.lon, sun.lon);
		expect(atNoon).toBeCloseTo(dec / D - 90 + SUN_EDGE_DEG, 3);
		// On the opposite meridian it is the mirror image.
		const atMidnight = terminatorLatitude(dec, wrap(sun.lon + 180), sun.lon);
		expect(atMidnight).toBeCloseTo(90 + SUN_EDGE_DEG - dec / D, 3);
	});
});

describe('night polygon', () => {
	it('spans the full longitude range and closes over the dark pole', () => {
		const { dec, sun } = skyState(new Date(BASE));
		const ring = nightPolygon(dec, sun.lon);
		const lons = ring.map(p => p[0]);
		expect(Math.min(...lons)).toBe(-180);
		expect(Math.max(...lons)).toBe(180);
		// Northern summer leaves the south pole in darkness. Closed at the Mercator
		// limit, never at ±90 — a pole vertex is unrepresentable in the tile
		// projection and renders as a chord slashing across the globe.
		expect(dec).toBeGreaterThan(0);
		expect(ring.some(p => p[1] === -MERCATOR_LIMIT)).toBe(true);
		expect(ring.every(p => Math.abs(p[1]) <= MERCATOR_LIMIT)).toBe(true);
	});

	it('closes over the north pole in the southern summer', () => {
		const winter = skyState(new Date(Date.UTC(2026, 11, 21, 12)));
		const ring = nightPolygon(winter.dec, winter.sun.lon);
		expect(winter.dec).toBeLessThan(0);
		expect(ring.some(p => p[1] === MERCATOR_LIMIT)).toBe(true);
		expect(ring.every(p => Math.abs(p[1]) <= MERCATOR_LIMIT)).toBe(true);
	});

	it('is a closed ring', () => {
		const { dec, sun } = skyState(new Date(BASE));
		const ring = nightPolygon(dec, sun.lon);
		expect(ring[0]).toEqual(ring[ring.length - 1]);
	});
});

describe('mosque placement', () => {
	it('sits exactly on the city dot it replaces', () => {
		// The dot is hidden where a mosque stands, so any drift would leave the
		// building visibly detached from the place it marks.
		expect(MOSQUES.length).toBeGreaterThan(0);
		for (const m of MOSQUES.filter(x => x.anchored === 'city')) {
			const city = CITIES.find(c => c.n === m.city);
			expect(city, `unknown city for ${m.name}`).toBeDefined();
			expect(m.lat).toBe(city!.la);
			expect(m.lon).toBe(city!.lo);
		}
	});

	it('names each city at most once', () => {
		const cities = MOSQUES.map(m => m.city);
		expect(new Set(cities).size).toBe(cities.length);
	});
});

describe('planets', () => {
	it('keeps the inner planets within their elongation limits', () => {
		// Mercury never strays more than ~28° from the sun as seen from earth, and
		// Venus ~47°. Nothing else constrains an ephemeris this tightly, so this is
		// the sharpest single check that the geocentric conversion is right.
		let maxMercury = 0;
		let maxVenus = 0;
		for (let d = 0; d < 800; d += 4) {
			const states = planetStates(new Date(BASE + d * DAY));
			const merc = states.find(p => p.name === 'Mercury')!;
			const venus = states.find(p => p.name === 'Venus')!;
			maxMercury = Math.max(maxMercury, merc.elongation);
			maxVenus = Math.max(maxVenus, venus.elongation);
		}
		expect(maxMercury).toBeGreaterThan(17);
		expect(maxMercury).toBeLessThan(29);
		expect(maxVenus).toBeGreaterThan(40);
		expect(maxVenus).toBeLessThan(48);
	});

	/**
	 * Guards the element table against a mistyped digit.
	 *
	 * Every row is 12 numbers copied by hand out of JPL's table, and the two that
	 * would quietly ruin a planet are the semi-major axis and the mean-longitude
	 * rate — one puts the planet in the wrong orbit, the other makes it run at the
	 * wrong speed, and neither shows up as anything but "the orrery looks a bit
	 * off". Both are checkable against textbook values without an ephemeris.
	 */
	it('matches each planet to its known orbit and period', () => {
		const known: Record<string, { au: number; years: number }> = {
			Mercury: { au: 0.387, years: 0.241 },
			Venus: { au: 0.723, years: 0.615 },
			Mars: { au: 1.524, years: 1.881 },
			Jupiter: { au: 5.203, years: 11.862 },
			Saturn: { au: 9.537, years: 29.457 },
			Uranus: { au: 19.189, years: 84.021 },
			Neptune: { au: 30.07, years: 164.79 }
		};
		expect(PLANETS.map(p => p.name)).toEqual(Object.keys(known));
		for (const el of PLANETS) {
			const { au, years } = known[el.name];
			expect(el.a[0], `${el.name} semi-major axis`).toBeCloseTo(au, 2);
			// L is degrees per Julian century, so a full turn takes 360/rate centuries.
			expect(36000 / el.L[1], `${el.name} period`).toBeCloseTo(years, 1);
		}
	});

	it('lets the outer planets reach opposition', () => {
		// Mars, Jupiter and Saturn must all pass through 180° elongation.
		const maxima: Record<string, number> = {};
		for (let d = 0; d < 800; d += 4) {
			for (const p of planetStates(new Date(BASE + d * DAY))) {
				maxima[p.name] = Math.max(maxima[p.name] ?? 0, p.elongation);
			}
		}
		for (const name of ['Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) {
			expect(maxima[name], name).toBeGreaterThan(150);
		}
	});

	it('keeps every distance inside its orbital bounds', () => {
		const bounds: Record<string, [number, number]> = {
			// Geocentric distance ranges, in au, with a little slack.
			Mercury: [0.5, 1.5],
			Venus: [0.25, 1.75],
			Mars: [0.35, 2.7],
			Jupiter: [3.9, 6.5],
			Saturn: [7.9, 11.1],
			Uranus: [17.0, 21.5],
			Neptune: [28.4, 31.6]
		};
		for (let d = 0; d < 800; d += 7) {
			for (const p of planetStates(new Date(BASE + d * DAY))) {
				const [lo, hi] = bounds[p.name];
				expect(p.distance, `${p.name} at day ${d}`).toBeGreaterThanOrEqual(lo);
				expect(p.distance, `${p.name} at day ${d}`).toBeLessThanOrEqual(hi);
			}
		}
	});

	it('reports sub-planetary points on the globe', () => {
		for (const p of planetStates(new Date(BASE))) {
			expect(Math.abs(p.lat)).toBeLessThanOrEqual(30); // near the ecliptic
			expect(p.lon).toBeGreaterThanOrEqual(-180);
			expect(p.lon).toBeLessThan(180);
		}
	});

	it('moves the inner planets faster than the outer ones', () => {
		const shift = (name: string) => {
			const a = planetStates(new Date(BASE)).find(p => p.name === name)!;
			const b = planetStates(new Date(BASE + 30 * DAY)).find(p => p.name === name)!;
			return Math.abs(wrap(b.eclipticLon - a.eclipticLon));
		};
		expect(shift('Mercury')).toBeGreaterThan(shift('Saturn'));
		expect(shift('Jupiter')).toBeGreaterThan(shift('Saturn'));
	});
});

describe('great circles', () => {
	const KAABA: [number, number] = [39.8262, 21.4225];

	/** Angular separation between two [lon,lat] points, in degrees. */
	const sep = (a: [number, number], b: [number, number]) => {
		const r = Math.PI / 180;
		const [lo1, la1] = a;
		const [lo2, la2] = b;
		const c =
			Math.sin(la1 * r) * Math.sin(la2 * r) + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.cos((lo2 - lo1) * r);
		return Math.acos(Math.max(-1, Math.min(1, c))) / r;
	};

	it('starts and ends where it was told to', () => {
		const p = greatCircle([4.9, 52.37], KAABA);
		expect(p[0][0]).toBeCloseTo(4.9, 6);
		expect(p[0][1]).toBeCloseTo(52.37, 6);
		expect(p[p.length - 1][0]).toBeCloseTo(KAABA[0], 6);
		expect(p[p.length - 1][1]).toBeCloseTo(KAABA[1], 6);
	});

	it('steps evenly along the arc', () => {
		// Equal angular steps are what makes the curve smooth on a globe; a naive
		// lerp between coordinates would bunch the samples toward the poles.
		const p = greatCircle([-74, 40.7], [139.7, 35.7], 64);
		const gaps: number[] = [];
		for (let i = 1; i < p.length; i++) gaps.push(sep(p[i - 1], p[i]));
		const min = Math.min(...gaps);
		const max = Math.max(...gaps);
		expect(max - min).toBeLessThan(1e-6);
	});

	it('leaves on the qibla bearing it reports', () => {
		for (const [lo, la] of [
			[18.42, -33.92], // Cape Town — the famous north-east answer
			[-0.13, 51.51],
			[106.85, -6.21],
			[-149.9, 61.2] // Anchorage, whose path goes over the pole
		] as [number, number][]) {
			const p = greatCircle([lo, la], KAABA, 2048);
			const first = bearing(la, lo, p[1][1], p[1][0]);
			expect(((first % 360) + 360) % 360, `${lo},${la}`).toBeCloseTo(qibla(la, lo), 1);
		}
	});

	it('is the shortest path, not the flat-map one', () => {
		// Anchorage is the case that proves it. The shortest way to Makkah goes
		// almost over the North Pole — the path reaches about 85.6° N, far above
		// either endpoint (61.2 and 21.4) — and its midpoint sits some 28° north of
		// where interpolating the coordinates would put it. A flat map cannot draw
		// this line at all; it is the reason the qibla is worth showing on a globe.
		const p = greatCircle([-149.9, 61.2], KAABA, 512);
		const maxLat = Math.max(...p.map(q => q[1]));
		expect(maxLat).toBeGreaterThan(80);

		const gcMid = p[Math.floor(p.length / 2)][1];
		const flatMid = (61.2 + 21.4225) / 2;
		expect(gcMid - flatMid).toBeGreaterThan(20);
	});

	it('never wanders off the sphere', () => {
		const p = greatCircle([-157.8, 21.3], [31.2, 30.0], 256);
		for (const [lon, lat] of p) {
			expect(lat).toBeGreaterThanOrEqual(-90);
			expect(lat).toBeLessThanOrEqual(90);
			expect(lon).toBeGreaterThanOrEqual(-180);
			expect(lon).toBeLessThanOrEqual(180);
		}
	});

	it('survives a degenerate path to itself', () => {
		expect(greatCircle(KAABA, KAABA)).toHaveLength(1);
	});

	it('splits cleanly when it crosses the seam', () => {
		// Anchorage to Makkah crosses the antimeridian; drawn unsplit it would be
		// painted straight back across the whole map.
		const p = greatCircle([-149.9, 61.2], KAABA, 256);
		for (const seg of splitAtAntimeridian(p)) {
			for (let i = 1; i < seg.length; i++) {
				expect(Math.abs(seg[i][0] - seg[i - 1][0])).toBeLessThan(180);
			}
		}
	});
});

describe('polarPhase', () => {
	const { dec } = skyState(new Date('2026-08-16T12:00:00Z'));

	it('calls the grazing midnight sun day, not night', () => {
		// Mid-August, around 75.5°N: the sun's lowest point of the day sits at about
		// −0.75°, which is above the −0.833° horizon that defines sunset. So it never
		// sets — but a plain `altitude > 0` test read that as night, and because
		// there are no boundaries to divide a polar day the whole ring was painted
		// Isha at every longitude at once. A cap over the pole, in daylight.
		for (let lat = 75.6; lat <= 84; lat += 0.4) {
			const t = solarTableAt(lat, dec);
			expect(isNaN(t.rise)).toBe(true);
			expect(polarPhase(lat, dec)).toBe(2);
		}
	});

	it('calls the southern polar night night', () => {
		for (let lat = -84; lat <= -77.5; lat += 0.4) {
			expect(isNaN(solarTableAt(lat, dec).rise)).toBe(true);
			expect(polarPhase(lat, dec)).toBe(5);
		}
	});
});

describe('phaseBand', () => {
	const { dec, eot, utcH } = skyState(new Date('2026-08-16T12:00:00Z'));

	/** Is [lon,lat] inside any quad? */
	const covers = (quads: [number, number][][], lon: number, lat: number) =>
		quads.some(q => lon >= q[0][0] && lon <= q[1][0] && lat >= q[0][1] && lat <= q[2][1]);

	it('leaves no phase wrapped right around a latitude, except at the poles', () => {
		// The failure this guards: a band that covers all 360° of a latitude row
		// where the cities on that row disagree with it. Full rings are legitimate
		// above the circles — a polar day really is Dhuhr everywhere at once — so
		// the test is agreement with phaseAt, not the absence of rings.
		for (const phase of [0, 1, 2, 3, 4, 5]) {
			for (const q of phaseBand(phase, dec, utcH, eot)) {
				const width = q[1][0] - q[0][0];
				if (width < 359) continue;
				const lat = (q[0][1] + q[2][1]) / 2;
				for (let lon = -180; lon < 180; lon += 45) {
					const st = (((utcH + lon / 15 + eot / 60) % 24) + 24) % 24;
					expect(phaseAt(lat, st, dec, solarTableAt(lat, dec))).toBe(phase);
				}
			}
		}
	});

	it('caps a pole with one phase when the sun has stopped setting there', () => {
		// Under a midnight sun the pole is Dhuhr and nothing else, so the cap is one
		// phase all the way round. Measured over the whole ring rather than by
		// corner index: the cap is densified to a vertex every ten degrees, because
		// as four corners its two 360°-long edges tessellated to nothing and the
		// fill never appeared at all.
		const spanOf = (ring: [number, number][]) => {
			const lats = ring.map(([, la]) => la);
			const lons = ring.map(([lo]) => lo);
			return { top: Math.max(...lats), bottom: Math.min(...lats), width: Math.max(...lons) - Math.min(...lons) };
		};
		const above = (phase: number) =>
			phaseBand(phase, dec, utcH, eot).filter(q => spanOf(q).top > CAP_LAT);

		// August: midnight sun in the north, polar night in the south.
		for (const phase of [0, 1, 3, 4]) expect(above(phase)).toHaveLength(0);
		const north = above(2);
		expect(north).toHaveLength(1);
		expect(spanOf(north[0]).width).toBe(360);
		// The hatched band stops at the tile limit; `phaseCap` carries the rest.
		expect(spanOf(north[0]).top).toBeCloseTo(MERCATOR_LIMIT, 3);
		// Enough vertices for the renderer to have edges to follow.
		expect(north[0].length).toBeGreaterThan(60);

		const south = phaseBand(5, dec, utcH, eot).filter(q => spanOf(q).bottom < -CAP_LAT);
		expect(south).toHaveLength(1);
		expect(spanOf(south[0]).width).toBe(360);
		expect(spanOf(south[0]).bottom).toBeCloseTo(-MERCATOR_LIMIT, 3);
	});

	it('does not cap a pole that still has days', () => {
		// At an equinox the sun still rises and sets at 84.5°, so the ground up
		// there runs through every prayer and the rows must carry on to the edge of
		// the map rather than being flattened into one phase.
		const eq = skyState(new Date('2026-09-23T09:00:00Z'));
		const capsFor = (phase: number) =>
			phaseBand(phase, eq.dec, eq.utcH, eq.eot).filter(
				(q) => q[1][0] - q[0][0] === 360 && q[2][1] > CAP_LAT,
			);
		for (const phase of [0, 1, 2, 3, 4, 5]) expect(capsFor(phase)).toHaveLength(0);
		// and the rows still reach as far as anything can be drawn
		const top = phaseBand(2, eq.dec, eq.utcH, eq.eot).map((q) => q[2][1]);
		expect(Math.max(...top)).toBeCloseTo(FILL_LIMIT, 3);
	});

	it('agrees with phaseAt almost everywhere', () => {
		// The band is a grid approximation — 2° by 1.5° cells — so it cannot be
		// exact at a boundary, and at high latitude the phase can turn over inside
		// a single cell. What it must not do is be wrong in bulk, which is how the
		// first version failed: it filled each meridian from its northernmost hit
		// to its southernmost and swallowed everything between, including ground in
		// a different phase entirely.
		for (const phase of [0, 2, 3, 4, 5]) {
			const quads = phaseBand(phase, dec, utcH, eot);
			let truth = 0;
			let hit = 0;
			let falsePositive = 0;
			for (let lon = -179; lon < 180; lon += 3.1) {
				const st = (((utcH + lon / 15 + eot / 60) % 24) + 24) % 24;
				for (let lat = -84; lat <= 84; lat += 2.3) {
					const real = phaseAt(lat, st, dec) === phase;
					const drawn = covers(quads, lon, lat);
					if (real) truth++;
					if (real && drawn) hit++;
					if (!real && drawn) falsePositive++;
				}
			}
			expect(truth, `phase ${phase} never occurs`).toBeGreaterThan(0);
			expect(hit / truth, `phase ${phase} recall`).toBeGreaterThan(0.9);
			expect(falsePositive / truth, `phase ${phase} false positives`).toBeLessThan(0.15);
		}
	});

	it('closes every quad', () => {
		for (const q of phaseBand(0, dec, utcH, eot)) {
			expect(q).toHaveLength(5);
			expect(q[0]).toEqual(q[4]);
		}
	});

	it('never spans the seam', () => {
		// Same hazard as every other polygon here: a quad running from +170 round to
		// -170 would be painted straight back across the map. A row wider than the
		// world, or one running off the eastern edge, has to be cut at ±180 into
		// separate quads — each of which must read west-to-east on its own.
		for (const phase of [0, 2, 4, 5]) {
			for (const q of phaseBand(phase, dec, utcH, eot)) {
				const west = q[0][0];
				const east = q[1][0];
				expect(west).toBeGreaterThanOrEqual(-180);
				expect(east).toBeLessThanOrEqual(180);
				expect(east).toBeGreaterThan(west);
			}
		}
	});

	it('hands the pole over to phaseCap at the tile limit', () => {
		/*
		 * The split that fixed the polar "circles".
		 *
		 * MapLibre will not draw a `fill-pattern` above the Mercator tile limit,
		 * but it draws a flat `fill-color` there to about 88°. So the hatched band
		 * stops at the limit and `phaseCap` covers the rest in colour — measured on
		 * the running map, not assumed. If the band ever creeps past the limit the
		 * pattern silently vanishes up there and the hole comes back.
		 */
		for (const q of phaseBand(5, dec, utcH, eot)) {
			for (const [, lat] of q) {
				expect(Math.abs(lat)).toBeLessThanOrEqual(MERCATOR_LIMIT + 1e-6);
			}
		}

		// August: polar night in the south, so the southern cap is Isha's.
		const caps = phaseCap(5, dec);
		expect(caps).toHaveLength(1);
		const lats = caps[0].map(([, lat]) => lat);
		expect(Math.max(...lats)).toBeCloseTo(-MERCATOR_LIMIT, 3);
		expect(Math.min(...lats)).toBeCloseTo(-FILL_LIMIT, 3);
		// Densified: as four corners the ring tessellates to nothing near a pole.
		expect(caps[0].length).toBeGreaterThan(60);

		// And no cap for a phase the pole is not in.
		expect(phaseCap(0, dec)).toHaveLength(0);
	});

	it('gives every phase somewhere to be, at any hour', () => {
		// The claim the chain mode is built on: at any instant, every prayer is
		// being kept somewhere on earth.
		for (let h = 0; h < 24; h += 3) {
			const sky = skyState(new Date(`2026-08-16T${String(h).padStart(2, '0')}:00:00Z`));
			for (const phase of [0, 2, 3, 4, 5]) {
				const quads = phaseBand(phase, sky.dec, sky.utcH, sky.eot);
				expect(quads.length, `phase ${phase} at ${h}h`).toBeGreaterThan(0);
			}
		}
	});
});
