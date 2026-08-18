// Client for the Diyanet (ezanvakti) prayer-times API, and the parsing shared
// with the snapshot.
//
// Only one endpoint is left. This used to walk country -> province -> district
// to discover a city's ilceID, but every city now ships with one, so that chain
// was unreachable code against a rate-limited endpoint and has been removed.
// `/vakitler/{ilceID}` survives as the fallback for a snapshot file that 404s —
// mid-deploy, say — which is a case that really does happen.
//
// The API sends CORS `*` and `cache-control: max-age=432000`, so the browser can
// call it directly — no proxy needed.

import type { PrayerKey } from './astro';

const BASE = 'https://ezanvakti.emushaf.net';

/** One day as the API returns it. Only the fields we consume are declared. */
export interface VakitRow {
	Imsak: string;
	Gunes: string;
	Ogle: string;
	Ikindi: string;
	Aksam: string;
	Yatsi: string;
	KibleSaati?: string;
	HicriTarihUzun?: string;
	HicriTarihKisa?: string;
	MiladiTarihUzun?: string;
	MiladiTarihKisa?: string;
	MiladiTarihKisaIso8601?: string;
	MiladiTarihUzunIso8601?: string;
}

/** Fold Turkish + Latin diacritics so 'KÖLN' and 'KOLN' compare equal. */
export function normalize(s: unknown): string {
	return String(s ?? '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[ıİI]/g, 'I')
		.replace(/[^A-Za-z0-9 ]/g, '')
		.trim()
		.toUpperCase();
}

/** Carries the status so callers can tell a 429 from a real failure. */
export class HttpError extends Error {
	status: number;
	constructor(status: number, path: string) {
		super(`ezanvakti ${path} → HTTP ${status}`);
		this.name = 'HttpError';
		this.status = status;
	}
}

async function get<T>(path: string): Promise<T> {
	const res = await fetch(BASE + path);
	if (!res.ok) throw new HttpError(res.status, path);
	return (await res.json()) as T;
}

export const getTimetable = (ilceID: string) => get<VakitRow[]>(`/vakitler/${ilceID}`);

/** Best match for any of `candidates` among `list`, checking every name field. */
export interface ResolvedDistrict {
	ilceID: string;
	districtName: string;
	provinceName: string;
}

const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})T.*?([+-])(\d{2}):(\d{2})$/;
const DATE_SHORT = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const HHMM = /^(\d{1,2}):(\d{2})$/;

export interface TimetableDay {
	y: number;
	mo: number;
	d: number;
	/** Minutes east of UTC for this date at this district. */
	offsetMin: number;
	hijri: string;
	gregorian: string;
	qiblaHour: string | null;
	/** Wall-clock strings exactly as Diyanet published them. */
	local: Record<PrayerKey, string>;
	/** Absolute instants, ms since epoch. */
	utc: Record<PrayerKey, number | null>;
}

interface RawDay extends Omit<TimetableDay, 'offsetMin' | 'utc'> {
	offsetMin: number | null;
	parsed: Record<PrayerKey, { h: number; m: number } | null>;
}

/**
 * Diyanet returns local wall-clock strings; the globe runs on UTC, so we need
 * each day's real UTC offset. `MiladiTarihUzunIso8601` carries it ("...+01:00"
 * for London, "...+03:00" for Ankara). The sibling `GreenwichOrtalamaZamani`
 * field reports 3 for *both* of those — it is not the offset and is ignored.
 */
function parseDay(row: VakitRow): RawDay | null {
	const long = row.MiladiTarihUzunIso8601 || '';
	let y: number;
	let mo: number;
	let d: number;
	let offsetMin: number | null = null;

	const iso = DATE_ISO.exec(long);
	if (iso) {
		y = +iso[1];
		mo = +iso[2];
		d = +iso[3];
		offsetMin = (iso[4] === '-' ? -1 : 1) * (+iso[5] * 60 + +iso[6]);
	} else {
		const short = DATE_SHORT.exec(row.MiladiTarihKisaIso8601 || row.MiladiTarihKisa || '');
		if (!short) {
			return null;
		}
		d = +short[1];
		mo = +short[2];
		y = +short[3];
	}

	const at = (hhmm: string | undefined) => {
		const m = HHMM.exec(String(hhmm ?? '').trim());
		return m ? { h: +m[1], m: +m[2] } : null;
	};

	return {
		y,
		mo,
		d,
		offsetMin,
		hijri: row.HicriTarihUzun || row.HicriTarihKisa || '',
		gregorian: row.MiladiTarihUzun || '',
		qiblaHour: row.KibleSaati || null,
		local: {
			fajr: row.Imsak,
			rise: row.Gunes,
			dhuhr: row.Ogle,
			asr: row.Ikindi,
			set: row.Aksam,
			isha: row.Yatsi
		},
		parsed: {
			fajr: at(row.Imsak),
			rise: at(row.Gunes),
			dhuhr: at(row.Ogle),
			asr: at(row.Ikindi),
			set: at(row.Aksam),
			isha: at(row.Yatsi)
		}
	};
}

/**
 * Normalise a /vakitler payload into days with absolute UTC instants per prayer.
 * `fallbackOffsetMin` is used only when the API omitted zone information.
 */
export function buildTimetable(rows: VakitRow[] | undefined, fallbackOffsetMin: number): TimetableDay[] {
	const days: TimetableDay[] = [];
	for (const row of rows ?? []) {
		const raw = parseDay(row);
		if (!raw) continue;
		const off = raw.offsetMin ?? fallbackOffsetMin;
		const utc = {} as Record<PrayerKey, number | null>;
		for (const key of Object.keys(raw.parsed) as PrayerKey[]) {
			const hm = raw.parsed[key];
			utc[key] = hm == null ? null : Date.UTC(raw.y, raw.mo - 1, raw.d, hm.h, hm.m) - off * 60000;
		}
		days.push({
			y: raw.y,
			mo: raw.mo,
			d: raw.d,
			offsetMin: off,
			hijri: raw.hijri,
			gregorian: raw.gregorian,
			qiblaHour: raw.qiblaHour,
			local: raw.local,
			utc
		});
	}
	days.sort((a, b) => (a.utc.dhuhr ?? 0) - (b.utc.dhuhr ?? 0));
	return days;
}

// Order of prayer boundaries within a day, matched to PHASES indices.
const SEQUENCE: [PrayerKey, number][] = [
	['fajr', 0],
	['rise', 1],
	['dhuhr', 2],
	['asr', 3],
	['set', 4],
	['isha', 5]
];

export interface Boundary {
	t: number;
	key: PrayerKey;
	phase: number;
	day: TimetableDay;
}

/**
 * Flatten the timetable into one ascending list of boundary instants, so "which
 * prayer is it now" and "how long to the next" work across midnight and across
 * the ±12h scrubber without special cases.
 */
export function boundaries(days: TimetableDay[]): Boundary[] {
	const out: Boundary[] = [];
	for (const day of days) {
		for (const [key, phase] of SEQUENCE) {
			const t = day.utc[key];
			if (t != null) out.push({ t, key, phase, day });
		}
	}
	return out.sort((a, b) => a.t - b.t);
}

export interface Lookup {
	phase: number;
	day: TimetableDay;
	next: { key: PrayerKey; phase: number; t: number };
	msToNext: number;
}

/** Current phase + next boundary at instant `ms`, from real Diyanet data. */
export function lookup(days: TimetableDay[], ms: number): Lookup | null {
	const list = boundaries(days);
	if (!list.length) {
		return null;
	}
	let i = -1;
	for (let k = 0; k < list.length; k++) {
		if (list[k].t <= ms) i = k;
		else break;
	}
	// Outside the window the API covers — caller falls back to local math.
	if (i < 0 || i >= list.length - 1) {
		return null;
	}
	const current = list[i];
	const next = list[i + 1];
	return {
		phase: current.phase,
		day: current.day,
		next: { key: next.key, phase: next.phase, t: next.t },
		msToNext: next.t - ms
	};
}

/**
 * The day record for the city's *local calendar date* at instant `ms`.
 *
 * Nearest-dhuhr matching is tempting and wrong: just after local midnight the
 * previous day's noon is still the closer one, so a city at 01:07 would be shown
 * yesterday's timetable. Prayer tables are read by local date, so resolve the
 * date in the district's own offset instead.
 */
export function dayFor(days: TimetableDay[], ms: number): TimetableDay | null {
	if (!days.length) {
		return null;
	}
	const dateAt = (offsetMin: number) => {
		const d = new Date(ms + offsetMin * 60000);
		return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() };
	};
	const find = (t: { y: number; mo: number; d: number }) =>
		days.find(x => x.y === t.y && x.mo === t.mo && x.d === t.d) ?? null;

	// Probe with any day's offset, then re-check using the matched day's own
	// offset so a DST changeover inside the window still lands on the right date.
	const first = find(dateAt(days[0].offsetMin));
	if (!first) {
		return null;
	}
	const refined = dateAt(first.offsetMin);
	if (refined.y !== first.y || refined.mo !== first.mo || refined.d !== first.d) {
		return find(refined) ?? first;
	}
	return first;
}
