// Backs the "records for this day" panel: six extremes — longest and shortest
// fast, shortest night, the next city into Fajr and into Isha, and the longest
// wait between maghrib and isha — recomputed from the real Diyanet boundaries as
// the clock scrubs.
//
// Their formats and colours follow the design. Two are worth spelling out
// because they are not what their names first suggest: "shortest night" is
// measured sunset to sunrise, not isha to fajr; and the two Fajr/Isha rows are
// not day records at all but live races, measured from the current instant. The
// design ranked those by the UTC time of day each prayer fell at, which put an
// invisible starting line at midnight UTC — see the note in `dayRecords`.
//
// "This day" is per city, not a shared UTC date: a city at UTC+13 and one at
// UTC-11 are never on the same calendar day at once, and picking one date for
// everyone would quietly hand the earliest-fajr title to whichever hemisphere
// the chosen date happened to favour. Each city's own boundary array settles
// its own day instead — see `dayBlock`.

import type { City } from './cities';
import { CITIES } from './cities';
import type { PhaseTable } from './phases';

/** One country about to cross into a prayer, and how soon. */
export interface Crossing {
	iso2: string;
	country: string;
	/** The country's own first city over the line — where the row flies to. */
	city: City;
	/** Minutes from now. */
	mins: number;
}

/** How far ahead the two races look when listing who is about to cross. */
export const WINDOW_MINS = 10;

export interface DayRecord {
	key: string;
	/** Uppercase micro-label, e.g. 'LONGEST FAST'. */
	label: string;
	/** Preformatted for display, e.g. '19h 42' or 'in 6m'. */
	value: string;
	/** Row accent, from the design. */
	color: string;
	city: City;
	/** Sort key behind `value`, for tests. */
	raw: number;
	/**
	 * For the two races only: every country crossing within `WINDOW_MINS`,
	 * soonest first. One entry per country — a hundred Russian cities crossing
	 * within a minute of each other is one fact, not a hundred.
	 */
	window?: Crossing[];
}

/**
 * Which block of 6 boundaries is "today" for this city, at `minute`.
 *
 * The block whose fajr is the last at or before `minute`, or block 0 if
 * `minute` is before the array's very first fajr — the same "before the
 * window, but don't guess further back" degrade `phaseOf` uses, just phrased
 * per-day instead of per-phase.
 */
export function dayBlock(arr: Int32Array, perDay: number, minute: number): number {
	const days = arr.length / perDay;
	let lo = 0;
	let hi = days - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (arr[mid * perDay] <= minute) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

// The design's format: '18h 03', zero-padded minutes and no trailing 'm'.
const duration = (mins: number): string =>
	`${Math.floor(mins / 60)}h ${String(Math.round(mins % 60)).padStart(2, '0')}`;

interface Best {
	raw: number;
	city: City;
}

export function dayRecords(table: PhaseTable, nowMs: number): DayRecord[] {
	const minute = Math.floor(nowMs / 60000);
	const perDay = table.perDay;

	let longestFast: Best | null = null;
	let shortestFast: Best | null = null;
	let shortestNight: Best | null = null;
	let nextFajr: Best | null = null;
	let nextIsha: Best | null = null;
	// Countries about to cross, keyed by ISO2 so one country counts once however
	// many of its cities are in the window.
	const fajrWindow = new Map<string, Crossing>();
	const ishaWindow = new Map<string, Crossing>();
	let longestWait: Best | null = null;

	for (const city of CITIES) {
		const arr = table.byCity.get(city.ilceID);
		if (!arr || arr.length < perDay) continue;

		const block = dayBlock(arr, perDay, minute);
		const base = block * perDay;
		const fajr = arr[base];
		const maghrib = arr[base + 4];
		const isha = arr[base + 5];

		const fast = maghrib - fajr;
		if (!longestFast || fast > longestFast.raw) longestFast = { raw: fast, city };
		if (!shortestFast || fast < shortestFast.raw) shortestFast = { raw: fast, city };

		// The gap between breaking the fast and the night prayer. At high latitude
		// in summer this is the record that stretches, because isha waits on a sun
		// that is barely setting.
		const wait = isha - maghrib;
		if (!longestWait || wait > longestWait.raw) longestWait = { raw: wait, city };

		// Night measured sunset to sunrise, as the design defines it — the dark
		// hours, not the gap between the two night prayers.
		if (base + perDay + 1 < arr.length) {
			const night = arr[base + perDay + 1] - maghrib;
			if (!shortestNight || night < shortestNight.raw) shortestNight = { raw: night, city };
		}

		/*
		 * The two races, run from now rather than from a line on the clock.
		 *
		 * These used to rank cities by the UTC time of day their prayer fell at —
		 * smallest wins "first into Fajr". That sorts a circular quantity as though
		 * it were a straight one, which quietly puts the starting line at midnight
		 * UTC: on a recent day Moscow took the title at 00:09z while Male, at
		 * 23:52z, was seventeen minutes *earlier* in real time and sorted last. A
		 * hundred cities sat within an hour of that seam.
		 *
		 * The prayer line sweeps the earth continuously; it never starts and never
		 * finishes, so "first" only means anything relative to a moment. That moment
		 * is now: whose next Fajr comes soonest, and whose next Isha does.
		 */
		const soonest = (slot: number): number | null => {
			for (let i = base + slot; i < arr.length; i += perDay)
				if (arr[i] > minute) {
					return arr[i] - minute;
				}
			return null;
		};
		const toFajr = soonest(0);
		const toIsha = soonest(5);
		if (toFajr != null && (!nextFajr || toFajr < nextFajr.raw)) nextFajr = { raw: toFajr, city };
		if (toIsha != null && (!nextIsha || toIsha < nextIsha.raw)) nextIsha = { raw: toIsha, city };

		const noteCrossing = (into: Map<string, Crossing>, mins: number | null) => {
			if (mins == null || mins > WINDOW_MINS) return;
			const held = into.get(city.iso2);
			if (!held || mins < held.mins) into.set(city.iso2, { iso2: city.iso2, country: city.country, city, mins });
		};
		noteCrossing(fajrWindow, toFajr);
		noteCrossing(ishaWindow, toIsha);
	}

	const out: DayRecord[] = [];
	const add = (
		key: string,
		label: string,
		best: Best | null,
		format: (raw: number) => string,
		color: string,
		window?: Map<string, Crossing>
	) => {
		if (best) {
			out.push({
				key,
				label,
				value: format(best.raw),
				color,
				city: best.city,
				raw: best.raw,
				...(window ? { window: [...window.values()].sort((a, b) => a.mins - b.mins) } : {})
			});
		}
	};

	/**
	 * How long until it happens: 'in 4m', 'in 1h 12'.
	 *
	 * A time of day would have to name a zone to mean anything, and the whole
	 * point of these two rows is that the answer is the same everywhere — the next
	 * city into Fajr is four minutes away whoever is reading.
	 */
	const soon = (mins: number) => (mins < 60 ? `in ${Math.max(0, Math.round(mins))}m` : 'in ' + duration(mins));

	add('longestFast', 'LONGEST FAST', longestFast, duration, '#f4c56a');
	add('shortestFast', 'SHORTEST FAST', shortestFast, duration, '#7ee0b8');
	add('shortestNight', 'SHORTEST NIGHT', shortestNight, duration, '#b5abfc');
	add('nextFajr', 'NEXT INTO FAJR', nextFajr, soon, '#d2cefd', fajrWindow);
	add('nextIsha', 'NEXT INTO ISHA', nextIsha, soon, '#968ae0', ishaWindow);
	add('longestWait', 'LONGEST WAIT FOR ISHA', longestWait, duration, '#f0925e');

	return out;
}
