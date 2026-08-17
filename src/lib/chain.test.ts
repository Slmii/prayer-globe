import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodePhases, phaseOf } from './phases';
import type { PhasesFile } from './phases';
import { chainState } from './chain';

const file = JSON.parse(readFileSync('public/phases.json', 'utf8')) as PhasesFile;
const table = decodePhases(file);

// Comfortably inside the published window for every city.
const midWindowMs = Date.parse(`${file.from}T00:00:00Z`) + 20 * 86400000;

describe('chainState', () => {
	it('only reports cities the table actually puts in this phase', () => {
		for (const phase of [0, 1, 2, 3, 4, 5]) {
			const state = chainState(table, phase, midWindowMs);
			expect(state.count).toBe(state.cities.length);
			expect(state.count).toBeLessThanOrEqual(state.total);
			for (const city of state.cities) {
				expect(phaseOf(table, city.ilceID, midWindowMs), city.n).toBe(phase);
			}
		}
	});

	it('brackets now with the entering and leaving edges', () => {
		const state = chainState(table, 2, midWindowMs);
		expect(state.cities.length).toBeGreaterThan(0);

		const entering = state.edges.find(e => e.kind === 'entering');
		const leaving = state.edges.find(e => e.kind === 'leaving');
		expect(entering).toBeTruthy();
		expect(leaving).toBeTruthy();
		expect(entering!.ms).toBeLessThanOrEqual(midWindowMs);
		expect(leaving!.ms).toBeGreaterThan(midWindowMs);

		// Both really are in the phase right now, and really are boundary cities:
		// no other city in the phase entered more recently or leaves sooner.
		for (const city of state.cities) {
			const arr = table.byCity.get(city.ilceID)!;
			const minute = Math.floor(midWindowMs / 60000);
			let k = arr.length - 1;
			while (k > 0 && arr[k] > minute) k--;
			expect(arr[k] * 60000).toBeLessThanOrEqual(entering!.ms);
			expect(arr[k + 1] * 60000).toBeGreaterThanOrEqual(leaving!.ms);
		}
	});

	it('keeps pct in [0, 1]', () => {
		for (let h = 0; h < 24; h++) {
			const ms = midWindowMs + h * 3600000;
			const state = chainState(table, 0, ms);
			expect(state.pct).toBeGreaterThanOrEqual(0);
			expect(state.pct).toBeLessThanOrEqual(1);
		}
	});

	it('advances as the day goes on, wrapping at most once', () => {
		const samples: number[] = [];
		for (let h = 0; h < 24; h += 2) {
			samples.push(chainState(table, 3, midWindowMs + h * 3600000).pct);
		}

		// Unwrap: each step should move forward a little, except for at most one
		// wraparound back through the antimeridian across the whole day.
		let wraps = 0;
		for (let i = 1; i < samples.length; i++) {
			if (samples[i] < samples[i - 1]) wraps++;
		}
		expect(wraps).toBeLessThanOrEqual(1);

		// And it isn't just sitting still.
		expect(new Set(samples.map(p => p.toFixed(3))).size).toBeGreaterThan(1);
	});

	it('returns an honest zero state once past the published window', () => {
		let maxEnd = 0;
		for (const arr of table.byCity.values()) maxEnd = Math.max(maxEnd, arr[arr.length - 1]);
		const past = (maxEnd + 1000) * 60000;
		const state = chainState(table, 0, past);
		expect(state.total).toBe(0);
		expect(state.count).toBe(0);
		expect(state.cities).toEqual([]);
		expect(state.edges).toEqual([]);
		expect(state.pct).toBe(0);
	});
});
