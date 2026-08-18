// Turns a Diyanet timetable into a month-view of the fast: one bar per day,
// imsak → maghrib, laid on a shared 24h track so the month's drift shows up
// as a shape (bars sliding earlier/later, tapering as day length changes)
// instead of a column of numbers.

import type { TimetableDay } from './diyanet';
import { dayFor, normalize } from './diyanet';

export interface RamadanDay {
	/** Day number within the hijri month, 1-based. */
	n: number;
	/** Fraction of the 24h track where the bar starts and how wide it is, 0–1. */
	left: number;
	width: number;
	imsak: string; // 'HH:MM', as published
	maghrib: string;
	/** True for the day containing `nowMs` in this city. */
	today: boolean;
}

export interface RamadanMonth {
	/** Hijri month name as Diyanet spells it, e.g. 'Ramazan'. */
	month: string;
	/** e.g. 'Ramazan 1448'. */
	title: string;
	/** e.g. 'day 12 of 30' — or how far off it is when not in the month. */
	sub: string;
	days: RamadanDay[];
	/** Index into `days` of today, or -1. */
	todayIndex: number;
	/** Progress through today's fast, 0–1. 0 before imsak, 1 after maghrib. */
	pct: number;
	imsak: string;
	maghrib: string;
	/** Whether `nowMs` actually falls inside the returned month. */
	current: boolean;
}

/** `'3 Rebiulevvel 1448'` → its parts, or null if the shape is not what we expect. */
function parseHijri(hijri: string): { day: number; month: string; year: number } | null {
	const parts = hijri.trim().split(/\s+/);
	if (parts.length !== 3) {
		return null;
	}
	const day = Number(parts[0]);
	const year = Number(parts[2]);
	if (!Number.isInteger(day) || day < 1 || day > 30) {
		return null;
	}
	if (!Number.isFinite(year) || year < 1) {
		return null;
	}
	return { day, month: parts[1], year };
}

const sameDate = (a: TimetableDay, b: TimetableDay) => a.y === b.y && a.mo === b.mo && a.d === b.d;

/** 'HH:MM' → fraction of a day, or null for anything that doesn't parse as a clock. */
function clockFrac(hhmm: string): number | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
	if (!m) {
		return null;
	}
	const h = +m[1];
	const mi = +m[2];
	if (h > 23 || mi > 59) {
		return null;
	}
	return (h + mi / 60) / 24;
}

interface Group {
	rawMonth: string;
	year: number;
	entries: { day: TimetableDay; n: number }[];
}

const RAMAZAN = normalize('Ramazan');
const DAY_MS = 86400000;

/**
 * One hijri month, ready to render as a track of bars.
 *
 * Ramadan is the whole point of the view, so it wins whenever the timetable
 * has one — even if `nowMs` is currently in some other month, a fetched
 * window that spans into (or out of) Ramadan should show it. But the
 * timetable is only ~32 days, and most of the year it does not contain a
 * Ramazan at all; without a fallback the panel would just be blank outside
 * that one month, so absent a Ramazan we show whichever hijri month
 * `nowMs` actually falls in instead, and say so via `current`.
 */
export function ramadanMonth(days: TimetableDay[], nowMs: number): RamadanMonth | null {
	const groups = new Map<string, Group>();
	for (const day of days) {
		const parsed = parseHijri(day.hijri);
		if (!parsed) continue;
		const key = normalize(parsed.month) + '_' + parsed.year;
		let g = groups.get(key);
		if (!g) {
			g = { rawMonth: parsed.month, year: parsed.year, entries: [] };
			groups.set(key, g);
		}
		g.entries.push({ day, n: parsed.day });
	}
	if (!groups.size) {
		return null;
	}

	const todayDay = dayFor(days, nowMs);
	const contains = (g: Group) => (todayDay ? g.entries.some(e => sameDate(e.day, todayDay)) : false);

	const all = [...groups.values()];
	const ramazanGroups = all.filter(g => normalize(g.rawMonth) === RAMAZAN);
	const target = ramazanGroups.length
		? (ramazanGroups.find(contains) ?? ramazanGroups[0])
		: (all.find(contains) ?? all[0]);

	const entries = [...target.entries].sort((a, b) => a.n - b.n);
	const out: RamadanDay[] = [];
	for (const { day, n } of entries) {
		const imsakFrac = clockFrac(day.local.fajr);
		const maghribFrac = clockFrac(day.local.set);
		// Either time failed to parse — skip rather than draw a garbage bar.
		if (imsakFrac == null || maghribFrac == null) continue;

		let width = maghribFrac - imsakFrac;
		// At extreme latitude a fast can run past local midnight; a negative span
		// here would draw the bar starting after it ends (inside-out), so clamp
		// it to the end of the local day instead of letting it wrap around.
		if (width < 0) width = 1 - imsakFrac;
		width = Math.min(Math.max(width, 0), 1 - imsakFrac);

		out.push({
			n,
			left: imsakFrac,
			width,
			imsak: day.local.fajr,
			maghrib: day.local.set,
			today: todayDay != null && sameDate(day, todayDay)
		});
	}

	const todayIndex = out.findIndex(d => d.today);
	const current = todayIndex !== -1;

	let pct = 0;
	let imsak = out[0]?.imsak ?? '';
	let maghrib = out[0]?.maghrib ?? '';
	if (todayIndex !== -1) {
		const todayEntry = entries.find(e => sameDate(e.day, todayDay!))!;
		imsak = todayEntry.day.local.fajr;
		maghrib = todayEntry.day.local.set;
		const startMs = todayEntry.day.utc.fajr;
		const endMs = todayEntry.day.utc.set;
		if (startMs != null && endMs != null) {
			if (nowMs <= startMs) pct = 0;
			else if (nowMs >= endMs) pct = 1;
			else pct = (nowMs - startMs) / (endMs - startMs);
		}
	}

	let sub: string;
	if (current) {
		sub = `day ${out[todayIndex].n} of ${out.length}`;
	} else if (entries.length) {
		const first = entries[0].day;
		const last = entries[entries.length - 1].day;
		const startMs = first.utc.fajr ?? Date.UTC(first.y, first.mo - 1, first.d);
		const endMs = last.utc.set ?? Date.UTC(last.y, last.mo - 1, last.d);
		if (nowMs < startMs) {
			const n = Math.max(1, Math.round((startMs - nowMs) / DAY_MS));
			sub = `starts in ${n} day${n === 1 ? '' : 's'}`;
		} else if (nowMs > endMs) {
			const n = Math.max(1, Math.round((nowMs - endMs) / DAY_MS));
			sub = `ended ${n} day${n === 1 ? '' : 's'} ago`;
		} else {
			// In range, but the day matching nowMs didn't survive parsing above.
			sub = `day ? of ${out.length}`;
		}
	} else {
		sub = '';
	}

	return {
		month: target.rawMonth,
		title: `${target.rawMonth} ${target.year}`,
		sub,
		days: out,
		todayIndex,
		pct,
		imsak,
		maghrib,
		current
	};
}
