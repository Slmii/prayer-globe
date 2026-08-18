// Encodes what the globe is looking at (city, scrub, panel mode, chain index)
// into the URL hash, and remembers a pinned city across visits.
//
// `main.tsx` routes purely on `hash.startsWith('#/solar')`: that prefix opens
// the solar-system viewer, anything else renders the globe. This module's
// format starts with `PREFIX` ('#/view'), a different literal path segment —
// the two routes are told apart by that first segment, not by any shared
// grammar, so they cannot collide no matter what query string follows. A
// hash this module doesn't recognise (a stale link, `#/solar`, hand-typed
// junk) decodes to `{}` and falls through to the globe's own defaults.
//
// `scrub` is stored as a *relative* offset in minutes, matching the app's own
// clock (see `hooks/util.ts`). That means a shared link with `scrub=1440`
// reads as "look a day ahead of whenever this is opened", not "look at the
// instant I made the link" — the previewed scene shifts with the day the
// link is opened. That is a deliberate choice, not an oversight: encoding an
// absolute instant would make old links freeze on a moment further and
// further in the past.

import { SCRUB_MAX, SCRUB_MIN } from '../hooks/util';
import type { City } from './cities';
import { CITIES } from './cities';

export interface ViewState {
	/** City name as in cities.ts. */
	city: string | null;
	/** Scrub offset in minutes from now, as the app's clock uses. */
	scrub: number;
	/** Panel mode: 'now' | 'chain' | 'records' | 'ramadan' | 'hilal' | 'relay'. */
	mode: string | null;
	/** Which prayer the chain mode is following, 0–5. */
	chain: number | null;
}

const PREFIX = '#/view';
const MODES: readonly string[] = ['now', 'chain', 'records', 'ramadan', 'hilal', 'relay'];
const STORAGE_KEY = 'pg.pinnedCity';

/*
 * Where the reader was last found, and whether they have been asked.
 *
 * Separate from the pins on purpose. A pin is a shortlist the reader chose; home
 * is a fact about them, written by locating and never by hand — which is why it
 * can open the app when a pin deliberately does not.
 */
const HOME_KEY = 'pg.home';
const ASKED_KEY = 'pg.locationAsked';

/** Fields at their defaults are simply omitted, keeping links short. */
export function encodeView(v: ViewState): string {
	const p = new URLSearchParams();
	if (v.city) p.set('city', v.city);
	if (v.scrub) p.set('scrub', String(Math.round(v.scrub)));
	if (v.mode) p.set('mode', v.mode);
	if (v.chain != null) p.set('chain', String(v.chain));
	const qs = p.toString();
	return qs ? `${PREFIX}?${qs}` : PREFIX;
}

/**
 * Reads `location.hash`, which is untrusted — hand-typed, bookmarked from an
 * old version, or just mangled. Every field is validated independently and
 * dropped on its own if it doesn't check out; this never throws, and a hash
 * with no recognisable shape at all just yields `{}`.
 */
export function decodeView(hash: string): Partial<ViewState> {
	const out: Partial<ViewState> = {};
	try {
		if (!hash.startsWith(PREFIX)) {
			return out;
		}
		const q = hash.indexOf('?');
		if (q === -1) {
			return out;
		}
		const p = new URLSearchParams(hash.slice(q + 1));

		const city = p.get('city');
		if (city) out.city = city;

		const scrubRaw = p.get('scrub');
		if (scrubRaw != null) {
			const n = Number(scrubRaw);
			if (Number.isFinite(n) && n >= SCRUB_MIN && n <= SCRUB_MAX) out.scrub = Math.round(n);
		}

		const mode = p.get('mode');
		if (mode && MODES.includes(mode)) out.mode = mode;

		const chainRaw = p.get('chain');
		if (chainRaw != null) {
			const n = Number(chainRaw);
			if (Number.isInteger(n) && n >= 0 && n <= 5) out.chain = n;
		}
	} catch {
		return {};
	}
	return out;
}

/**
 * How many cities may be pinned at once.
 *
 * A shortlist, not a bookmark folder: past a handful the row stops being
 * something you read at a glance, which is the only reason it is on screen.
 */
export const MAX_PINNED = 5;

/**
 * A pin is either a name or a whole city.
 *
 * A shipped city is stored as its name, because the record is already in the
 * bundle and a name is the smallest durable handle to it. A city found by
 * locating — one Diyanet publishes but this app does not ship — has no record to
 * point at, so it stores itself. Without that, pinning your own town wrote a name
 * that resolved to nothing: the pin took one of the five slots and showed
 * nothing at all, before any reload.
 */
export type Pin = string | City;

/** The City a pin refers to, or null if it named one we no longer ship. */
export function resolvePin(pin: Pin): City | null {
	if (typeof pin !== 'string') {
		return pin;
	}
	return CITIES.find(c => c.n === pin) ?? null;
}

export const pinName = (pin: Pin): string => (typeof pin === 'string' ? pin : pin.n);

/** Enough of a city to be one: anything less cannot be restored. */
function isCity(v: unknown): v is City {
	const c = v as City;
	return (
		!!c &&
		typeof c === 'object' &&
		typeof c.n === 'string' &&
		typeof c.la === 'number' &&
		typeof c.lo === 'number' &&
		typeof c.ilceID === 'string'
	);
}

/**
 * The pinned cities, oldest first.
 *
 * Degrades to an empty list whenever storage is unavailable or throws (Safari
 * private mode, policy), and reads both the single-name value and the plain
 * array of names written by earlier versions, so nobody loses a pin.
 */
export function loadPinned(): Pin[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return [];
		}
		if (!raw.startsWith('[')) {
			return [raw];
		}
		const list: unknown = JSON.parse(raw);
		if (!Array.isArray(list)) {
			return [];
		}
		return list.filter((p): p is Pin => (typeof p === 'string' && !!p) || isCity(p)).slice(0, MAX_PINNED);
	} catch {
		return [];
	}
}

/**
 * The city the reader was last located to.
 *
 * Stored whole rather than by name: a located district is usually not one of the
 * 891 shipped cities, so a name would resolve to nothing on the next visit —
 * which is the same reason a pin may hold a whole city.
 */
export function loadHome(): City | null {
	try {
		const raw = localStorage.getItem(HOME_KEY);
		if (!raw) {
			return null;
		}
		const v: unknown = JSON.parse(raw);
		return isCity(v) ? v : null;
	} catch {
		return null;
	}
}

export function saveHome(city: City | null): void {
	try {
		if (city) {
			localStorage.setItem(HOME_KEY, JSON.stringify(city));
		} else {
			localStorage.removeItem(HOME_KEY);
		}
	} catch {
		// Storage unavailable — the app just opens on the globe next time.
	}
}

/**
 * Whether the reader has already been offered the location prompt.
 *
 * The browser's own permission dialog can only be spent once — a refusal is
 * remembered by the origin and cannot be asked again — so the offer in front of
 * it is only made once too. The toolbar button stays either way.
 */
export function locationAsked(): boolean {
	try {
		return localStorage.getItem(ASKED_KEY) === '1';
	} catch {
		return false;
	}
}

export function markLocationAsked(): void {
	try {
		localStorage.setItem(ASKED_KEY, '1');
	} catch {
		// Not remembering means the offer is made again, which is survivable.
	}
}

export function savePinned(pins: Pin[]): void {
	try {
		if (pins.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(pins.slice(0, MAX_PINNED)));
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Storage unavailable — pinning just won't persist this session.
	}
}
