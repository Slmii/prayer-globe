import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { rulesBreak } from './unresolved';
import { decodePhases } from './phases';
import type { PhasesFile, PhaseTable } from './phases';
import { CITIES } from './cities';
import { sun, solarTableAt } from './astro';

const file = JSON.parse(readFileSync('public/phases.json', 'utf8')) as PhasesFile;
const phases = decodePhases(file);
const start = Date.UTC(+file.from.slice(0, 4), +file.from.slice(5, 7) - 1, +file.from.slice(8, 10));
const dayAt = (d: number) => start + d * 86400000;

/** The solar boundary each reported name is claiming has no answer. */
const KEY = { Fajr: 'fajr', Shuruq: 'rise', Maghrib: 'set', Isha: 'isha' } as const;

/** True when the sun supplies all four of the boundaries it defines. */
const whole = (t: ReturnType<typeof solarTableAt>) =>
	isFinite(t.fajr) && isFinite(t.rise) && isFinite(t.set) && isFinite(t.isha);

describe('where the rules break', () => {
	it('lists a city only when the sun really cannot reach the angle', () => {
		const r = rulesBreak(phases, dayAt(0), 100);
		expect(r.total).toBeGreaterThan(0);

		const { dec } = sun(new Date(dayAt(0) + 12 * 3600000));
		for (const row of r.rows) {
			const t = solarTableAt(row.city.la, dec);
			// Every reason given must be true of the solar table.
			for (const name of row.missing) {
				expect(isFinite(t[KEY[name as keyof typeof KEY]]), `${row.city.n} ${name}`).toBe(false);
			}
			expect(row.missing.length).toBeGreaterThan(0);
			if (row.midnightSun) {
				expect(isFinite(t.set)).toBe(false);
			}
		}
	});

	it('leaves out every city the sun does answer for', () => {
		// The complement matters as much: a city wrongly listed would be an
		// accusation the data does not support.
		const { dec } = sun(new Date(dayAt(0) + 12 * 3600000));
		const listed = new Set(rulesBreak(phases, dayAt(0), 999).rows.map(r => r.city.ilceID));
		let checked = 0;
		for (const c of CITIES) {
			const t = solarTableAt(c.la, dec);
			if (whole(t)) {
				checked++;
				expect(listed.has(c.ilceID), c.n).toBe(false);
			}
		}
		expect(checked).toBeGreaterThan(500);
	});

	it('catches the winter failure as well as the summer one', () => {
		/*
		 * The two ways out of the definitions, which are not the same way.
		 *
		 * In summer the sun never sinks to −18°, so Fajr and Isha have no answer.
		 * In polar winter it never climbs to the horizon, so Shuruq and Maghrib
		 * have none — while Fajr and Isha are perfectly well defined, because at
		 * Longyearbyen the noon sun still reaches about −11° and so crosses −18°
		 * on the way up and again on the way down.
		 *
		 * Watching only for the first missed every polar winter, which is four
		 * months of the year at the latitudes where any of this matters. Checked
		 * against the solar geometry directly rather than the shipped window,
		 * which is a single month and cannot contain both seasons.
		 */
		const lat = 78.2;
		const summer = solarTableAt(lat, sun(new Date(Date.UTC(2027, 5, 21, 12))).dec);
		expect(isFinite(summer.fajr)).toBe(false);
		expect(isFinite(summer.set)).toBe(false);

		const winter = solarTableAt(lat, sun(new Date(Date.UTC(2027, 11, 21, 12))).dec);
		expect(isFinite(winter.rise)).toBe(false);
		expect(isFinite(winter.set)).toBe(false);
		// The part that is easy to get backwards: twilight still works down here.
		expect(isFinite(winter.fajr)).toBe(true);
		expect(isFinite(winter.isha)).toBe(true);

		// So a winter day must still be reported, on the Shuruq/Maghrib grounds.
		expect(whole(winter)).toBe(false);
	});

	it('recedes as the sun moves south', () => {
		/*
		 * The seasonal half of the story. The window shipped with this test starts
		 * in late summer, so the frontier should retreat across it rather than hold
		 * steady — if it ever stopped shrinking, the day would not be reaching the
		 * table at all.
		 */
		const first = rulesBreak(phases, dayAt(0), 999).total;
		const last = rulesBreak(phases, dayAt(file.days - 2), 999).total;
		expect(first).toBeGreaterThan(last);
	});

	it('calls a timetable held only when it truly stops moving', () => {
		/*
		 * Stated as an implication rather than as a headcount.
		 *
		 * Longyearbyen's boundaries repeat for sixteen days in August and are
		 * moving again by late September, so whether *anything* is frozen depends
		 * on the season the shipped window happens to cover. Requiring one failed
		 * the first time the data rolled forward, which was the calendar working
		 * and not the code breaking. What must always hold is the other direction:
		 * anything called held really does repeat, to the minute.
		 */
		const rows = rulesBreak(phases, dayAt(0), 999).rows;
		const { dec } = sun(new Date(dayAt(0) + 12 * 3600000));
		const per = phases.perDay;

		for (const r of rows.filter(x => x.held)) {
			const arr = phases.byCity.get(r.city.ilceID)!;
			const t = solarTableAt(r.city.la, dec);
			// Only the boundaries the sun cannot supply are the ones that freeze.
			const stuck = [t.fajr, t.rise, t.dhuhr, t.asr, t.set, t.isha]
				.map((v, k) => (isFinite(v) ? -1 : k))
				.filter(k => k >= 0);

			expect(stuck.length, `${r.city.n} held with nothing missing`).toBeGreaterThan(0);
			for (const k of stuck) {
				expect(arr[per + k] - arr[k], `${r.city.n} boundary ${k}`).toBe(1440);
				expect(arr[2 * per + k] - arr[per + k], `${r.city.n} boundary ${k}`).toBe(1440);
			}
			expect(r.heldDays).toBeGreaterThanOrEqual(3);
		}

		// And a city whose times move is never marked held.
		const moving = rows.find(r => r.city.n === 'Reykjavik');
		if (moving) {
			expect(moving.held).toBe(false);
		}
	});

	it('spots a frozen timetable whatever the season', () => {
		/*
		 * The positive case, built rather than found, so it holds in every window.
		 *
		 * Longyearbyen at midsummer: the sun supplies none of the four twilight
		 * boundaries, so a table repeating them to the minute is exactly what
		 * `held` exists to name — while Dhuhr and Asr creep a minute a day, as
		 * Diyanet's really do, and must not stop it being recognised.
		 */
		const city = CITIES.find(c => c.n === 'Longyearbyen')!;
		const june = Date.UTC(2027, 5, 21);
		const day0 = Math.floor(june / 60000);
		const boundaries = [34, 97, 667, 934, 1234, 1290];

		const mins: number[] = [];
		for (let d = 0; d < 4; d++) {
			boundaries.forEach((m, k) => {
				const drift = k === 2 || k === 3 ? -d : 0;
				mins.push(day0 + d * 1440 + m + drift);
			});
		}

		const table: PhaseTable = {
			byCity: new Map([[city.ilceID, Int32Array.from(mins)]]),
			from: new Date(june).toISOString().slice(0, 10),
			days: 4,
			perDay: 6
		};

		const row = rulesBreak(table, june, 999).rows.find(r => r.city.ilceID === city.ilceID);
		expect(row, 'Longyearbyen should be listed at midsummer').toBeTruthy();
		expect(row!.held).toBe(true);
		expect(row!.heldDays).toBeGreaterThanOrEqual(3);
		// The two the sun still settles are named as still moving.
		expect(row!.moving).toEqual(['Dhuhr', 'Asr']);
	});

	it('gives a reason whose number matches the sky', () => {
		/*
		 * The row now asserts a depth — "sun stops 12.3° below the horizon" — which
		 * is a thing a reader could go and check, so it had better be right. The
		 * lowest the sun gets is 90° minus the sum of latitude and declination, and
		 * the boundary it fell short of must genuinely be deeper than that.
		 */
		const rows = rulesBreak(phases, dayAt(0), 999).rows;
		const dec = (sun(new Date(dayAt(0) + 12 * 3600000)).dec * 180) / Math.PI;
		let quoted = 0;

		for (const r of rows) {
			const m = r.why.match(/stops (\d+\.\d)° below/);
			if (!m) {
				// The two degenerate cases say so in words instead.
				expect(r.why, r.city.n).toMatch(/sun never (sets|rises)/);
				continue;
			}
			quoted++;
			const low = Math.abs(r.city.la + dec) - 90;
			expect(+m[1], r.city.n).toBeCloseTo(Math.abs(low), 1);
			// And it must fall short of every angle the row blames it for.
			for (const name of r.missing) {
				const needs = r.why.match(new RegExp(`${name} needs (\\d+)°`));
				if (needs) {
					expect(Math.abs(low), `${r.city.n} ${name}`).toBeLessThan(+needs[1]);
				}
			}
		}
		expect(quoted).toBeGreaterThan(3);
	});

	it('reports times as clock readings in each city’s own zone', () => {
		const rows = rulesBreak(phases, dayAt(0), 999).rows;
		for (const r of rows.slice(0, 6)) {
			expect(r.fajr).toMatch(/^\d{2}:\d{2}$/);
			expect(r.isha).toMatch(/^\d{2}:\d{2}$/);
			// Fajr before Isha, on any sane timetable.
			expect(r.fajr < r.isha, `${r.city.n} ${r.fajr}–${r.isha}`).toBe(true);
		}
	});

	it('says nothing rather than guessing when there is no table', () => {
		expect(rulesBreak(null, dayAt(0))).toEqual({ rows: [], total: 0 });
	});
});
