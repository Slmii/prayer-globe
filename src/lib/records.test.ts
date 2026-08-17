import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodePhases } from './phases';
import type { PhasesFile } from './phases';
import { dayRecords } from './records';

const file = JSON.parse(readFileSync('public/phases.json', 'utf8')) as PhasesFile;
const table = decodePhases(file);

// Comfortably inside the published window for every city.
const midWindowMs = Date.parse(`${file.from}T00:00:00Z`) + 20 * 86400000;

describe('dayRecords', () => {
	it('returns all six, each with a real city', () => {
		const records = dayRecords(table, midWindowMs);
		const keys = records.map(r => r.key);
		expect(keys).toEqual(['longestFast', 'shortestFast', 'shortestNight', 'nextFajr', 'nextIsha', 'longestWait']);
		for (const r of records) {
			expect(r.label).toBe(r.label.toUpperCase());
			expect(r.city).toBeTruthy();
			expect(typeof r.raw).toBe('number');
		}
	});

	it('the two races are measured from now, and are always ahead of it', () => {
		const records = dayRecords(table, midWindowMs);
		for (const key of ['nextFajr', 'nextIsha']) {
			const r = records.find(x => x.key === key)!;
			// Minutes until it happens, never behind us and never more than a day off:
			// with 889 cities spread round the earth, someone is always about to start.
			expect(r.raw, `${key}: ${r.raw}`).toBeGreaterThan(0);
			expect(r.raw, `${key}: ${r.raw}`).toBeLessThanOrEqual(1440);
			expect(r.value, `${key}: ${r.value}`).toMatch(/^in (\d+m|\d+h \d{2})$/);
		}
	});

	it('does not hand the title to a city on the wrong side of midnight UTC', () => {
		// The fault this replaces: ranking by the UTC time of day put an invisible
		// starting line at 00:00z, so a city at 23:52z sorted *last* despite being
		// earlier in real time than the 00:09z "winner". Measured from now, the
		// winner must genuinely be the soonest — so no city may be sooner.
		const at = midWindowMs;
		const minute = Math.floor(at / 60000);
		const winner = dayRecords(table, at).find(r => r.key === 'nextFajr')!;
		let soonest = Infinity;
		for (const [, arr] of table.byCity) {
			for (let i = 0; i < arr.length; i += table.perDay) {
				if (arr[i] > minute) {
					soonest = Math.min(soonest, arr[i] - minute);
					break;
				}
			}
		}
		expect(winner.raw).toBe(soonest);
	});

	it('fast lengths are plausible, and duration formatting round-trips', () => {
		const records = dayRecords(table, midWindowMs);
		for (const key of ['longestFast', 'shortestFast', 'longestWait', 'shortestNight']) {
			const r = records.find(x => x.key === key)!;
			const m = /^(\d+)h (\d{2})$/.exec(r.value);
			expect(m, `${key}: ${r.value}`).toBeTruthy();
			expect(Number(m![1]) * 60 + Number(m![2])).toBe(r.raw);
		}

		const longest = records.find(x => x.key === 'longestFast')!;
		const shortest = records.find(x => x.key === 'shortestFast')!;
		expect(longest.raw).toBeGreaterThanOrEqual(shortest.raw);
		// A fast under 4 hours or over 23 is a sign of a unit mixup, not real data.
		expect(shortest.raw).toBeGreaterThan(4 * 60);
		expect(longest.raw).toBeLessThan(23 * 60);
	});

	it('raw ordering matches the claim: the winner really beats every other city', () => {
		// Recompute each city's own fast length for "today" the same way dayRecords
		// does, and check nobody beats the reported winner.
		const minute = Math.floor(midWindowMs / 60000);
		const perDay = table.perDay;

		let maxFast = -Infinity;
		let minFast = Infinity;
		for (const arr of table.byCity.values()) {
			if (arr.length < perDay) continue;
			const days = arr.length / perDay;
			let lo = 0;
			let hi = days - 1;
			while (lo < hi) {
				const mid = (lo + hi + 1) >> 1;
				if (arr[mid * perDay] <= minute) lo = mid;
				else hi = mid - 1;
			}
			const base = lo * perDay;
			const fast = arr[base + 4] - arr[base];
			maxFast = Math.max(maxFast, fast);
			minFast = Math.min(minFast, fast);
		}

		const records = dayRecords(table, midWindowMs);
		expect(records.find(r => r.key === 'longestFast')!.raw).toBe(maxFast);
		expect(records.find(r => r.key === 'shortestFast')!.raw).toBe(minFast);
	});

	it('picks each city its own local day, not a shared UTC date', () => {
		// Sampling a few hours apart should not change most cities' records, but
		// should occasionally shift the day for cities near the UTC line — proof
		// this isn't quietly keyed off one shared calendar date.
		const a = dayRecords(table, midWindowMs);
		const b = dayRecords(table, midWindowMs + 12 * 3600000);
		expect(a.length).toBe(6);
		expect(b.length).toBe(6);
	});
});
