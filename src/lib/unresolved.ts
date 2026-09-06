// Where the rules break.
//
// Every prayer boundary is defined by the sun reaching some angle: −18° for
// Fajr, the horizon for Shuruq and Maghrib, −17° for Isha. Those are
// definitions, not observations, and far enough north the sun does not do the
// thing the rule is waiting for — so the definition has no answer at all.
//
// It fails in both directions, which is the part worth knowing. North of about
// 59° in summer the sun never sinks to −18°, and Fajr and Isha have no moment.
// Inside the Arctic Circle in winter it never climbs to the horizon, and it is
// Shuruq and Maghrib that have none — while Fajr and Isha still work, because
// the noon sun at Longyearbyen reaches about −11° and so crosses −18° on the
// way up and again on the way down. Different months, different casualties.
//
// So this is far from a two-week curiosity. Longyearbyen has a complete solar
// timetable in roughly one month of the twelve; Reykjavík loses five; Berlin
// loses two; Istanbul never loses any. Watching the frontier move is half the
// point — scrub through a summer and the list drains southward as the sun
// returns.
//
// Diyanet prints a time regardless, because a timetable with a blank in it is
// not a timetable. Which one it prints is its own judgement rather than
// something the sun can settle, and this is the app saying so out loud instead
// of quietly showing a number that looks like every other number.

import { CITIES } from './cities';
import type { City } from './cities';
import { sun, solarTableAt } from './astro';
import type { PhaseTable } from './phases';
import { offsetMinutesFor } from './snapshot';

/** One city, and which of its boundaries the sun cannot supply today. */
export interface Unresolved {
	city: City;
	/** Boundary names the solar definition has no answer for, in order. */
	missing: string[];
	/** True when the sun does not set at all — the hardest case. */
	midnightSun: boolean;
	/**
	 * Why this city is here, in one line a reader can check against the sky.
	 *
	 * Listing what is absent ("no Fajr or Isha") reads as a contradiction next to
	 * a printed Fajr time, and never says what went wrong. Naming the shortfall
	 * does both: the sun stopping 12.7° down when Fajr wants 18° is a fact with a
	 * number in it, and it explains the row rather than restating it.
	 */
	why: string;
	/**
	 * True when the published timetable has stopped moving.
	 *
	 * The clearest evidence there is that a rule has run out: Longyearbyen's
	 * boundaries repeat to the minute for sixteen days together, while Oslo's
	 * creep by one or two minutes daily. Diyanet is no longer computing — it is
	 * holding a timetable until the sun comes back.
	 *
	 * A run, not a single repeat. Where the daily change is under half a minute
	 * two days can round to the same clock reading by chance, which Reykjavík
	 * does once in the shipped window and which means nothing.
	 */
	held: boolean;
	/**
	 * How many days running the same times repeat, counting the run today is in.
	 *
	 * The number is the evidence. "The times have stopped moving" is a claim;
	 * "the same 02:34 for sixteen days" is something the reader can check against
	 * any other city in the list.
	 */
	heldDays: number;
	/**
	 * The boundaries the sun still settles here, which are the ones that go on
	 * moving while the frozen ones repeat.
	 *
	 * Named rather than assumed. In summer this is Dhuhr and Asr, and the
	 * contrast is the whole point — but in polar winter the sun never clears the
	 * horizon, so there is no shadow to measure and Asr drops out of it too.
	 */
	moving: string[];
	/** What Diyanet published anyway, as local clock readings. */
	fajr: string;
	isha: string;
}

/** The six boundaries a day's table carries, in the order it stores them. */
const NAMES = ['Fajr', 'Shuruq', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

/** The depth each twilight boundary waits for, below the horizon. */
const DEPTH: Record<string, number> = { Fajr: 18, Isha: 17 };

/**
 * The row's one-line reason, phrased as the shortfall rather than the absence.
 *
 * `low` is how far below the horizon the sun gets at its lowest, and `high` how
 * far above at its highest — the two numbers that decide every case here. The
 * middle case is the interesting one to state numerically: a reader who is told
 * the sun stopped 12.7° down when Fajr wants 18° can look outside and agree.
 */
function reason(missing: string[], low: number, high: number): string {
	if (low > -0.833) {
		return `sun never sets — no ${missing.join(', ').replace(/, ([^,]*)$/, ' or $1')}`;
	}
	if (high < -0.833) {
		return 'sun never rises — no sunrise or sunset all day';
	}
	const needs = missing
		.filter(n => DEPTH[n])
		.map(n => `${n} needs ${DEPTH[n]}°`)
		.join(', ');
	return `sun stops ${Math.abs(low).toFixed(1)}° below the horizon — ${needs}`;
}

export interface RulesBreak {
	rows: Unresolved[];
	/** How many cities are affected in total, before the list is trimmed. */
	total: number;
}

/** An absolute UTC minute as a clock reading in `tz`. */
function localHHMM(minute: number, tz: string, isoDate: string): string {
	const off = offsetMinutesFor(tz, isoDate);
	const v = ((Math.round(minute + off) % 1440) + 1440) % 1440;
	return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
}

/**
 * The cities whose prayer times the sun cannot settle on the given day.
 *
 * Ordered by latitude, because that is the axis the phenomenon runs along and
 * the reader is being shown a frontier rather than a ranking.
 */
export function rulesBreak(phases: PhaseTable | null, nowMs: number, limit = 8): RulesBreak {
	if (!phases) {
		return { rows: [], total: 0 };
	}

	const dayMs = Math.floor(nowMs / 86400000) * 86400000;
	const iso = new Date(dayMs).toISOString().slice(0, 10);
	const { dec } = sun(new Date(dayMs + 12 * 3600000));
	// In degrees as well, for the altitudes the reason line quotes.
	const decDeg = (dec * 180) / Math.PI;
	const minute = Math.floor(dayMs / 60000);

	const rows: Unresolved[] = [];
	for (const city of CITIES) {
		/*
		 * Both ways a definition can fail, not just the summer one.
		 *
		 * In summer the sun never sinks the 18° Fajr asks for. In polar winter it
		 * never rises at all — and there Fajr and Isha are perfectly well defined,
		 * because the noon sun still climbs to about −11° at Longyearbyen and so
		 * crosses −18° twice, while Shuruq and Maghrib are the ones with no
		 * answer. Watching only for the summer failure missed four months of the
		 * year at the latitudes where this matters most.
		 */
		const t = solarTableAt(city.la, dec);
		const missing: string[] = [];
		if (!isFinite(t.fajr)) {
			missing.push('Fajr');
		}
		if (!isFinite(t.rise)) {
			missing.push('Shuruq');
		}
		if (!isFinite(t.set)) {
			missing.push('Maghrib');
		}
		if (!isFinite(t.isha)) {
			missing.push('Isha');
		}
		if (!missing.length) {
			continue;
		}

		const arr = phases.byCity.get(city.ilceID);
		if (!arr || arr.length < phases.perDay) {
			continue;
		}

		/*
		 * The published boundaries for this day, found by stepping through the
		 * table rather than by assuming today is its first row — the window starts
		 * whenever it was built, not whenever the reader arrives.
		 */
		let base = 0;
		while (base + phases.perDay < arr.length && arr[base + phases.perDay] <= minute) {
			base += phases.perDay;
		}

		/*
		 * A boundary that has stopped moving repeats at exactly the same clock
		 * reading tomorrow — so its absolute minute advances by exactly a day.
		 * Three days running is a held timetable; two is a coincidence of rounding.
		 */
		const per = phases.perDay;

		/*
		 * Which boundaries the sun cannot supply — and those are exactly the ones
		 * to watch for freezing.
		 *
		 * Testing Fajr alone called a day held while Isha had quietly moved;
		 * testing all six called nothing held at all, because Dhuhr and Asr never
		 * stop. That second result is the interesting one: Diyanet freezes
		 * precisely what it cannot work out — the four twilight boundaries, which
		 * depend on how far the sun sinks — and goes on computing the two that
		 * still have answers, the meridian and the shadow.
		 */
		const stuck = [t.fajr, t.rise, t.dhuhr, t.asr, t.set, t.isha]
			.map((v, k) => (isFinite(v) ? -1 : k))
			.filter(k => k >= 0);

		const repeats = (i: number) => {
			if (i < 0 || i + per + per - 1 >= arr.length) {
				return false;
			}
			return stuck.every(k => arr[i + per + k] - arr[i + k] === 1440);
		};
		const held = repeats(base) && repeats(base + per);

		// The whole run today sits in, forwards and back — a reader arriving
		// mid-stretch should be told how long it has been, not how long is left.
		let heldDays = 0;
		if (held) {
			heldDays = 1;
			for (let i = base; repeats(i); i += per) {
				heldDays++;
			}
			for (let i = base - per; repeats(i); i -= per) {
				heldDays++;
			}
		}

		rows.push({
			city,
			missing,
			midnightSun: !isFinite(t.set),
			held,
			heldDays,
			why: reason(missing, Math.abs(city.la + decDeg) - 90, 90 - Math.abs(city.la - decDeg)),
			moving: NAMES.filter((_, k) => !stuck.includes(k)),
			fajr: localHHMM(arr[base], city.tz, iso),
			isha: localHHMM(arr[base + 5], city.tz, iso)
		});
	}

	rows.sort((a, b) => Math.abs(b.city.la) - Math.abs(a.city.la));
	return { rows: rows.slice(0, limit), total: rows.length };
}
