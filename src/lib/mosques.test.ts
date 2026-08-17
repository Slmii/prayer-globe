import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MOSQUES } from './mosques';
import { CITIES } from './cities';
import { DESIGN_MOSQUES } from './mosques-model';
import { EXTRA_PLATES } from './mosque-views';

// MOSQUES drops any entry whose city is not on the globe, with only a
// console.warn to show for it — so a mosque can go missing without anything
// failing. Al-Aqsa and Bibi-Khanym were both dropped this way and it surfaced
// only by reading the browser console. These assertions turn that into a test
// failure, and `REQUIRED_CITIES` in scripts/prayer-data/select-cities.ts is
// what keeps their cities in the generated list.
// City values with an apostrophe (Samarra', Xi'an) are double-quoted in the
// source, so both quote styles have to be matched or those two entries vanish
// from `declared` without a single test failing to say why.
const declared = [...readFileSync('src/lib/mosques.ts', 'utf8').matchAll(/city:\s*(?:'([^']+)'|"([^"]+)")/g)].map(
	m => m[1] ?? m[2]
);

describe('MOSQUES', () => {
	it('declares at least one mosque', () => {
		expect(declared.length).toBeGreaterThan(0);
	});

	it('keeps every declared mosque — none silently dropped for a missing city', () => {
		const missing = declared.filter(city => !CITIES.some(c => c.n === city));
		expect(missing, `no dot on the globe for: ${missing.join(', ')}`).toEqual([]);
		// Every `city:` declaration must survive; the placed ones are extra.
		const anchored = MOSQUES.filter(m => m.anchored === 'city');
		expect(anchored).toHaveLength(declared.length);
	});

	it('places every mosque at its city, never at 0°,0°', () => {
		for (const m of MOSQUES.filter(x => x.anchored === 'city')) {
			const city = CITIES.find(c => c.n === m.city);
			expect(city, `${m.name} names a city that is not on the globe`).toBeDefined();
			expect(m.lat).toBe(city!.la);
			expect(m.lon).toBe(city!.lo);
			expect(Math.abs(m.lat) + Math.abs(m.lon)).toBeGreaterThan(0);
		}
	});

	/*
	 * The viewer's rail is built from the sites, so a site whose model has no
	 * plate is a mosque you can press and then find nothing behind the button.
	 *
	 * This is exactly the gap that already existed once: the design set covers
	 * twenty-six buildings and the globe stands twenty-eight, because Makkah and
	 * Madinah are drawn from this app's own Kaaba and Nabawi models. Those two
	 * are filled in by `EXTRA_PLATES`, and nothing but this test would notice a
	 * twenty-ninth site arriving with neither.
	 */
	it('has a viewer plate for every model standing on the globe', () => {
		const design = new Set<string>(DESIGN_MOSQUES.map(m => m.key));
		const missing = [...new Set(MOSQUES.map(m => m.model))].filter(
			model => !design.has(model) && !EXTRA_PLATES[model]
		);
		expect(missing, `nothing for the 3D viewer to show for: ${missing.join(', ')}`).toEqual([]);
	});

	it('gives every placed mosque real coordinates', () => {
		// These carry their own position because the app ships no city there, so
		// nothing else can catch a typo that would drop one into the Atlantic.
		const placed = MOSQUES.filter(m => m.anchored === 'point');
		expect(placed.length).toBeGreaterThan(0);
		for (const m of placed) {
			expect(Number.isFinite(m.lat) && Number.isFinite(m.lon), m.name).toBe(true);
			expect(Math.abs(m.lat), m.name).toBeLessThanOrEqual(90);
			expect(Math.abs(m.lat) + Math.abs(m.lon), `${m.name} sits at 0°,0°`).toBeGreaterThan(0.5);
			expect(
				CITIES.some(c => c.n === m.city),
				`${m.name} should not shadow a city dot`
			).toBe(false);
		}
	});
});
