// The figure of eight the sun draws over a year — and where the prayers cross it.
//
// Photograph the sun at the same clock time every day and it never lands twice
// in the same place. It traces this shape, and the shape is the sum of two
// wobbles in the sun's timekeeping:
//
//   * the earth's tilt, 23.44°, which swings the sun north and south — the tall
//     axis of the eight, and the reason there are seasons at all
//   * the earth's elliptical orbit, which runs the sun ahead of the clock around
//     November and behind it around February — the lean and the width, and the
//     reason the two loops are unequal: perihelion falls in the northern winter,
//     so the lower loop is the larger one
//
// WHY THIS IS A PRAYER-TIME INSTRUMENT AND NOT A CURIOSITY
//
// Four of the five prayers are defined by an *altitude* of the sun — Fajr at
// −18°, Maghrib at the horizon, Isha at −17°, Asr at the shadow-ratio angle. On
// a plate whose vertical axis is altitude, each of those is a horizontal line
// across the sky. So wherever the figure of eight crosses one of those lines,
// that prayer falls at exactly this clock time, on that date.
//
// That is the whole idea, and it is why the projection below keeps altitude
// exact on one axis rather than using the gnomonic projection a camera would.
// Gnomonic is what a photograph really looks like, but it bends lines of equal
// altitude into curves — and then the prayer lines curve too, and the crossings
// stop being readable. Altitude is worth more here than photographic honesty,
// so the horizontal axis carries the angular offset from the vertical plane
// through the figure's mean bearing instead. That quantity stays finite even
// when the sun passes overhead, which bearing alone does not: near the zenith
// the azimuth swings through a half circle between solstices and would tear the
// shape in two for any city in the tropics — Makkah among them.

import { D, sun, solarTableAt, SUN_EDGE_DEG } from './astro';
import type { SolarTable } from './astro';

export interface AnalemmaPoint {
	/** Day of the year, 0-based. */
	day: number;
	/** Azimuth from north, degrees clockwise. */
	az: number;
	/** Altitude above the horizon, degrees. Negative is below it. */
	alt: number;
	/** Angular offset from the plate's centre plane, degrees. The x axis. */
	dx: number;
	/** Solar declination that day, degrees. */
	dec: number;
	/** The same, in radians — what the prayer table wants. */
	decRad: number;
	/** Equation of time that day, minutes. Positive means the sun runs ahead. */
	eot: number;
	/** True solar noon, in minutes past local midnight on the reader's clock. */
	noonMin: number;
	/**
	 * The instant sampled, epoch ms. For the astronomy, not for the label.
	 *
	 * It sits `clockHour − offsetHours` from midnight, which is *before* midnight
	 * wherever the offset is bigger than the hour — most of the day in the far
	 * east. Formatting it as a date gives the day before.
	 */
	ms: number;
	/** Midnight UTC of this day of the year. The date a reader should be shown. */
	dateMs: number;
	/** Local apparent solar time at this instant, hours — what `phaseAt` wants. */
	solarHour: number;
}

/** One prayer boundary, and the altitude that defines it. */
export interface PrayerLine {
	key: string;
	label: string;
	color: string;
	/** Degrees. Null for Asr, whose altitude moves with the season. */
	alt: number | null;
	/** Morning boundaries only apply to a morning clock time, and vice versa. */
	side: 'am' | 'pm';
}

/**
 * The four altitude-defined prayers, with the app's own angles.
 *
 * Taken from `solarTableAt` rather than restated, so the plate and the times in
 * the panel can never drift apart: Diyanet's 18° and 17°, and the sun's upper
 * limb at the horizon for the two twilight edges.
 */
export const PRAYER_LINES: PrayerLine[] = [
	{ key: 'fajr', label: 'Fajr', color: '#b5abfc', alt: -18, side: 'am' },
	{ key: 'rise', label: 'Shuruq', color: '#cfd3e5', alt: SUN_EDGE_DEG, side: 'am' },
	{ key: 'asr', label: 'Asr', color: '#d2cefd', alt: null, side: 'pm' },
	{ key: 'set', label: 'Maghrib', color: '#968ae0', alt: SUN_EDGE_DEG, side: 'pm' },
	{ key: 'isha', label: 'Isha', color: '#6f63ad', alt: -17, side: 'pm' }
];

/**
 * Dhuhr is not an altitude at all — it is the sun clearing the meridian.
 *
 * Not exported: it is solved here rather than drawn as a level, so nothing
 * outside this file has a use for it.
 */
const DHUHR = { key: 'dhuhr', label: 'Dhuhr', color: '#f5f4ff' };

/** A date on which the clock time drawn is exactly a prayer boundary. */
export interface Crossing {
	key: string;
	label: string;
	color: string;
	/** Fractional day of the year, so the mark sits between samples. */
	at: number;
	/** The instant, for formatting a date. */
	ms: number;
	/** Where it falls on the plate, in the same degrees as the points. */
	dx: number;
	alt: number;
}

export interface Analemma {
	points: AnalemmaPoint[];
	/** The bearing the plate is centred on, degrees. */
	azRef: number;
	solsticeHigh: AnalemmaPoint;
	solsticeLow: AnalemmaPoint;
	equinoxes: AnalemmaPoint[];
	today: AnalemmaPoint;
	/** True when part of the year is spent below the horizon at this hour. */
	clipped: boolean;
	/** Is the clock time drawn before the sun crosses the meridian? */
	morning: boolean;
	/** Asr's altitude wanders with the season, so it is a band rather than a line. */
	asrRange: [number, number];
	/** Every date on which this clock time is a prayer boundary. */
	crossings: Crossing[];
	/** Each day's prayer boundaries, in minutes past midnight on the clock. */
	table: Record<string, number>[];
}

/** The sun's place, from a unit vector — no quadrant to get wrong. */
function place(latRad: number, dec: number, h: number): { az: number; alt: number } {
	const sf = Math.sin(latRad);
	const cf = Math.cos(latRad);
	const sd = Math.sin(dec);
	const cd = Math.cos(dec);
	const ch = Math.cos(h);

	// East, north, up.
	const x = -cd * Math.sin(h);
	const y = sd * cf - cd * sf * ch;
	const z = sd * sf + cd * cf * ch;

	return {
		alt: Math.asin(Math.max(-1, Math.min(1, z))) / D,
		az: (((Math.atan2(x, y) / D) % 360) + 360) % 360
	};
}

/**
 * Days where a signed quantity changes sign — the crossings, interpolated.
 *
 * `f` returns NaN where the quantity does not exist at all (a sun that never
 * reaches −18° in a polar summer), and those days are simply not crossings.
 */
function signChanges(days: number, f: (i: number) => number): number[] {
	const out: number[] = [];
	for (let i = 0; i < days; i++) {
		const a = f(i);
		const b = f((i + 1) % days);
		if (!isFinite(a) || !isFinite(b) || a === 0) {
			continue;
		}
		if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) {
			out.push(i + a / (a - b));
		}
	}
	return out;
}

/**
 * The sun's position at the same clock time on every day of a year.
 *
 * `offsetHours` is held fixed across the whole year on purpose. A civil clock
 * jumps an hour for summer time, and sampling by civil time tears the figure in
 * two — which is why analemma photographers work in standard time.
 */
export function analemma(lat: number, lon: number, offsetHours: number, clockHour: number, nowMs: number): Analemma {
	/*
	 * The year, and later today's place in it, read from the reader's clock
	 * rather than from UTC.
	 *
	 * At 23:30 UTC on 31 December it is already the 1st of January in Amsterdam,
	 * and has been for half an hour; in Apia it has been for twelve. Reading the
	 * year off the UTC instant drew the wrong year's figure, and picked the wrong
	 * day within it, for as long as the two calendars disagree — up to fourteen
	 * hours either side of the new year.
	 */
	const localMs = nowMs + offsetHours * 3600000;
	const year = new Date(localMs).getUTCFullYear();
	const phi = lat * D;
	const utcHour = clockHour - offsetHours;
	const days = 365 + (new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 1 : 0);

	const raw: AnalemmaPoint[] = [];
	for (let day = 0; day < days; day++) {
		const dateMs = Date.UTC(year, 0, 1 + day);
		const ms = dateMs + utcHour * 3600000;
		const { dec, eot } = sun(new Date(ms));

		/*
		 * Clock to sun. Mean solar time runs with the longitude rather than with
		 * the timezone, and apparent solar time runs ahead or behind that by the
		 * equation of time — so the hour angle carries both corrections.
		 */
		const solarHour = utcHour + lon / 15 + eot / 60;
		const { az, alt } = place(phi, dec, (solarHour - 12) * 15 * D);

		raw.push({
			day,
			az,
			alt,
			dx: 0,
			dec: dec / D,
			decRad: dec,
			eot,
			// Turning solar noon back into a clock reading undoes both corrections.
			noonMin: (12 - lon / 15 + offsetHours) * 60 - eot,
			ms,
			dateMs,
			solarHour: ((solarHour % 24) + 24) % 24
		});
	}

	// The plate's centre bearing: the vector mean, so a shape straddling north
	// averages to north rather than to south.
	let mx = 0;
	let my = 0;
	for (const p of raw) {
		mx += Math.cos(p.az * D);
		my += Math.sin(p.az * D);
	}
	const azRef = (((Math.atan2(my, mx) / D) % 360) + 360) % 360;
	for (const p of raw) {
		p.dx = Math.asin(Math.cos(p.alt * D) * Math.sin((p.az - azRef) * D)) / D;
	}

	let high = raw[0];
	let low = raw[0];
	for (const p of raw) {
		if (p.dec > high.dec) {
			high = p;
		}
		if (p.dec < low.dec) {
			low = p;
		}
	}

	const equinoxes: AnalemmaPoint[] = [];
	for (let i = 1; i < raw.length; i++) {
		if (Math.sign(raw[i].dec) !== Math.sign(raw[i - 1].dec)) {
			equinoxes.push(Math.abs(raw[i].dec) < Math.abs(raw[i - 1].dec) ? raw[i] : raw[i - 1]);
		}
	}

	// Which day of the year it is on the reader's calendar, not on UTC's.
	const start = Date.UTC(year, 0, 1);
	const todayIndex = Math.min(days - 1, Math.max(0, Math.floor((localMs - start) / 86400000)));
	const today = raw[todayIndex];

	/*
	 * Each day's boundaries as clock readings.
	 *
	 * `solarTableAt` gives them in solar hours; the same two corrections that
	 * turned the clock into an hour angle above, run backwards, turn them into
	 * the time a reader would actually see on a clock.
	 */
	const shift = (offsetHours - lon / 15) * 60;
	const table = raw.map(p => {
		const t: SolarTable = solarTableAt(lat, p.decRad);
		const out: Record<string, number> = {};
		for (const k of Object.keys(t) as (keyof SolarTable)[]) {
			out[k] = t[k] * 60 + shift - p.eot;
		}
		return out;
	});

	const asrAlts = raw.map(p => Math.atan(1 / (1 + Math.tan(Math.abs(phi - p.decRad)))) / D);

	/*
	 * Morning or afternoon, which decides *which* prayers can be met at all. The
	 * sun passes −18° twice a day: once before dawn, once after dusk. A clock
	 * time east of the meridian can only be Fajr or Shuruq; one west of it can
	 * only be Asr, Maghrib or Isha. Without this the plate would claim Isha at
	 * breakfast.
	 *
	 * Measured round the clock rather than by subtracting. A day is a circle, and
	 * a plain `noon − now > 0` calls everything before noon morning — including
	 * the small hours *before* solar midnight, which are the tail of the previous
	 * evening and belong to Isha. In Amsterdam that mislabelled everything from
	 * midnight to about twenty to one.
	 */
	const morning = (today.noonMin - clockHour * 60 + 1440) % 1440 < 720;

	const clockMin = clockHour * 60;
	const crossings: Crossing[] = [];
	const add = (key: string, label: string, color: string, f: (i: number) => number) => {
		for (const at of signChanges(days, f)) {
			const i0 = Math.floor(at) % days;
			const i1 = (i0 + 1) % days;
			const u = at - Math.floor(at);
			crossings.push({
				key,
				label,
				color,
				at,
				// The day it falls on, dated the way the reader dates it.
				ms: raw[Math.round(at) % days].dateMs,
				dx: raw[i0].dx + (raw[i1].dx - raw[i0].dx) * u,
				alt: raw[i0].alt + (raw[i1].alt - raw[i0].alt) * u
			});
		}
	};

	/*
	 * A day the sun neither rises nor sets has no boundaries to cross.
	 *
	 * Above the polar circles `solarTableAt` returns NaN for sunrise, and the
	 * app's own rule then treats the whole day as a single phase. Left in, the
	 * plate would mark an Asr on a day the panel beside it calls Dhuhr — the
	 * altitude really does pass the shadow angle, but the app has already decided
	 * that is not a boundary here, and one of them has to be lying.
	 */
	const hasBoundaries = (i: number) => isFinite(table[i].rise);

	for (const L of PRAYER_LINES) {
		if ((L.side === 'am') !== morning) {
			continue;
		}
		const level = L.alt === null ? (i: number) => asrAlts[i] : () => L.alt as number;
		add(L.key, L.label, L.color, i => (hasBoundaries(i) ? raw[i].alt - level(i) : NaN));
	}
	// Dhuhr is a clock definition rather than an altitude, so it is solved
	// against the same table the year strip draws — the two agree by construction.
	add(DHUHR.key, DHUHR.label, DHUHR.color, i => table[i].dhuhr - clockMin);

	crossings.sort((a, b) => a.at - b.at);

	return {
		points: raw,
		azRef,
		solsticeHigh: high,
		solsticeLow: low,
		equinoxes,
		today,
		clipped: raw.some(p => p.alt < 0),
		morning,
		asrRange: [Math.min(...asrAlts), Math.max(...asrAlts)],
		crossings,
		table
	};
}

/** "3m 42s ahead" / "on the clock" — the equation of time, said in words. */
export function eotWords(minutes: number): string {
	const s = Math.round(Math.abs(minutes) * 60);
	if (s < 30) {
		return 'on the clock';
	}
	const m = Math.floor(s / 60);
	const rest = s % 60;
	const size = m ? `${m}m ${String(rest).padStart(2, '0')}s` : `${rest}s`;
	return `${size} ${minutes > 0 ? 'ahead' : 'behind'}`;
}

/** Minutes past midnight as a clock reading. */
export function hhmm(minutes: number): string {
	const v = ((Math.round(minutes) % 1440) + 1440) % 1440;
	return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compassPoint = (deg: number): string => POINTS[Math.round(deg / 22.5) % 16];
