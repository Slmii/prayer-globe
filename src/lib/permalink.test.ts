import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	encodeView,
	decodeView,
	loadPinned,
	savePinned,
	resolvePin,
	pinName,
	loadHome,
	saveHome,
	locationAsked,
	markLocationAsked
} from './permalink';
import type { ViewState } from './permalink';
import type { City } from './cities';
import { CITIES } from './cities';

describe('encodeView / decodeView', () => {
	it('round-trips every field, including a city with a space and an apostrophe', () => {
		const v: ViewState = { city: "'s-Hertogenbosch", scrub: 720, mode: 'chain', chain: 3 };
		const hash = encodeView(v);
		expect(hash.startsWith('#/view')).toBe(true);
		expect(decodeView(hash)).toEqual(v);
	});

	it('round-trips a non-ASCII city name', () => {
		const v: ViewState = { city: 'Māl̥e', scrub: 0, mode: 'now', chain: null };
		const hash = encodeView(v);
		const decoded = decodeView(hash);
		expect(decoded.city).toBe('Māl̥e');
		expect(decoded.mode).toBe('now');
	});

	it('omits fields at their defaults, and decoding that back drops them rather than inventing values', () => {
		const hash = encodeView({ city: null, scrub: 0, mode: null, chain: null });
		expect(hash).toBe('#/view');
		expect(decodeView(hash)).toEqual({});
	});

	it('cannot collide with the #/solar route', () => {
		// main.tsx routes on hash.startsWith('#/solar'); our prefix is a
		// different literal path segment so it can never match that check.
		expect(encodeView({ city: 'Anywhere', scrub: 0, mode: null, chain: null }).startsWith('#/solar')).toBe(false);
	});

	it('never throws and drops junk fields on hostile input', () => {
		expect(() => decodeView('#/solar')).not.toThrow();
		expect(decodeView('#/solar')).toEqual({});

		expect(() => decodeView('?city=')).not.toThrow();
		expect(decodeView('?city=')).toEqual({});

		expect(() => decodeView('#/city/%%%')).not.toThrow();
		expect(decodeView('#/city/%%%')).toEqual({});

		expect(() => decodeView('#/view?scrub=1e9')).not.toThrow();
		expect(decodeView('#/view?scrub=1e9')).toEqual({});

		expect(() => decodeView('#/view?mode=drop table')).not.toThrow();
		expect(decodeView('#/view?mode=drop table')).toEqual({});

		// Chain out of range, and a scrub that isn't a number at all.
		expect(decodeView('#/view?chain=9')).toEqual({});
		expect(decodeView('#/view?scrub=abc')).toEqual({});
		expect(decodeView('#/view?scrub=-5')).toEqual({});
	});

	it('accepts values at the edges of their valid ranges', () => {
		expect(decodeView('#/view?scrub=0')).toEqual({ scrub: 0 });
		expect(decodeView('#/view?scrub=14400')).toEqual({ scrub: 14400 });
		expect(decodeView('#/view?chain=0')).toEqual({ chain: 0 });
		expect(decodeView('#/view?chain=5')).toEqual({ chain: 5 });
		for (const mode of ['now', 'chain', 'records', 'ramadan']) {
			expect(decodeView(`#/view?mode=${mode}`)).toEqual({ mode });
		}
	});
});

describe('loadPinned / savePinned', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('round-trips through a working localStorage', () => {
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k)
		});
		expect(loadPinned()).toEqual([]);
		savePinned(['Amsterdam']);
		expect(loadPinned()).toEqual(['Amsterdam']);
		savePinned([]);
		expect(loadPinned()).toEqual([]);
	});

	it('survives a city the bundle does not ship', () => {
		// Pinning a city found by locating — Emmen is one Diyanet publishes and this
		// app does not ship — used to store just its name, which resolved to nothing
		// on the very next render: the pin held a slot and showed no row at all.
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k)
		});

		const found: City = {
			n: 'EMMEN',
			la: 52.785,
			lo: 6.8975,
			tz: '',
			iso2: 'NL',
			country: 'Nederland',
			pop: 0,
			ilceID: '13880',
			ilceUrl: '',
			p: 'NETHERLANDS',
			d: ['EMMEN']
		};
		savePinned(['Amsterdam', found]);

		const back = loadPinned();
		expect(back.map(pinName)).toEqual(['Amsterdam', 'EMMEN']);

		// The shipped one resolves through the bundle, the found one carries itself.
		const [shipped, located] = back.map(resolvePin);
		expect(shipped).toBe(CITIES.find(c => c.n === 'Amsterdam'));
		expect(located?.ilceID).toBe('13880');
		expect(located?.la).toBeCloseTo(52.785, 3);
	});

	it('keeps at most five, and still reads the old single-name value', () => {
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k)
		});
		savePinned(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
		expect(loadPinned()).toEqual(['a', 'b', 'c', 'd', 'e']);

		// Written by a version that pinned exactly one city — must not be lost.
		store.set('pg.pinnedCity', 'Istanbul');
		expect(loadPinned()).toEqual(['Istanbul']);
	});

	it('degrades quietly when localStorage throws', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		});
		expect(() => loadPinned()).not.toThrow();
		expect(loadPinned()).toEqual([]);
		expect(() => savePinned(['Amsterdam'])).not.toThrow();
	});

	it('degrades quietly when localStorage is missing entirely', () => {
		vi.stubGlobal('localStorage', undefined);
		expect(loadPinned()).toEqual([]);
		expect(() => savePinned(['Amsterdam'])).not.toThrow();
	});
});


/*
 * Home is what lets a return visit open where the reader actually is, so the
 * two halves have to agree: whatever `saveHome` writes, `loadHome` must accept.
 * A located district is usually not one of the shipped cities, which is exactly
 * the case a name-only store would lose.
 */
describe('home', () => {
	const memory = () => {
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k)
		});
		return store;
	};

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('round-trips a district that is not in the shipped list', () => {
		memory();
		expect(loadHome()).toBe(null);

		const found: City = {
			n: 'Haarlem',
			la: 52.3874,
			lo: 4.6462,
			tz: 'Europe/Amsterdam',
			iso2: 'NL',
			country: 'NETHERLANDS',
			pop: 161265,
			ilceID: '9206',
			ilceUrl: '/en-US/9206/prayer-time-for-haarlem',
			p: 'HOLLANDA',
			d: ['HAARLEM']
		};
		expect(CITIES.some(c => c.n === found.n)).toBe(false);

		saveHome(found);
		expect(loadHome()).toEqual(found);
	});

	it('clears, and refuses a value that is not a city', () => {
		const store = memory();
		saveHome({ n: 'X', la: 1, lo: 2 } as unknown as City);
		saveHome(null);
		expect(loadHome()).toBe(null);

		store.set('pg.home', '{"n":"Nowhere"}');
		expect(loadHome()).toBe(null);
		store.set('pg.home', 'not json at all');
		expect(loadHome()).toBe(null);
	});

	it('remembers that the offer was made, and survives storage throwing', () => {
		memory();
		expect(locationAsked()).toBe(false);
		markLocationAsked();
		expect(locationAsked()).toBe(true);

		// The browser prompt can only be spent once, but failing to remember must
		// never break the app — it just means asking again.
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			},
			removeItem: () => {
				throw new Error('denied');
			}
		});
		expect(locationAsked()).toBe(false);
		expect(() => markLocationAsked()).not.toThrow();
		expect(loadHome()).toBe(null);
		expect(() => saveHome(null)).not.toThrow();
	});
});
