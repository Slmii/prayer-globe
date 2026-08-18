// Turning a pair of coordinates into a Diyanet district, live.
//
// The app ships 889 cities — a capital plus the largest few per country — and
// most people do not live in one of them. Diyanet covers far more than we ship:
// 282 districts in the Netherlands alone, Emmen among them. So rather than widen
// the dataset for one reader, the district is discovered when it is asked for
// and kept only for the session. Nothing is written; reload and it is gone.
//
// Three hops, all from the browser:
//
//   1. the coordinates become a place name, from OpenStreetMap's Nominatim
//   2. the name becomes an IlceID, by walking Diyanet's own country → province →
//      district lists — the same chain `discover.ts` walks offline to build the
//      shipped dataset
//   3. from there the ordinary path takes over: `usePrayerTimes` reads the
//      district exactly as it does for a shipped city, snapshot first and the
//      live `/vakitler/{id}` behind it
//
// Every endpoint involved sends `access-control-allow-origin: *`, which is why
// this can be done from the page at all and why no proxy is needed. It is a
// handful of requests behind a button someone presses on purpose, so the lists
// are cached for the session and never prefetched.

import type { QueryClient } from '@tanstack/react-query';
import type { City } from './cities';
import { CITIES } from './cities';
import { normalize } from './diyanet';

const EZAN = 'https://ezanvakti.emushaf.net';
const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';

interface UlkeRow {
	UlkeAdi: string;
	UlkeAdiEn: string;
	UlkeID: string;
}
interface SehirRow {
	SehirAdi: string;
	SehirAdiEn: string;
	SehirID: string;
}
interface IlceRow {
	IlceAdi: string;
	IlceAdiEn: string;
	IlceID: string;
}

async function json<T>(url: string): Promise<T> {
	const res = await fetch(url, { headers: { Accept: 'application/json' } });
	if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
	return (await res.json()) as T;
}

/**
 * Every lookup here goes through React Query, like the timetables they lead to.
 *
 * This started as two hand-rolled `Map`s, which worked but sat outside the cache
 * the rest of the app can see: no deduplication if two presses overlap, no
 * eviction, and nothing in the devtools. `fetchQuery` is the imperative door
 * into the same store — it returns what is cached when it is fresh and fetches
 * when it is not, which is exactly the shape of a button someone presses.
 *
 * The lists are immutable, so they never go stale. The reverse geocode is keyed
 * on the coordinates rounded to about a kilometre: press the button twice from
 * the same place and the second press asks nobody anything.
 */
const forever = { staleTime: Infinity, gcTime: Infinity };

const listQuery = <T>(qc: QueryClient, key: unknown[], url: string) =>
	qc.fetchQuery<T>({ queryKey: key, queryFn: () => json<T>(url), ...forever });

/** What the reverse geocoder could tell us about a point. */
interface Place {
	/** Best guess at the settlement, most specific first. */
	names: string[];
	iso2: string;
	country: string;
}

async function reverse(qc: QueryClient, lat: number, lon: number): Promise<Place | null> {
	// zoom=10 asks for the town rather than the street: we want the name Diyanet
	// would publish a timetable under, not the address the reader is standing at.
	const url = `${NOMINATIM}?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}`;
	const d = await qc.fetchQuery<{
		name?: string;
		address?: Record<string, string>;
	}>({
		// Two decimals is roughly a kilometre — far finer than the district this
		// resolves to, and coarse enough that standing still is a cache hit.
		queryKey: ['geo-reverse', lat.toFixed(2), lon.toFixed(2)],
		queryFn: () => json(url),
		...forever
	});
	const a = d.address ?? {};
	const names = [a.city, a.town, a.village, a.municipality, d.name, a.county].filter((n): n is string => !!n);
	if (!names.length || !a.country_code) {
		return null;
	}
	return { names, iso2: a.country_code.toUpperCase(), country: a.country ?? '' };
}

/**
 * Diyanet's id for a country, found by name.
 *
 * The bridge is the shipped city list: it already pairs an ISO2 code with the
 * country name Diyanet itself uses, so no new table is needed to get from `nl`
 * to `HOLLANDA`. Falls back to whatever the geocoder called the country, for the
 * countries we ship no city for.
 */
async function countryId(qc: QueryClient, place: Place): Promise<string | null> {
	const rows = await listQuery<UlkeRow[]>(qc, ['diyanet-countries'], `${EZAN}/ulkeler`);
	const shipped = CITIES.find(c => c.iso2 === place.iso2);
	const wanted = [shipped?.country, shipped?.p, place.country].filter(Boolean).map(normalize);
	const hit = rows.find(r => wanted.includes(normalize(r.UlkeAdiEn)) || wanted.includes(normalize(r.UlkeAdi)));
	return hit?.UlkeID ?? null;
}

/** The best district match in one province, or null. */
function pick(rows: IlceRow[], names: string[]): IlceRow | null {
	const wanted = names.map(normalize).filter(Boolean);
	for (const want of wanted) {
		const exact = rows.find(r => normalize(r.IlceAdiEn) === want || normalize(r.IlceAdi) === want);
		if (exact) {
			return exact;
		}
	}
	// Diyanet qualifies some names — "BEEK (Maastricht)", "HENGELO (overijssel)" —
	// so a district that starts with the town's name is still that town.
	for (const want of wanted) {
		const near = rows.find(r => normalize(r.IlceAdiEn).startsWith(want) || normalize(r.IlceAdi).startsWith(want));
		if (near) {
			return near;
		}
	}
	return null;
}

/**
 * "EMMEN" -> "Emmen". Only a name that is entirely uppercase is touched.
 *
 * Diyanet publishes its district and province names in capitals. A name that
 * already carries a lowercase letter has been cased by someone, so it is left
 * exactly as it is rather than re-cased into something worse.
 *
 * `İ` is mapped before lowercasing rather than left to `toLowerCase`, which
 * turns it into `i` plus a combining dot — so İZMİR came back as "İzmi̇r". The
 * first letter of each word is never lowercased at all, which is what keeps the
 * dotted capital intact where Turkish wants one.
 *
 * Anything that is not a letter separates words, so both halves of a hyphenated
 * name are capitalised rather than only the first.
 */
export function titleCase(s: string): string {
	if (/\p{Ll}/u.test(s)) {
		return s;
	}
	return s.replace(/\p{L}[\p{L}\p{M}]*/gu, w => w[0] + w.slice(1).replace(/İ/g, 'i').toLowerCase());
}

export interface Located {
	/** A City the rest of the app can use, marked as not from the dataset. */
	city: City;
	/** True when the district turned out to be one we already ship. */
	shipped: boolean;
}

/**
 * The Diyanet district covering a point, as a City the app can select.
 *
 * Returns null when the point cannot be named, the country is not one Diyanet
 * publishes, or no district matches — all of which are ordinary outcomes over an
 * ocean or in a country it does not cover, and none of which are errors.
 */
export async function locateDistrict(qc: QueryClient, lat: number, lon: number): Promise<Located | null> {
	const place = await reverse(qc, lat, lon);
	if (!place) {
		return null;
	}

	const ulke = await countryId(qc, place);
	if (!ulke) {
		return null;
	}

	const provinces = await listQuery<SehirRow[]>(qc, ['diyanet-provinces', ulke], `${EZAN}/sehirler/${ulke}`);
	for (const province of provinces) {
		const districts = await listQuery<IlceRow[]>(
			qc,
			['diyanet-districts', province.SehirID],
			`${EZAN}/ilceler/${province.SehirID}`
		);
		const hit = pick(districts, place.names);
		if (!hit) continue;

		// Already in the dataset: hand back the real city, so it keeps its
		// population, timezone and its dot on the globe.
		const shipped = CITIES.find(c => c.ilceID === hit.IlceID);
		if (shipped) {
			return { city: shipped, shipped: true };
		}

		return {
			shipped: false,
			city: {
				// Cased, because Diyanet shouts. Everything else on the globe is named
				// from GeoNames, which is already cased, so a located city was the one
				// place the reader's own town appeared as EMMEN — in the card, in the
				// label over its dot, and in the line under the pointer.
				n: titleCase(hit.IlceAdiEn || hit.IlceAdi),
				la: lat,
				lo: lon,
				// Unknown, and not needed: every clock in the app is driven by the
				// offset Diyanet publishes with the times themselves.
				tz: '',
				iso2: place.iso2,
				country: place.country,
				pop: 0,
				ilceID: hit.IlceID,
				ilceUrl: '',
				p: titleCase(province.SehirAdiEn || province.SehirAdi),
				d: [hit.IlceAdiEn || hit.IlceAdi]
			}
		};
	}
	return null;
}
