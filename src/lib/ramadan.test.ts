import { describe, it, expect } from 'vitest';
import { ramadanMonth } from './ramadan';
import type { TimetableDay } from './diyanet';
import type { PrayerKey } from './astro';

/** UTC instant for a wall-clock 'HH:MM' on (y, mo, d) at `offsetMin` east of UTC. */
function toUtc(y: number, mo: number, d: number, hhmm: string, offsetMin: number): number {
	const [h, m] = hhmm.split(':').map(Number);
	return Date.UTC(y, mo - 1, d, h, m) - offsetMin * 60000;
}

/** A TimetableDay fixture. Only fajr/set carry the fields ramadan.ts reads. */
function mkDay(opts: {
	y: number;
	mo: number;
	d: number;
	hijri: string;
	fajr: string;
	set: string;
	offsetMin?: number;
}): TimetableDay {
	const { y, mo, d, hijri, fajr, set, offsetMin = 180 } = opts;
	const local: Record<PrayerKey, string> = {
		fajr,
		rise: '06:00',
		dhuhr: '12:00',
		asr: '15:30',
		set,
		isha: '20:30'
	};
	const utc: Record<PrayerKey, number | null> = {
		fajr: toUtc(y, mo, d, fajr, offsetMin),
		rise: null,
		dhuhr: null,
		asr: null,
		set: toUtc(y, mo, d, set, offsetMin),
		isha: null
	};
	return {
		y,
		mo,
		d,
		offsetMin,
		hijri,
		gregorian: `${d}.${mo}.${y}`,
		qiblaHour: null,
		local,
		utc
	};
}

// Five consecutive days of Ramazan 1448, imsak/maghrib both drifting earlier
// day over day the way a real month does.
const RAMAZAN: TimetableDay[] = [
	mkDay({ y: 2027, mo: 3, d: 11, hijri: '1 Ramazan 1448', fajr: '04:40', set: '19:40' }),
	mkDay({ y: 2027, mo: 3, d: 12, hijri: '2 Ramazan 1448', fajr: '04:38', set: '19:42' }),
	mkDay({ y: 2027, mo: 3, d: 13, hijri: '3 Ramazan 1448', fajr: '04:36', set: '19:44' }),
	mkDay({ y: 2027, mo: 3, d: 14, hijri: '4 Ramazan 1448', fajr: '04:34', set: '19:46' }),
	mkDay({ y: 2027, mo: 3, d: 15, hijri: '5 Ramazan 1448', fajr: '04:32', set: '19:48' })
];

describe('ramadanMonth', () => {
	it('builds a normal month keyed to the right day', () => {
		const nowMs = toUtc(2027, 3, 13, '12:00', 180); // midday of day 3
		const month = ramadanMonth(RAMAZAN, nowMs);
		expect(month).not.toBeNull();
		expect(month!.month).toBe('Ramazan');
		expect(month!.title).toBe('Ramazan 1448');
		expect(month!.days).toHaveLength(5);
		expect(month!.current).toBe(true);
		expect(month!.todayIndex).toBe(2);
		expect(month!.days[2].n).toBe(3);
		expect(month!.sub).toBe('day 3 of 5');
	});

	it('derives left/width from the published local strings', () => {
		const nowMs = toUtc(2027, 3, 11, '12:00', 180);
		const month = ramadanMonth(RAMAZAN, nowMs)!;
		const day1 = month.days[0];
		expect(day1.imsak).toBe('04:40');
		expect(day1.maghrib).toBe('19:40');
		expect(day1.left).toBeCloseTo((4 + 40 / 60) / 24, 10);
		expect(day1.width).toBeCloseTo((19 + 40 / 60) / 24 - (4 + 40 / 60) / 24, 10);
	});

	it('reports pct as 0 before imsak, 1 after maghrib, and between while fasting', () => {
		const dayThree = RAMAZAN[2];
		const fajrMs = dayThree.utc.fajr!;
		const setMs = dayThree.utc.set!;

		expect(ramadanMonth(RAMAZAN, fajrMs - 10 * 60000)!.pct).toBe(0);
		expect(ramadanMonth(RAMAZAN, setMs + 10 * 60000)!.pct).toBe(1);
		expect(ramadanMonth(RAMAZAN, (fajrMs + setMs) / 2)!.pct).toBeCloseTo(0.5, 10);
	});

	it('skips a day whose hijri string does not parse, keeping the rest', () => {
		const withJunk: TimetableDay[] = [
			...RAMAZAN,
			mkDay({ y: 2027, mo: 3, d: 16, hijri: 'not a hijri date', fajr: '04:30', set: '19:50' })
		];
		const nowMs = toUtc(2027, 3, 13, '12:00', 180);
		const month = ramadanMonth(withJunk, nowMs)!;
		expect(month.days).toHaveLength(5);
		expect(month.days.some(d => d.imsak === '04:30')).toBe(false);
	});

	it('falls back to the hijri month containing nowMs when there is no Ramazan', () => {
		const SEVVAL: TimetableDay[] = [
			mkDay({ y: 2027, mo: 4, d: 10, hijri: '1 Şevval 1448', fajr: '04:50', set: '19:20' }),
			mkDay({ y: 2027, mo: 4, d: 11, hijri: '2 Şevval 1448', fajr: '04:52', set: '19:18' }),
			mkDay({ y: 2027, mo: 4, d: 12, hijri: '3 Şevval 1448', fajr: '04:54', set: '19:16' })
		];
		const nowMs = toUtc(2027, 4, 11, '12:00', 180);
		const month = ramadanMonth(SEVVAL, nowMs)!;
		expect(month.month).toBe('Şevval');
		expect(month.current).toBe(true);
		expect(month.todayIndex).toBe(1);
	});

	it('says how far off the month is when nowMs falls outside it', () => {
		const nowMs = toUtc(2027, 1, 1, '12:00', 180); // months before this Ramazan
		const month = ramadanMonth(RAMAZAN, nowMs)!;
		expect(month.current).toBe(false);
		expect(month.todayIndex).toBe(-1);
		expect(month.sub).toMatch(/^starts in \d+ days?$/);
	});

	it('clamps a fast that would run past local midnight instead of wrapping', () => {
		const days: TimetableDay[] = [
			mkDay({ y: 2027, mo: 3, d: 11, hijri: '1 Ramazan 1448', fajr: '23:50', set: '00:40' })
		];
		const nowMs = toUtc(2027, 3, 11, '23:55', 180);
		const month = ramadanMonth(days, nowMs)!;
		const day = month.days[0];
		const left = (23 + 50 / 60) / 24;
		expect(day.left).toBeCloseTo(left, 10);
		// Clamped to the end of the local day, not wrapped into a negative span.
		expect(day.width).toBeCloseTo(1 - left, 10);
		expect(day.width).toBeGreaterThan(0);
	});
});
