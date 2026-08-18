import { describe, it, expect } from 'vitest';
import {
	moonPosition,
	sunPosition,
	obliquity,
	toEquatorial,
	gmst,
	toJD,
	yallopQ,
	odehV,
	sighting,
	lastConjunction
} from './hilal';

/*
 * The ephemeris is checked against Meeus' own worked examples rather than
 * against itself. Everything downstream — the zones, the bands, the verdict a
 * reader acts on — is only as good as these numbers, and an ephemeris that is
 * subtly wrong still returns plausible-looking degrees.
 */

describe('moonPosition — Meeus example 47.a', () => {
	// 1992 April 12, 0h TD. Meeus gives λ = 133.162655°, β = -3.229126°,
	// Δ = 368409.7 km. The abridged series is expected to be within an
	// arcminute, which is two orders better than any threshold here cares about.
	const jd = 2448724.5;

	it('gets the longitude', () => {
		expect(moonPosition(jd).lam).toBeCloseTo(133.162655, 1);
	});

	it('gets the latitude', () => {
		expect(moonPosition(jd).bet).toBeCloseTo(-3.229126, 1);
	});

	it('gets the distance to within a few hundred km', () => {
		expect(moonPosition(jd).dist).toBeGreaterThan(368000);
		expect(moonPosition(jd).dist).toBeLessThan(368800);
	});
});

describe('sunPosition — Meeus example 25.b', () => {
	// 1992 October 13, 0h TD. Apparent longitude 199.90895°.
	const jd = 2448908.5;

	it('gets the apparent longitude', () => {
		expect(sunPosition(jd).lam).toBeCloseTo(199.90895, 2);
	});

	/*
	 * Meeus quotes R for this example from the full VSOP87 series; ch. 25's
	 * low-accuracy method, which is what is used here, lands about 5e-5 AU
	 * away. That is some 8000 km — which sounds like a lot and is nothing: it
	 * moves the sun's apparent diameter by a thousandth of a degree, and
	 * nothing downstream reads R at all. Only the longitude above is used.
	 */
	it('gets the radius vector to the accuracy the low-accuracy series offers', () => {
		expect(sunPosition(jd).dist).toBeCloseTo(0.9976, 3);
	});
});

describe('obliquity — Meeus example 22.a', () => {
	it('is 23.44 degrees in 1987', () => {
		// 1987 April 10, 0h TD: true obliquity 23.4435694°.
		expect(obliquity(2446895.5)).toBeCloseTo(23.4435694, 2);
	});
});

describe('gmst — Meeus example 12.a', () => {
	it('matches at 1987 April 10, 0h UT', () => {
		// 197.693195°.
		expect(gmst(2446895.5)).toBeCloseTo(197.693195, 3);
	});
});

describe('toEquatorial — Meeus example 13.a', () => {
	it('converts ecliptic to equatorial', () => {
		// λ = 113.215630, β = 6.684170, ε = 23.4392911
		// → α = 116.328942, δ = 28.026183
		const eq = toEquatorial({ lam: 113.21563, bet: 6.68417, dist: 1 }, 23.4392911);
		expect(eq.ra).toBeCloseTo(116.328942, 3);
		expect(eq.dec).toBeCloseTo(28.026183, 3);
	});
});

describe('the criteria', () => {
	/*
	 * Both formulae are cubics in the crescent width, and both are quoted
	 * everywhere with the same coefficients — so the check that matters is that
	 * they are wired up the right way round: a higher, wider crescent must score
	 * better, and the two must agree on ordering even where they disagree on
	 * the verdict.
	 */
	it('scores a higher crescent better', () => {
		expect(yallopQ(12, 0.5)).toBeGreaterThan(yallopQ(6, 0.5));
		expect(odehV(12, 0.5)).toBeGreaterThan(odehV(6, 0.5));
	});

	it('scores a wider crescent better at the same altitude', () => {
		expect(yallopQ(8, 0.8)).toBeGreaterThan(yallopQ(8, 0.2));
		expect(odehV(8, 0.8)).toBeGreaterThan(odehV(8, 0.2));
	});

	it('puts Yallop and Odeh in the same order across a range', () => {
		const cases: [number, number][] = [
			[4, 0.2],
			[7, 0.4],
			[10, 0.6],
			[13, 0.9]
		];
		const q = cases.map(([a, w]) => yallopQ(a, w));
		const v = cases.map(([a, w]) => odehV(a, w));
		for (let i = 1; i < cases.length; i++) {
			expect(q[i]).toBeGreaterThan(q[i - 1]);
			expect(v[i]).toBeGreaterThan(v[i - 1]);
		}
	});
});

describe('lastConjunction', () => {
	it('finds the new moon of 2024 April 8 (a solar eclipse, so exactly known)', () => {
		// Conjunction 2024-04-08 18:21 UTC.
		const jd = lastConjunction(toJD(Date.UTC(2024, 3, 9, 12)));
		const ms = (jd - 2440587.5) * 86400000;
		expect(Math.abs(ms - Date.UTC(2024, 3, 8, 18, 21)) / 60000).toBeLessThan(60);
	});
});

describe('sighting', () => {
	/*
	 * The evening after that same eclipse. A total solar eclipse *is* a
	 * conjunction, so the following evening is a well-defined young crescent —
	 * and in the Americas, west of the eclipse track and hours later, it is the
	 * classic first-sighting case.
	 */
	const evening = Date.UTC(2024, 3, 9, 12);

	it('answers for a mid-latitude place', () => {
		const s = sighting(19.43, -99.13, evening); // Mexico City
		expect(s).not.toBeNull();
		expect(s!.arcl).toBeGreaterThan(0);
		expect(s!.lag).toBeGreaterThan(0);
		expect(s!.width).toBeGreaterThan(0);
	});

	it('gives an older, easier crescent further west', () => {
		// Further west means more hours since conjunction by local sunset.
		const east = sighting(19.43, -99.13, evening)!;
		const west = sighting(21.31, -157.86, evening)!; // Honolulu
		expect(west.age).toBeGreaterThan(east.age);
		expect(west.arcl).toBeGreaterThan(east.arcl);
	});

	it('refuses to answer where the sun does not set', () => {
		// Svalbard in June: polar day, so there is no sunset to reckon from.
		expect(sighting(78.22, 15.63, Date.UTC(2024, 5, 21, 12))).toBeNull();
	});

	it('calls the evening of conjunction itself invisible', () => {
		// Hours after conjunction the elongation is inside the Danjon limit
		// everywhere, and no criterion should claim otherwise.
		const s = sighting(21.42, 39.83, Date.UTC(2024, 3, 8, 12)); // Makkah
		expect(s).not.toBeNull();
		expect(s!.zone).toBe('none');
	});
});
