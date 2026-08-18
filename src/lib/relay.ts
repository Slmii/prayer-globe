// The relay: the adhan being handed from city to city, without a pause.
//
// Every other panel answers a question about a place. This one answers a
// question about the whole earth at once, and it is the only question this app
// is uniquely able to answer: at any instant, somewhere is crossing into a
// prayer, and a moment later somewhere else is. The line never starts and never
// finishes — it is always mid-handover.
//
// So this is a departures board. Not a metaphor chosen for decoration: a board
// of imminent departures is exactly the shape of the data, and the reason it is
// worth watching is the same reason a station board is — the top row is always
// about to go, and the list behind it never empties.
//
// WHAT IS AND IS NOT COUNTED
//
// Five prayers. Shuruq is a boundary in the table but nobody is called to it,
// so slot 1 is skipped.
//
// A row is a *wave*, not a city.
//
// The timetable is minute-resolution, so everything crossing in a given minute
// crosses simultaneously as far as the data knows — and a per-city board proved
// it, printing `0:44` down six consecutive rows and reading like a stuck list.
// It was not stuck: six countries really do go together. Grouping by instant and
// prayer says that once, which is both the truth and the thing worth seeing —
// the relay moves in waves sweeping the earth, not in single steps.
//
// Within a wave, one place per country. A hundred Indonesian cities crossing
// into Isha together is one fact, and the same de-duplication is what
// `records.ts` does for its two races. The country's first city stands for it,
// so a row still flies somewhere specific.
//
// Times are carried as absolute instants rather than as minutes remaining. The
// board's *composition* only changes when the minute does, but the countdowns
// have to run every frame — keeping the instant lets the panel memoise the
// expensive pass over 891 cities and still tick smoothly. See RelayPanel.

import { PHASES, ROWS } from './astro';
import type { City } from './cities';
import { CITIES } from './cities';
import type { PhaseTable } from './phases';
import { dayBlock } from './records';

/** Boundary slots that are calls to prayer. Slot 1, Shuruq, is not one. */
const PRAYER_SLOTS = [0, 2, 3, 4, 5] as const;

/** How far ahead the board looks. */
export const BOARD_MINS = 20;

/**
 * How long a crossing stays up after it happens, in simulated minutes.
 *
 * The moment of handover is the whole point, so a row that has just gone does
 * not vanish — it holds for a beat reading NOW, then leaves. Without this the
 * board only ever shows the future and the event itself is never seen.
 */
export const LINGER_MINS = 0.5;

/** One country in a wave, and the city that stands for it. */
export interface Place {
	city: City;
	country: string;
	iso2: string;
}

/** Everywhere crossing into one prayer at one instant. */
export interface Wave {
	/** Stable across recomputes, so React can animate rows rather than replace them. */
	key: string;
	/** The exact instant of the crossing, epoch ms. */
	atMs: number;
	/** 'Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'. */
	prayer: string;
	ar: string;
	/** The phase this crossing begins, from the design's palette. */
	color: string;
	/** One per country, in the order their cities were found. */
	places: Place[];
}

/**
 * Every imminent crossing, soonest first.
 *
 * `nowMs` is the scrubbed instant, not wall time, so the board answers for
 * whatever moment the clock is parked at.
 */
export function relayBoard(phases: PhaseTable | null, nowMs: number, limit = 15): Wave[] {
	if (!phases) {
		return [];
	}
	const minute = Math.floor(nowMs / 60000);
	const perDay = phases.perDay;
	const from = nowMs - LINGER_MINS * 60000;
	const to = nowMs + BOARD_MINS * 60000;

	// Keyed by instant and prayer — one entry per wave. The inner set keeps a
	// country from appearing twice in the same one.
	const board = new Map<string, Wave>();
	const claimed = new Set<string>();

	for (const city of CITIES) {
		const arr = phases.byCity.get(city.ilceID);
		if (!arr || arr.length < perDay) {
			continue;
		}

		const base = dayBlock(arr, perDay, minute) * perDay;

		for (const slot of PRAYER_SLOTS) {
			// The first crossing of this prayer still inside the window. Stepping a
			// day at a time from today's block, exactly as the records pass does.
			let atMs = 0;
			for (let i = base + slot; i < arr.length; i += perDay) {
				const t = arr[i] * 60000;
				if (t > to) {
					break;
				}
				if (t >= from) {
					atMs = t;
					break;
				}
			}
			if (!atMs) {
				continue;
			}

			const key = atMs + ':' + slot;
			// One country per wave, first city found.
			const seat = key + ':' + city.iso2;
			if (claimed.has(seat)) {
				continue;
			}
			claimed.add(seat);

			let wave = board.get(key);
			if (!wave) {
				const row = ROWS[slot];
				wave = { key, atMs, prayer: row.label, ar: row.ar, color: PHASES[slot].c, places: [] };
				board.set(key, wave);
			}
			wave.places.push({ city, country: city.country, iso2: city.iso2 });
		}
	}

	return [...board.values()].sort((a, b) => a.atMs - b.atMs || a.prayer.localeCompare(b.prayer)).slice(0, limit);
}

/** "4:07", "0:42", or "now" once it has happened. */
export function countdown(msLeft: number): string {
	if (msLeft <= 0) {
		return 'now';
	}
	const s = Math.round(msLeft / 1000);
	return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
