// Backs the "chain" mode: follow one prayer as it circles the earth, to make
// visible the thing the app otherwise only implies — that at any instant some
// city, somewhere, is stepping into Fajr while another is stepping out of it,
// forever.
//
// Everything here reads straight off the same UTC-minute boundary arrays
// `phaseOf` uses, for the same reason: those are Diyanet's real published
// instants, not a solar approximation, so the chain lines up with what each
// city's own card shows.

import { wrap } from './astro';
import type { City } from './cities';
import { CITIES } from './cities';
import type { PhaseTable } from './phases';

export interface ChainEdge {
	kind: 'entering' | 'leaving';
	city: City;
	/** Instant that city entered, or will leave, the prayer. */
	ms: number;
}

export interface ChainState {
	/** Cities currently in this prayer. */
	cities: City[];
	count: number;
	/** Cities the table could answer for at all — the honest denominator. */
	total: number;
	/** Most recent city to enter, and the next to leave. Empty if none. */
	edges: ChainEdge[];
	/** How far the prayer's leading edge has travelled around the earth, 0–1. */
	pct: number;
}

/**
 * A city's phase and surrounding boundaries at `minute`, or null when
 * `phaseOf` would also say null.
 *
 * Mirrors `phaseOf`'s two branches exactly, but also hands back the boundary
 * either side rather than just the phase index, since the chain needs the
 * actual instants. The one case `phaseOf` answers that this cannot fully
 * answer: the stretch before the window's first fajr, which it treats as the
 * previous night's Isha by extending 1440 minutes backward. That extension is
 * a safety margin, not a recorded instant, so `entryMin` comes back null
 * there — the city still counts as being in Isha, it just cannot be a
 * candidate for "entering" it, because we do not actually know when it did.
 */
function windowFor(
	arr: Int32Array,
	perDay: number,
	minute: number
): { phase: number; entryMin: number | null; exitMin: number } | null {
	if (arr.length === 0) {
		return null;
	}
	if (minute >= arr[arr.length - 1]) {
		return null;
	}

	if (minute < arr[0]) {
		if (minute < arr[0] - 1440) {
			return null;
		}
		return { phase: 5, entryMin: null, exitMin: arr[0] };
	}

	const k = lastBefore(arr, minute);
	return { phase: k % perDay, entryMin: arr[k], exitMin: arr[k + 1] };
}

/** Index of the last boundary at or before `minute`. Assumes `minute >= arr[0]`. */
function lastBefore(arr: Int32Array, minute: number): number {
	let lo = 0;
	let hi = arr.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (arr[mid] <= minute) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

export function chainState(table: PhaseTable, phase: number, nowMs: number): ChainState {
	const minute = Math.floor(nowMs / 60000);

	const cities: City[] = [];
	let total = 0;

	let enteringCity: City | null = null;
	let enteringMs = -Infinity;
	let leavingCity: City | null = null;
	let leavingMs = Infinity;

	for (const city of CITIES) {
		const arr = table.byCity.get(city.ilceID);
		if (!arr) continue;
		const w = windowFor(arr, table.perDay, minute);
		if (!w) continue;

		total++;
		if (w.phase !== phase) continue;
		cities.push(city);

		if (w.entryMin !== null) {
			const ms = w.entryMin * 60000;
			if (ms > enteringMs) {
				enteringMs = ms;
				enteringCity = city;
			}
		}

		const exitMs = w.exitMin * 60000;
		if (exitMs < leavingMs) {
			leavingMs = exitMs;
			leavingCity = city;
		}
	}

	const edges: ChainEdge[] = [];
	if (enteringCity) edges.push({ kind: 'entering', city: enteringCity, ms: enteringMs });
	if (leavingCity) edges.push({ kind: 'leaving', city: leavingCity, ms: leavingMs });

	// A prayer's boundary happens at a fixed local solar time, so as UTC
	// advances the longitude where it is "just starting" drifts west — the
	// same reason sunrise sweeps west across a map as the day goes on. One full
	// day therefore carries the entering edge all the way around, and `pct` is
	// just how far around that lap it is.
	//
	// The origin is a presentation choice, not a physical one: 0° (Greenwich)
	// would put the jump from 1 to 0 in the middle of the visible map, right
	// where a viewer is looking. Anchoring at the antimeridian instead — the
	// same seam `splitAtAntimeridian` already treats as the natural cut —
	// pushes that jump to the edge, out of the way.
	const pct = enteringCity ? (180 - wrap(enteringCity.lo)) / 360 : 0;

	return { cities, count: cities.length, total, edges, pct };
}
