// The visibility map for one evening, as polygons the globe can draw.
//
// WHY RECTANGLES AND NOT CONTOURS
//
// The obvious way to draw a scalar field in bands is marching squares: trace
// iso-lines at each threshold, close them into rings, fill between. It gives
// clean curved edges and few polygons. It also has to handle open contours at
// the grid edge, rings that enclose other rings, the antimeridian, and the
// poles — and the poles and the antimeridian are exactly where this globe has
// drawn blood before.
//
// So instead: evaluate a grid, and merge each row's runs of equal zone into
// rectangles. No tracing, no topology, nothing to get wrong at a seam. At two
// degrees the edges are stepped rather than smooth, but they are stepped by
// about the width of the uncertainty in the criteria themselves — these are
// classifications with disputed boundaries, not a measured surface, and a
// crisp curve would claim a precision that is not there.
//
// The "not visible" zone is not emitted at all. It is most of the earth on most
// evenings, and drawing it would be a hundred rectangles saying nothing.

import { sighting, lastConjunction, moonTrack, toJD } from './hilal';
import type { Criterion, Zone } from './hilal';
import { CITIES } from './cities';

export interface Band {
	zone: Zone;
	/** A closed rectangle in [lon, lat], ready for a GeoJSON polygon. */
	ring: [number, number][];
}

export interface Field {
	/** The evening these bands are for, ms. */
	eveningMs: number;
	criterion: Criterion;
	bands: Band[];
	/** Conjunction for this lunation, ms — the age every point is measured from. */
	conjunctionMs: number;
}

/** How many of the shipped cities fall in each zone. */
export type ZoneCounts = Partial<Record<Zone, number>>;

/** The place with the best view of this evening's crescent. */
export interface BestSighting {
	name: string;
	lat: number;
	lon: number;
	zone: Zone;
}

export interface CitySummary {
	counts: ZoneCounts;
	/** Null when no city on earth can see it — every young evening starts here. */
	best: BestSighting | null;
}

/** Zones from best to worst, for ranking. */
const RANK: Zone[] = ['easy', 'visible', 'optical-then-eye', 'optical', 'none'];

/**
 * The same judgement, city by city rather than on a grid.
 *
 * Turns the legend from a key into a measurement: "easily visible" means
 * little until it says how much of the inhabited world it covers. Counted over
 * the cities the app ships, which is the same set the prayer tally uses, so the
 * two numbers on screen are about the same world.
 *
 * Cities with no sunset that evening are left out of every bucket rather than
 * swept into "not visible" — for them the question does not arise, and the
 * totals are honest about not summing to the full list.
 */
export function cityZones(eveningMs: number, criterion: Criterion): CitySummary {
	const conj = lastConjunction(toJD(eveningMs));
	const track = trackFor(eveningMs);
	const counts: ZoneCounts = {};
	let best: BestSighting | null = null;
	let bestRank = Infinity;
	let bestScore = -Infinity;

	for (const c of CITIES) {
		const s = sighting(c.la, c.lo, eveningMs, criterion, conj, track);
		if (!s) continue;
		counts[s.zone] = (counts[s.zone] ?? 0) + 1;

		/*
		 * Best is the zone first, then the criterion's own score inside it.
		 *
		 * Ranking on the score alone would let a place that just misses a
		 * threshold outrank one that clears it, which reads as nonsense next to a
		 * legend that groups by zone. `none` is skipped outright: on the evening
		 * of a conjunction nowhere can see it, and naming a "best" place to fail
		 * would be worse than saying nothing.
		 */
		if (s.zone === 'none') continue;
		const rank = RANK.indexOf(s.zone);
		if (rank < bestRank || (rank === bestRank && s.score > bestScore)) {
			bestRank = rank;
			bestScore = s.score;
			best = { name: c.n, lat: c.la, lon: c.lo, zone: s.zone };
		}
	}
	return { counts, best };
}

/**
 * One sampling of the lunar series for a whole evening's worth of points.
 *
 * Sunsets run right around the earth, and moonset trails each of them by up to
 * a day, so the window has to be generous — but it is still one track, shared
 * by every point on the globe, because where the observer stands does not move
 * the moon. Without this each point sampled its own and the field spent nearly
 * all its time recomputing the same ninety-term series.
 */
const trackFor = (eveningMs: number) => moonTrack(toJD(eveningMs) - 18 / 24, 54);

/**
 * Latitudes worth asking about.
 *
 * Beyond about 65° the sun spends much of the year not setting at all, and
 * where it does set the crescent is so low and the twilight so long that no
 * criterion was ever fitted there. `sighting` returns null rather than
 * guessing, so those rows simply produce nothing.
 */
const LAT_MIN = -65;
const LAT_MAX = 65;

/**
 * Compute one evening's bands.
 *
 * Two degrees by two is ~11,700 points. Each costs a sunset solve and a moonset
 * solve, which is why this belongs in a worker rather than on the frame the
 * reader is looking at.
 */
export function hilalField(eveningMs: number, criterion: Criterion, step = 2): Field {
	// Once, for the whole globe — see the note on `lastConjunction`.
	const conj = lastConjunction(toJD(eveningMs));
	const track = trackFor(eveningMs);
	const bands: Band[] = [];

	for (let lat = LAT_MIN; lat <= LAT_MAX; lat += step) {
		let runZone: Zone | null = null;
		let runStart = -180;

		const flush = (endLon: number) => {
			if (!runZone || runZone === 'none') return;
			const a = lat - step / 2;
			const b = lat + step / 2;
			bands.push({
				zone: runZone,
				ring: [
					[runStart, a],
					[endLon, a],
					[endLon, b],
					[runStart, b],
					[runStart, a]
				]
			});
		};

		for (let lon = -180; lon <= 180; lon += step) {
			const s = sighting(lat, lon, eveningMs, criterion, conj, track);
			const zone: Zone | null = s ? s.zone : null;
			if (zone !== runZone) {
				flush(lon);
				runZone = zone;
				runStart = lon;
			}
		}
		flush(180);
	}

	return { eveningMs, criterion, bands, conjunctionMs: (conj - 2440587.5) * 86400000 };
}
