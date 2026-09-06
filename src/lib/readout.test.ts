import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildReadout, peopleTxt, citiesInPhase } from './readout';
import { decodePhases } from './phases';
import type { PhasesFile } from './phases';
import { CITIES } from './cities';

/*
 * The tally counts cities and, now, the people in them. The count is easy to get
 * subtly wrong — a missing population poisoning a sum, a city landed in two
 * phases, a total that quietly drifts from the data it claims to describe — and
 * none of those would look wrong on screen.
 */
const file = JSON.parse(readFileSync('public/phases.json', 'utf8')) as PhasesFile;
const phases = decodePhases(file);
const at = Date.UTC(2026, 7, 18, 12);

const readout = () => buildReadout({ city: null, nowMs: at, hover: null, centerLng: 0, days: null, phases });

describe('people by prayer', () => {
	it('accounts for every city exactly once, Duha aside', () => {
		const a = readout();
		const placed = a.counts.reduce((n, c) => n + c.n, 0);
		const people = a.counts.reduce((n, c) => n + c.people, 0);

		/*
		 * The bar shows five prayers, not six: Duha — the stretch between sunrise
		 * and noon — is a phase of the day rather than a prayer with a boundary to
		 * cross, so the tally leaves it out. Which means "placed" is short of the
		 * full list by exactly the cities in Duha, and that is the sum worth
		 * checking: anything else means a city has been dropped or double-counted.
		 */
		const duha = citiesInPhase(at, 1, phases).cities.length;
		expect(placed + duha).toBe(CITIES.length);
		expect(duha).toBeGreaterThan(0);

		expect(people).toBe(a.peopleTotal);

		// And the total can never exceed everyone in the dataset.
		const everyone = CITIES.reduce((n, c) => n + (c.pop || 0), 0);
		expect(people).toBeLessThanOrEqual(everyone);
		expect(people / everyone).toBeGreaterThan(0.5);
	});

	it('never reports a NaN, though one city ships without a population', () => {
		// Plymouth has no `pop`. Summed naively that is one NaN and the whole
		// tally becomes NaN — including the four prayers it has nothing to do with.
		const missing = CITIES.filter(c => !c.pop);
		expect(missing.length).toBeGreaterThan(0);

		const a = readout();
		for (const c of a.counts) {
			expect(Number.isFinite(c.people), `${c.label}`).toBe(true);
		}
		expect(Number.isFinite(a.peopleTotal)).toBe(true);
	});

	it('names the prayer with the most people, which is not always the one with the most cities', () => {
		/*
		 * The whole reason the line exists. Across a day the two leaders differ
		 * often — a hundred small cities entering Isha outnumber a dozen entering
		 * Maghrib while holding far fewer people — so if they never diverged, the
		 * second line would be saying nothing the first did not.
		 */
		let differed = 0;
		for (let h = 0; h < 24; h++) {
			const a = buildReadout({
				city: null,
				nowMs: at + h * 3600000,
				hover: null,
				centerLng: 0,
				days: null,
				phases
			});
			const byCities = a.counts.reduce((b, c) => (c.n > b.n ? c : b), a.counts[0]);
			const byPeople = a.counts.reduce((b, c) => (c.people > b.people ? c : b), a.counts[0]);
			if (byCities.label !== byPeople.label) {
				differed++;
			}
			expect(a.peopleLead.startsWith(byPeople.label.toUpperCase())).toBe(true);
		}
		expect(differed, 'the two tallies never disagreed across a whole day').toBeGreaterThan(0);
	});
});

describe('peopleTxt', () => {
	it('reads at a glance rather than to the person', () => {
		expect(peopleTxt(1_031_000_000)).toBe('1.0bn');
		expect(peopleTxt(310_400_000)).toBe('310M');
		expect(peopleTxt(24_900_000)).toBe('25M');
		expect(peopleTxt(142_937)).toBe('143k');
		expect(peopleTxt(0)).toBe('0k');
	});
});
