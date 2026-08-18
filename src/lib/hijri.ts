// Diyanet's own answer to when the month begins.
//
// The crescent map beside this is geometry: it says where the sky permits a
// sighting. Diyanet publishes something different and equally worth showing —
// the decision itself. Every day in every timetable carries a Hijri date, so
// the day a month turns over is already in the snapshots the app ships, at no
// cost and with no request.
//
// THE ONE THING TO KNOW ABOUT IT
//
// That calendar is global. Checked across the shipped cities from Auckland at
// +175° to Los Angeles at −118°, north and south, the Hijri date against a
// given Gregorian day is identical everywhere — so this is one determination
// applied to the whole world, computed in advance, not a judgement made place
// by place.
//
// Which is why the two belong side by side rather than merged. A month can
// begin on Diyanet's calendar while the crescent is nowhere near visible from
// where you are standing, and that is not a contradiction to be smoothed over:
// it is the actual state of affairs, and a reader deciding when to fast is
// better served seeing both than seeing one dressed as the other.

import type { TimetableDay } from './diyanet';

export interface MonthStart {
	/** The Gregorian date whose daytime carries day 1, as `YYYY-MM-DD`. */
	date: string;
	/** Diyanet's own spelling, e.g. "Ramazan 1448". */
	month: string;
	/** Day 1's instant, midday UTC — for comparing against a crescent evening. */
	ms: number;
}

/** "3 Rebiulevvel 1448" -> { day: 3, month: "Rebiulevvel 1448" } */
function parse(hijri: string): { day: number; month: string } | null {
	const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(hijri ?? '');
	return m ? { day: Number(m[1]), month: m[2] } : null;
}

/**
 * Every month boundary in a timetable, in order.
 *
 * Found by looking for day 1 rather than by comparing month names, because a
 * name repeats a year later and a lunar year is shorter than a Gregorian one —
 * so a 396-day snapshot can carry the same month twice.
 */
export function monthStarts(days: TimetableDay[]): MonthStart[] {
	const out: MonthStart[] = [];
	for (const d of days) {
		const p = parse(d.hijri);
		if (!p || p.day !== 1) continue;
		const date = `${d.y}-${String(d.mo).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
		if (out.some(o => o.date === date)) continue;
		out.push({ date, month: p.month, ms: Date.UTC(d.y, d.mo - 1, d.d, 12) });
	}
	return out;
}

/**
 * The month that begins nearest the given evening, if one does close to it.
 *
 * An Islamic day begins at sunset, so the month whose day 1 falls on the
 * *following* Gregorian date is the one a given evening's crescent would
 * start. Anything further away than a couple of days is a different month and
 * has nothing to say about this evening.
 */
export function startNear(starts: MonthStart[], eveningMs: number, withinDays = 2): MonthStart | null {
	let best: MonthStart | null = null;
	let bestGap = Infinity;
	for (const s of starts) {
		const gap = Math.abs(s.ms - eveningMs) / 86400000;
		if (gap < bestGap) {
			bestGap = gap;
			best = s;
		}
	}
	return best && bestGap <= withinDays ? best : null;
}
