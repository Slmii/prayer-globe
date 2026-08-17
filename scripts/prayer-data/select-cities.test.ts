import { describe, it, expect } from 'vitest';
import { disambiguate } from './select-cities.ts';

const city = (n: string, iso2: string) => ({ n, iso2 });

describe('disambiguate', () => {
	// public/times/index.json is keyed by display name and the app looks up by
	// city.n, so a shared name resolved both dots to one ilceID and showed one
	// city the other's prayer times.
	it('qualifies both sides of a real collision', () => {
		const out = disambiguate([city('Barcelona', 'ES'), city('Barcelona', 'VE')]);
		expect(out.map(c => c.n)).toEqual(['Barcelona (ES)', 'Barcelona (VE)']);
	});

	it('leaves unique names untouched', () => {
		const out = disambiguate([city('Istanbul', 'TR'), city('London', 'GB')]);
		expect(out.map(c => c.n)).toEqual(['Istanbul', 'London']);
	});

	it('produces names unique enough to key an index by', () => {
		const input = [
			city('Barcelona', 'ES'),
			city('Barcelona', 'VE'),
			city('Valencia', 'VE'),
			city('Valencia', 'ES'),
			city('Tripoli', 'LY'),
			city('Tripoli', 'LB'),
			city('Victoria', 'HK'),
			city('Victoria', 'SC'),
			city('Hamilton', 'NZ'),
			city('Hamilton', 'BM'),
			city('Istanbul', 'TR')
		];
		const names = disambiguate(input).map(c => c.n);
		expect(new Set(names).size).toBe(input.length);
	});

	it('handles three-way collisions', () => {
		const out = disambiguate([city('Santiago', 'CL'), city('Santiago', 'DO'), city('Santiago', 'PH')]);
		expect(new Set(out.map(c => c.n)).size).toBe(3);
	});

	it('keeps every other field intact', () => {
		const [only] = disambiguate([{ n: 'Tripoli', iso2: 'LY', ilceID: '15191', pop: 1303000 }]);
		expect(only).toEqual({ n: 'Tripoli', iso2: 'LY', ilceID: '15191', pop: 1303000 });
	});
});
