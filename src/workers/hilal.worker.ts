// The visibility field, computed off the main thread.
//
// Eleven thousand points, each solving a sunset and a moonset, is about a second
// and a half. On the main thread that is a second and a half of frozen globe —
// the spin stops, the clock stops, and a drag goes nowhere. Here it is a second
// and a half during which nothing on screen notices.
//
// One message in, one message out. There is no cancellation: a field is small
// and quick enough that a superseded one is cheaper to ignore than to interrupt,
// and the main thread drops any result whose request it no longer wants.

import { hilalField, cityZones } from '../lib/hilal-field';
import type { Criterion } from '../lib/hilal';
import type { Field, CitySummary } from '../lib/hilal-field';

export interface HilalRequest {
	/** Echoed back, so a late reply to a superseded question can be discarded. */
	id: number;
	eveningMs: number;
	criterion: Criterion;
}

export interface HilalReply extends Field {
	id: number;
	/** The quick first pass. A finer one for the same id follows it. */
	coarse: boolean;
	/** Cities per zone, and the best-placed one. Grid-independent, so done once. */
	summary: CitySummary;
}

/*
 * Two passes, coarse then fine.
 *
 * The full grid is a second and a half, and for all of it the globe had
 * nothing on it — press Hilal, wait, then the map appears at once. A four
 * degree pass is a quarter of the work and lands in a few hundred
 * milliseconds, which is soon enough to read as "here it is, sharpening"
 * rather than as "nothing is happening". The fine pass replaces it in place,
 * and because the zones are broad the difference between them is a slightly
 * softer edge, not a different map.
 */
self.onmessage = (e: MessageEvent<HilalRequest>) => {
	const { id, eveningMs, criterion } = e.data;
	// The city tally does not depend on the grid, so it is computed once and
	// carried by both replies — the legend has its numbers from the first paint.
	const summary = cityZones(eveningMs, criterion);
	const quick: HilalReply = { id, coarse: true, summary, ...hilalField(eveningMs, criterion, 4) };
	self.postMessage(quick);
	const full: HilalReply = { id, coarse: false, summary, ...hilalField(eveningMs, criterion, 2) };
	self.postMessage(full);
};
