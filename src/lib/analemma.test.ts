import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analemma, eotWords, hhmm } from './analemma';
import { sun, D, solarTableAt } from './astro';
import { sunPosition, obliquity, toEquatorial, toJD } from './hilal';
import { decodePhases } from './phases';
import type { PhasesFile } from './phases';
import { CITIES } from './cities';

/*
 * An analemma is easy to draw wrongly and have it still look like an analemma —
 * a figure of eight appears for a wide range of broken hour angles. These check
 * it against facts that hold independently of the drawing.
 */

// Amsterdam, and its winter offset. 2027 is not a leap year.
const AMS = { lat: 52.3676, lon: 4.9041, off: 1 };
const NOON_2027 = Date.UTC(2027, 5, 15, 12);

describe('analemma', () => {
	it('swings between the two solstice declinations and no further', () => {
		const a = analemma(AMS.lat, AMS.lon, AMS.off, 12, NOON_2027);

		// The obliquity of the ecliptic, which is what the swing measures.
		expect(a.solsticeHigh.dec).toBeGreaterThan(23.2);
		expect(a.solsticeHigh.dec).toBeLessThan(23.6);
		expect(a.solsticeLow.dec).toBeLessThan(-23.2);
		expect(a.solsticeLow.dec).toBeGreaterThan(-23.6);
	});

	it('puts the solstices in June and December, and finds two equinoxes', () => {
		const a = analemma(AMS.lat, AMS.lon, AMS.off, 12, NOON_2027);
		expect(new Date(a.solsticeHigh.ms).getUTCMonth()).toBe(5);
		expect(new Date(a.solsticeLow.ms).getUTCMonth()).toBe(11);
		expect(a.equinoxes).toHaveLength(2);
		expect(new Date(a.equinoxes[0].ms).getUTCMonth()).toBe(2);
		expect(new Date(a.equinoxes[1].ms).getUTCMonth()).toBe(8);
	});

	it('reaches the altitude the solstice geometry demands', () => {
		// At local solar noon the sun stands at 90 − |lat − dec|. Amsterdam's
		// midsummer noon sun is a shade over 61°, and its midwinter one about 14°.
		const a = analemma(AMS.lat, AMS.lon, AMS.off, 12, NOON_2027);
		const high = 90 - Math.abs(AMS.lat - a.solsticeHigh.dec);
		const low = 90 - Math.abs(AMS.lat - a.solsticeLow.dec);

		// Not exact: 12:00 clock time is not local solar noon — Amsterdam sits east
		// of its meridian and the equation of time moves it — so the sun is a little
		// off the meridian and therefore a little lower.
		expect(a.solsticeHigh.alt).toBeGreaterThan(high - 2);
		expect(a.solsticeHigh.alt).toBeLessThan(high + 0.01);
		expect(a.solsticeLow.alt).toBeGreaterThan(low - 2);
		expect(a.solsticeLow.alt).toBeLessThan(low + 0.01);
	});

	it('is a figure of eight: the trace crosses itself in April and August', () => {
		const a = analemma(AMS.lat, AMS.lon, AMS.off, 12, NOON_2027);
		const P = a.points;
		const n = P.length;

		/*
		 * The defining property, tested rather than assumed: somewhere the year's
		 * path returns to a point it has already passed. A tilt-only sun — no
		 * eccentricity, so no equation of time — would trace a plain arc and never
		 * cross at all, so this is the test that the second wobble is really there.
		 *
		 * Pairs close in date are excluded: consecutive samples are neighbours on
		 * the curve rather than a crossing, and so are the two ends of the year,
		 * which meet because the year closes.
		 */
		let best = { d: Infinity, i: 0, j: 0 };
		for (let i = 0; i < n; i++) {
			for (let j = i + 30; j < n; j++) {
				if (Math.min(j - i, n - (j - i)) < 30) {
					continue;
				}
				const d = Math.hypot(P[i].az - P[j].az, P[i].alt - P[j].alt);
				if (d < best.d) {
					best = { d, i, j };
				}
			}
		}

		// Daily samples straddle the crossing rather than landing on it, so the
		// nearest pair sits a fraction of a degree apart — but only a fraction.
		expect(best.d).toBeLessThan(0.3);
		// And it is where the almanacs put it: mid-April against the end of August.
		expect(new Date(P[best.i].ms).getUTCMonth()).toBe(3);
		expect(new Date(P[best.j].ms).getUTCMonth()).toBe(7);
	});

	it('leans the way the earth’s orbit leans: the lower loop is the wider one', () => {
		// Perihelion falls in the northern winter, so the equation of time swings
		// further while the sun is south — which is what makes the two loops
		// unequal, and is the whole reason the shape is not symmetric.
		const a = analemma(AMS.lat, AMS.lon, AMS.off, 12, NOON_2027);
		const spread = (side: (dec: number) => boolean) => {
			const eots = a.points.filter(p => side(p.dec)).map(p => p.eot);
			return Math.max(...eots) - Math.min(...eots);
		};
		expect(spread(d => d < 0)).toBeGreaterThan(spread(d => d > 0));
	});

	it('rides higher at noon than at breakfast', () => {
		const noon = analemma(AMS.lat, AMS.lon, AMS.off, 12, NOON_2027);
		const eight = analemma(AMS.lat, AMS.lon, AMS.off, 8, NOON_2027);
		expect(noon.today.alt).toBeGreaterThan(eight.today.alt);
		// And it is east of south in the morning, west of south in the afternoon.
		const four = analemma(AMS.lat, AMS.lon, AMS.off, 16, NOON_2027);
		expect(eight.today.az).toBeLessThan(180);
		expect(four.today.az).toBeGreaterThan(180);
	});

	it('goes below the horizon at midnight, and not at midday', () => {
		expect(analemma(AMS.lat, AMS.lon, AMS.off, 0, NOON_2027).clipped).toBe(true);
		expect(analemma(AMS.lat, AMS.lon, AMS.off, 12, NOON_2027).clipped).toBe(false);
	});

	it('covers a leap year without dropping a day', () => {
		const leap = analemma(AMS.lat, AMS.lon, AMS.off, 12, Date.UTC(2028, 5, 15, 12));
		expect(leap.points).toHaveLength(366);
		expect(analemma(AMS.lat, AMS.lon, AMS.off, 12, NOON_2027).points).toHaveLength(365);
	});

	it('puts the sun on the equator over the equator at noon', () => {
		// A sanity check with no latitude to hide a sign error: at the equinox, from
		// 0°N on the Greenwich meridian, the noon sun is all but overhead.
		const a = analemma(0, 0, 0, 12, Date.UTC(2027, 2, 20, 12));
		const eq = a.equinoxes[0];
		expect(eq.alt).toBeGreaterThan(87);
	});
});

describe('the plate’s axes', () => {
	it('centres the bearing offset on the figure, east of it positive', () => {
		const a = analemma(AMS.lat, AMS.lon, AMS.off, 12, NOON_2027);
		const xs = a.points.map(p => p.dx);
		// The offsets straddle zero, because the reference bearing is the figure's
		// own mean rather than a fixed compass point.
		expect(Math.min(...xs)).toBeLessThan(0);
		expect(Math.max(...xs)).toBeGreaterThan(0);

		// And a sample further clockwise than the reference sits to the right.
		const east = a.points.find(p => p.az > a.azRef + 1);
		if (east) {
			expect(east.dx).toBeGreaterThan(0);
		}
	});

	it('survives a city where the noon sun passes almost overhead', () => {
		/*
		 * Makkah at noon is the case that breaks a bearing-only plot: the sun
		 * crosses within a couple of degrees of the zenith, so its azimuth swings
		 * through a half circle between the solstices and any shape drawn against
		 * bearing tears in two. The offset used here goes to zero overhead instead.
		 */
		const a = analemma(21.4225, 39.8262, 39.8262 / 15, 12, NOON_2027);
		const xs = a.points.map(p => p.dx);
		expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(20);
		expect(xs.every(x => isFinite(x))).toBe(true);

		// The azimuths really do swing wildly — the thing being defended against.
		const az = a.points.map(p => p.az);
		expect(Math.max(...az) - Math.min(...az)).toBeGreaterThan(150);
	});
});

describe('where the eight meets a prayer', () => {
	it('finds the days Fajr falls at a chosen morning hour, and agrees with the table', () => {
		// 05:00 in Amsterdam is inside the range Fajr sweeps across the year.
		const a = analemma(AMS.lat, AMS.lon, AMS.off, 5, NOON_2027);
		const fajr = a.crossings.filter(c => c.key === 'fajr');
		expect(fajr.length).toBeGreaterThan(0);

		for (const c of fajr) {
			// The crossing is where the sun sits at −18°, by construction.
			expect(c.alt).toBeCloseTo(-18, 1);
			// And the day's own table must put Fajr at that same clock time.
			const day = Math.round(c.at) % a.points.length;
			expect(a.table[day].fajr).toBeCloseTo(5 * 60, 0);
		}
	});

	it('offers only morning prayers to a morning hour, and evening ones to an evening hour', () => {
		const dawn = analemma(AMS.lat, AMS.lon, AMS.off, 5, NOON_2027);
		const dusk = analemma(AMS.lat, AMS.lon, AMS.off, 21, NOON_2027);
		expect(dawn.morning).toBe(true);
		expect(dusk.morning).toBe(false);

		// The sun passes −18° twice a day. Without the morning test the plate
		// would offer Isha at breakfast.
		expect(dawn.crossings.some(c => c.key === 'isha')).toBe(false);
		expect(dusk.crossings.some(c => c.key === 'fajr')).toBe(false);
		expect(dusk.crossings.some(c => c.key === 'isha' || c.key === 'set')).toBe(true);
	});

	it('solves Dhuhr against the clock rather than an altitude', () => {
		/*
		 * Dhuhr is the one boundary that is not an altitude, so it can only be
		 * found by asking when the sun clears the meridian. Its crossings must
		 * land where the day's table says Dhuhr is, to the minute.
		 *
		 * 12:45 because Dhuhr barely moves: the equation of time is all that
		 * shifts it, so across a whole year in Amsterdam it only ever falls
		 * between 12:27 and 12:58. An hour outside that half-hour window is not a
		 * failure to find it — there is nothing there to find.
		 */
		const a = analemma(AMS.lat, AMS.lon, AMS.off, 12.75, NOON_2027);
		const dhuhr = a.crossings.filter(c => c.key === 'dhuhr');
		expect(dhuhr.length).toBeGreaterThan(0);
		for (const c of dhuhr) {
			const day = Math.round(c.at) % a.points.length;
			expect(a.table[day].dhuhr).toBeCloseTo(12.75 * 60, 0);
		}
	});

	it('reports Asr as a band, not a line, because its angle follows the season', () => {
		const a = analemma(AMS.lat, AMS.lon, AMS.off, 16, NOON_2027);
		const [lo, hi] = a.asrRange;
		expect(hi).toBeGreaterThan(lo + 5);
		// Asr's altitude is highest when the sun is nearest the observer's
		// latitude — midsummer — and lowest at midwinter.
		expect(hi).toBeLessThan(45);
		expect(lo).toBeGreaterThan(0);
	});

	it('finds nothing at an hour no prayer ever reaches', () => {
		// Midday: the sun is never low enough for a twilight boundary, and Dhuhr
		// itself never arrives this early. Nothing to find, and it says so.
		const a = analemma(AMS.lat, AMS.lon, AMS.off, 12, NOON_2027);
		expect(a.crossings).toHaveLength(0);
	});

	it('puts Fajr at one in the morning in a northern summer, as it really is', () => {
		/*
		 * At 52°N, high summer Fajr is genuinely around one o'clock — and for the
		 * weeks either side of the solstice it does not exist at all, because the
		 * sun never sinks the 18° the definition asks for. Both facts fall out of
		 * the same series, and this is the case that stopped me trusting a guess:
		 * "nothing happens at 01:00" is true in London's imagination and false in
		 * the arithmetic.
		 */
		const a = analemma(AMS.lat, AMS.lon, AMS.off, 1, NOON_2027);
		const fajr = a.crossings.filter(c => c.key === 'fajr');
		expect(fajr).toHaveLength(2);
		expect(new Date(fajr[0].ms).getUTCMonth()).toBe(4);
		expect(new Date(fajr[1].ms).getUTCMonth()).toBe(6);

		// Between those two dates the sun never gets there: its lowest point at
		// this hour is the solstice's, and that is shallower than −18°.
		const lowest = Math.max(...a.points.map(p => p.alt));
		expect(lowest).toBeGreaterThan(-18);
		expect(lowest).toBeLessThan(-13);
	});
});

/*
 * The tests above check the analemma against itself. These check the sun model
 * underneath it against three things it did not produce: a higher-accuracy
 * model already in this repo, the published almanac, and Diyanet's own printed
 * times. If `astro.ts`'s `sun()` is ever changed, this is what notices.
 */
describe('the solar model underneath', () => {
	/** Declination and equation of time from Meeus — the independent reference. */
	function meeus(ms: number) {
		const jd = toJD(ms);
		const T = (jd - 2451545) / 36525;
		const { ra, dec } = toEquatorial(sunPosition(jd), obliquity(jd));
		const L0 = (((280.46646 + 36000.76983 * T + 0.0003032 * T * T) % 360) + 360) % 360;
		let d = L0 - 0.0057183 - ra;
		while (d > 180) {
			d -= 360;
		}
		while (d < -180) {
			d += 360;
		}
		return { dec, eot: d * 4 };
	}

	it('tracks the Meeus model within the low-accuracy series’ known error', () => {
		let worstDec = 0;
		let worstEot = 0;
		for (let d = 0; d < 365; d++) {
			const ms = Date.UTC(2026, 0, 1 + d, 12);
			const a = sun(new Date(ms));
			const m = meeus(ms);
			worstDec = Math.max(worstDec, Math.abs(a.dec / D - m.dec));
			worstEot = Math.max(worstEot, Math.abs(a.eot - m.eot));
		}
		// Spencer's series is a cheap approximation and this is its published
		// order of accuracy. Widening these is a decision, not a fix.
		expect(worstDec).toBeLessThan(0.3);
		expect(worstEot).toBeLessThan(0.7);
	});

	it('puts the equation of time where the almanac does', () => {
		const series = Array.from({ length: 365 }, (_, d) => {
			const ms = Date.UTC(2026, 0, 1 + d, 12);
			return { ms, eot: sun(new Date(ms)).eot };
		});
		const lo = series.reduce((a, b) => (b.eot < a.eot ? b : a));
		const hi = series.reduce((a, b) => (b.eot > a.eot ? b : a));

		// Published: about −14.2 minutes in mid-February, +16.4 in early November.
		expect(lo.eot).toBeGreaterThan(-14.6);
		expect(lo.eot).toBeLessThan(-13.8);
		expect(new Date(lo.ms).getUTCMonth()).toBe(1);
		expect(hi.eot).toBeGreaterThan(16.0);
		expect(hi.eot).toBeLessThan(16.8);
		expect(new Date(hi.ms).getUTCMonth()).toBe(10);
	});

	it('reproduces Diyanet’s own Fajr and Isha away from the poles', () => {
		/*
		 * The end-to-end check, and the strongest available: `phases.json` is
		 * Diyanet's published table, and nothing in the solar model came from it.
		 *
		 * Only below 45°. Higher up Diyanet applies its own rules for nights when
		 * the sun never sinks far enough, and a pure solar model cannot and should
		 * not reproduce those.
		 */
		const file = JSON.parse(readFileSync('public/phases.json', 'utf8')) as PhasesFile;
		const table = decodePhases(file);
		const base = Date.UTC(+file.from.slice(0, 4), +file.from.slice(5, 7) - 1, +file.from.slice(8, 10));

		const errs: Record<'fajr' | 'isha', number[]> = { fajr: [], isha: [] };
		let used = 0;
		for (const c of CITIES) {
			if (Math.abs(c.la) > 45) {
				continue;
			}
			const arr = table.byCity.get(c.ilceID);
			if (!arr || arr.length < 12) {
				continue;
			}
			if (++used > 150) {
				break;
			}
			for (let day = 0; day < 2; day++) {
				const dayMs = base + day * 86400000;
				const { dec, eot } = sun(new Date(dayMs + 12 * 3600000));
				const t = solarTableAt(c.la, dec);
				for (const [key, slot] of [
					['fajr', 0],
					['isha', 5]
				] as const) {
					const solarHours = t[key];
					if (!isFinite(solarHours)) {
						continue;
					}
					const predicted = dayMs / 60000 + (solarHours - c.lo / 15 - eot / 60) * 60;
					errs[key].push(predicted - arr[day * file.perDay + slot]);
				}
			}
		}

		expect(used).toBeGreaterThan(50);
		for (const key of ['fajr', 'isha'] as const) {
			const s = errs[key].sort((a, b) => a - b);
			const median = s[Math.floor(s.length / 2)];
			// Diyanet's 18°/17° are exactly what `solarTableAt` uses, so below 45°
			// the two should agree to the minute they are printed in.
			expect(Math.abs(median), `${key} median ${median.toFixed(2)} min`).toBeLessThan(1.5);
		}
	});

	it('is a few minutes ahead of Diyanet at sunrise and sunset, by their margin not our error', () => {
		/*
		 * Diyanet prints Shuruq a little earlier and Maghrib a little later than
		 * the sun's own crossing — a safety margin, and a deliberate one. It shows
		 * up as an equal-and-opposite pair, which is how it can be told apart from
		 * a coordinate bug: a bug in the conversion would push both the same way,
		 * and would move Dhuhr with them.
		 *
		 * Recorded here because it is the reason the plate's crossing dates sit a
		 * few days from the dates Diyanet's own table would give.
		 */
		const file = JSON.parse(readFileSync('public/phases.json', 'utf8')) as PhasesFile;
		const table = decodePhases(file);
		const base = Date.UTC(+file.from.slice(0, 4), +file.from.slice(5, 7) - 1, +file.from.slice(8, 10));

		const rise: number[] = [];
		const set: number[] = [];
		let used = 0;
		for (const c of CITIES) {
			if (Math.abs(c.la) > 45) {
				continue;
			}
			const arr = table.byCity.get(c.ilceID);
			if (!arr || arr.length < 6) {
				continue;
			}
			if (++used > 150) {
				break;
			}
			const { dec, eot } = sun(new Date(base + 12 * 3600000));
			const t = solarTableAt(c.la, dec);
			const at = (h: number) => base / 60000 + (h - c.lo / 15 - eot / 60) * 60;
			rise.push(at(t.rise) - arr[1]);
			set.push(at(t.set) - arr[4]);
		}
		const median = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
		const mRise = median(rise);
		const mSet = median(set);

		// We are late to sunrise and early to sunset, by about the same amount.
		expect(mRise).toBeGreaterThan(3);
		expect(mSet).toBeLessThan(-3);
		expect(Math.abs(mRise + mSet)).toBeLessThan(3);
	});
});

/*
 * The plate has to hold the whole figure, at every latitude, hour and zoom.
 *
 * This is here because the fitting has now been wrong twice in opposite
 * directions: once leaving the shape in the middle 40% of an empty plate, and
 * once letting it run off both edges with only a slice showing. The arithmetic
 * is duplicated from the component on purpose — the point is to pin the rule,
 * so that changing it there without thinking fails here.
 */
/*
 * Four defects an independent audit found, each verified against a concrete
 * input before it was believed and pinned here afterwards.
 */
describe('edges the first version got wrong', () => {
	it('dates the year by the reader’s calendar, not by UTC', () => {
		// 23:30 UTC on 31 December is already New Year's Day in Amsterdam, and has
		// been for twelve hours in Apia. Reading the year off the UTC instant drew
		// the wrong year's figure and picked the wrong day inside it.
		const eve = Date.UTC(2026, 11, 31, 23, 30);
		const ams = analemma(52.3676, 4.9041, 1, 0.5, eve);
		expect(new Date(ams.today.dateMs).toISOString().slice(0, 10)).toBe('2027-01-01');

		const apia = analemma(-13.83, -171.77, 13, 12, Date.UTC(2026, 11, 31, 20));
		expect(new Date(apia.today.dateMs).toISOString().slice(0, 10)).toBe('2027-01-01');
	});

	it('dates every sample by the day it belongs to, whatever the offset', () => {
		/*
		 * A sample sits `clockHour − offsetHours` from midnight, which is *before*
		 * midnight wherever the offset is larger than the hour — most of the day in
		 * the far east. Labelling that instant as a date put every crossing a day
		 * early.
		 */
		const a = analemma(-13.83, -171.77, 13, 6, Date.UTC(2027, 5, 15, 12));
		expect(a.points[0].ms).toBeLessThan(a.points[0].dateMs);
		for (const p of [a.points[0], a.points[100], a.points[364]]) {
			const d = new Date(p.dateMs);
			expect(d.getUTCHours()).toBe(0);
			expect(Math.round((p.dateMs - Date.UTC(2027, 0, 1)) / 86400000)).toBe(p.day);
		}
	});

	it('calls the hours before solar midnight evening, not morning', () => {
		/*
		 * A day is a circle. Plain subtraction from noon calls everything before
		 * it morning — including the small hours that are the tail of the previous
		 * evening, which belong to Isha rather than to Fajr.
		 */
		for (const hour of [0, 0.25, 0.5]) {
			const a = analemma(AMS.lat, AMS.lon, AMS.off, hour, NOON_2027);
			expect(a.today.solarHour).toBeGreaterThan(12);
			expect(a.morning, `${hour}h`).toBe(false);
		}
		// And just the other side of solar midnight it really is morning again.
		for (const hour of [0.75, 1, 6, 11]) {
			const a = analemma(AMS.lat, AMS.lon, AMS.off, hour, NOON_2027);
			expect(a.today.solarHour).toBeLessThan(12);
			expect(a.morning, `${hour}h`).toBe(true);
		}
	});

	it('finds no boundary on a day the sun neither rises nor sets', () => {
		// Above the polar circle the app treats the whole day as one phase, so a
		// crossing marked on the plate would contradict the panel beside it.
		const a = analemma(80, 0, 0, 18, NOON_2027);
		for (const c of a.crossings) {
			const day = Math.round(c.at) % a.points.length;
			expect(isFinite(a.table[day].rise), `${c.key} on day ${day}`).toBe(true);
		}
	});

	it('knows the sun model repeats itself on the last day of a leap year', () => {
		/*
		 * Not a defect to fix here but a limit to record. `sun()` is a 365-day
		 * series shared by the whole app, so in a leap year its 366th sample
		 * repeats the first. The figure is drawn from 366 points so the dates stay
		 * right; the cost is that 31 December borrows 1 January's declination.
		 */
		const leap = analemma(AMS.lat, AMS.lon, AMS.off, 12, Date.UTC(2028, 5, 15, 12));
		expect(leap.points).toHaveLength(366);
		expect(leap.points[365].dec).toBeCloseTo(leap.points[0].dec, 6);
		// Everything before the repeat is still distinct, which is what makes the
		// cost one day rather than a whole shifted year.
		expect(leap.points[364].dec).not.toBeCloseTo(leap.points[0].dec, 3);
	});
});

describe('the plate fits the figure', () => {
	const W = 560;
	const H = 470;
	const PAD = { l: 52, r: 60, t: 26, b: 34 };
	const availW = W - PAD.l - PAD.r;
	const availH = H - PAD.t - PAD.b;

	/** What `Analemma.tsx` does: fill the height, then widen by what still fits. */
	function fit(xSpan: number, ySpan: number, ex: number) {
		let s = availH / (ySpan * 1.08);
		let exFit = Math.min(ex, availW / (xSpan * s * 1.15));
		if (exFit < 1) {
			exFit = 1;
			s = availW / (xSpan * 1.15);
		}
		return { w: xSpan * s * exFit, h: ySpan * s };
	}

	it('never lets the trace leave the box, anywhere on earth or in the day', () => {
		const spilled: string[] = [];
		let checked = 0;

		for (const lat of [-75, -68, -60, -52, -35, -15, 0, 15, 35, 52, 60, 68, 75]) {
			for (let hour = 0; hour < 24; hour += 1) {
				const a = analemma(lat, 0, 0, hour, NOON_2027);
				const xs = a.points.map(p => p.dx);
				const ys = a.points.map(p => p.alt);
				const xSpan = Math.max(Math.max(...xs) - Math.min(...xs), 1.5);
				const ySpan = Math.max(Math.max(...ys) - Math.min(...ys), 8);

				for (const ex of [1, 2, 3]) {
					checked++;
					const { w, h } = fit(xSpan, ySpan, ex);
					if (w > availW + 0.5 || h > availH + 0.5) {
						spilled.push(`${lat}° at ${hour}:00 ×${ex} → ${Math.round(w)}×${Math.round(h)}`);
					}
				}
			}
		}

		expect(checked).toBeGreaterThan(900);
		expect(spilled.slice(0, 5), `${spilled.length} spilled`).toEqual([]);
	});

	it('fills the height whenever the width allows it', () => {
		// The reason the rule exists: a tall narrow figure — the usual midday one —
		// should not sit in a third of the plate.
		const a = analemma(52.3676, 4.9041, 1, 12, NOON_2027);
		const xs = a.points.map(p => p.dx);
		const ys = a.points.map(p => p.alt);
		const { h } = fit(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 2);
		expect(h / availH).toBeGreaterThan(0.9);
	});

	it('shrinks rather than spills when the figure is wider than it is tall', () => {
		/*
		 * The equator around dawn: the sun rises almost vertically, so the loop is
		 * a long flat ribbon — 47° across against 8° of height. Filling the height
		 * would make it four times wider than the plate.
		 */
		const a = analemma(0, 0, 0, 5, NOON_2027);
		const xs = a.points.map(p => p.dx);
		const ys = a.points.map(p => p.alt);
		const xSpan = Math.max(...xs) - Math.min(...xs);
		const ySpan = Math.max(...ys) - Math.min(...ys);
		expect(xSpan / ySpan).toBeGreaterThan(3);

		const { w, h } = fit(xSpan, ySpan, 1);
		expect(w).toBeLessThanOrEqual(availW + 0.5);
		// And the height goes slack, which is the trade being made.
		expect(h).toBeLessThan(availH);
	});
});

describe('hhmm', () => {
	it('wraps a clock reading rather than printing an impossible one', () => {
		expect(hhmm(0)).toBe('00:00');
		expect(hhmm(725)).toBe('12:05');
		expect(hhmm(1445)).toBe('00:05');
		expect(hhmm(-10)).toBe('23:50');
	});
});

describe('eotWords', () => {
	it('says which way, and calls a few seconds nothing', () => {
		expect(eotWords(3.7)).toBe('3m 42s ahead');
		expect(eotWords(-3.7)).toBe('3m 42s behind');
		expect(eotWords(0.2)).toBe('on the clock');
	});
});
