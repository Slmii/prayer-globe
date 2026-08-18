// Which prayer every city is in, from Diyanet rather than from the sun.
//
// The panel has always shown the selected city's real Diyanet times while the
// tally beside it counted all 723 cities with the local solar model, and at high
// latitudes those two disagree: in Amsterdam in August the solar solve puts Isha
// at 23:24 and Diyanet publishes 23:00, so the city sat in the Maghrib segment
// while its own card read Isha. Same for the colour of its dot on the globe.
//
// This closes that. `public/phases.json` carries every city's boundaries for the
// days the scrubber can reach, and `phaseOf` reads the phase straight off them.
//
// The one thing to know about the encoding: boundaries are published in the
// order fajr, sunrise, dhuhr, asr, maghrib, isha — which is exactly PHASES 0 to
// 5 — so the phase is not stored at all. It is the position of the last boundary
// that has passed, modulo six.

/** The published file, as `scripts/build-phases.ts` writes it. */
export interface PhasesFile {
	base: number;
	from: string;
	days: number;
	perDay: number;
	cities: Record<string, number[]>;
}

export interface PhaseTable {
	/** Absolute UTC minutes, ascending, per city. */
	byCity: Map<string, Int32Array>;
	from: string;
	days: number;
	perDay: number;
}

const base = import.meta.env.BASE_URL;

/** Undo the delta encoding into ascending absolute minutes. */
export function decodePhases(file: PhasesFile): PhaseTable {
	const byCity = new Map<string, Int32Array>();
	for (const id of Object.keys(file.cities)) {
		const deltas = file.cities[id];
		const abs = new Int32Array(deltas.length);
		let run = file.base;
		for (let i = 0; i < deltas.length; i++) {
			run += deltas[i];
			abs[i] = run;
		}
		byCity.set(id, abs);
	}
	return { byCity, from: file.from, days: file.days, perDay: file.perDay };
}

export async function loadPhases(): Promise<PhaseTable | null> {
	try {
		const res = await fetch(`${base}phases.json`);
		if (!res.ok) {
			return null;
		}
		const file = (await res.json()) as PhasesFile;
		if (!file?.cities || !file.perDay) {
			return null;
		}
		return decodePhases(file);
	} catch {
		return null;
	}
}

/**
 * The prayer `ilceID` is in at `ms`, or null when this table cannot say.
 *
 * Null is not a failure — it is how a stale deploy degrades. The window is
 * finite, so scrubbing past its end returns null and the caller falls back to
 * the solar model rather than showing a confidently wrong answer.
 */
export function phaseOf(table: PhaseTable, ilceID: string, ms: number): number | null {
	const arr = table.byCity.get(ilceID);
	if (!arr || arr.length === 0) {
		return null;
	}

	const minute = Math.floor(ms / 60000);
	if (minute >= arr[arr.length - 1]) {
		return null;
	}

	if (minute < arr[0]) {
		// The hours before the window's very first fajr are still the previous
		// night's Isha. Further back than that is off the table entirely.
		return minute >= arr[0] - 1440 ? 5 : null;
	}

	return lastBefore(arr, minute) % table.perDay;
}

/**
 * The next prayer boundary for a city, and which prayer it begins.
 *
 * Lets the panel say what is coming next somewhere you are *not* looking —
 * the pinned home city, whose timetable is otherwise never fetched, because
 * only the selected city's is. The whole-world table already holds it.
 */
export function nextBoundary(table: PhaseTable, ilceID: string, ms: number): { phase: number; ms: number } | null {
	const arr = table.byCity.get(ilceID);
	if (!arr || arr.length === 0) {
		return null;
	}

	const minute = Math.floor(ms / 60000);
	if (minute >= arr[arr.length - 1]) {
		return null;
	}
	if (minute < arr[0]) {
		return { phase: 0, ms: arr[0] * 60000 };
	}

	const k = lastBefore(arr, minute) + 1;
	if (k >= arr.length) {
		return null;
	}
	return { phase: k % table.perDay, ms: arr[k] * 60000 };
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

/**
 * The same crossfade `phaseBlend` gives the solar model, from real boundaries.
 *
 * Without it the globe would snap each dot to its new colour the instant a
 * prayer turns over, which as the terminator sweeps reads as a rank of dots
 * clicking over one by one. Returning how far into the approach we are lets the
 * colour be mixed instead. Null when the table cannot answer, so the caller can
 * fall back whole rather than in pieces.
 */
export function blendOf(
	table: PhaseTable,
	ilceID: string,
	ms: number,
	/** Minutes over which the next colour fades in. */
	window = 15
): { phase: number; next: number; t: number } | null {
	const arr = table.byCity.get(ilceID);
	if (!arr || arr.length === 0) {
		return null;
	}

	const minute = Math.floor(ms / 60000);
	if (minute >= arr[arr.length - 1]) {
		return null;
	}
	if (minute < arr[0]) {
		if (minute < arr[0] - 1440) {
			return null;
		}
		const gap = arr[0] - minute;
		// Approaching the window's first fajr out of the previous night's isha.
		return gap > window ? { phase: 5, next: 5, t: 0 } : { phase: 5, next: 0, t: 1 - gap / window };
	}

	const k = lastBefore(arr, minute);
	const phase = k % table.perDay;
	const gap = arr[k + 1] - minute;
	const next = (k + 1) % table.perDay;
	if (gap > window || next === phase) {
		return { phase, next: phase, t: 0 };
	}
	return { phase, next, t: 1 - gap / window };
}
