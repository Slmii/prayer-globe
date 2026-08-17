// Diyanet names cities in a mix of English and Turkish transliteration; the
// dropdown holds "NETHERLANDS" but the state under it is "HOLLANDA", and Mecca
// appears as MECCA, MEKKE or MAKKAH depending on where you look.
//
// normalize() already folds diacritics and the Turkish dotted I for the live
// app, so it is reused here rather than reimplemented.

import { normalize } from '../../src/lib/diyanet.ts';
import type { DiyanetDistrict } from './discover.ts';
import type { GeoCity } from './geonames.ts';

/**
 * Diyanet spellings that Intl.DisplayNames will never produce — mostly Turkish
 * names, plus English variants ICU renders differently ("Czechia" for CZECH
 * REPUBLIC, "Myanmar (Burma)" for MYANMAR).
 *
 * Deliberately absent, because each would double-book an ISO2 already claimed
 * by another Diyanet country, silently dropping one of the pair:
 *   KUDUS (Jerusalem)  — FILISTIN already takes PS
 *   UKRAINE-KRYM       — UKRAINE already takes UA
 * Also absent are the entries that are not countries at all: ATLANTIC OCEAN
 * (10,043 districts of open water) and ASCENSION.
 */
const COUNTRY_OVERRIDES: Record<string, string> = {
	BUTAN: 'BT',
	CAD: 'TD',
	'CZECH REPUBLIC': 'CZ',
	CIBUTI: 'DJ',
	'DEMOKRATIC REPUBLIC OF THE CONGO': 'CD',
	'DOGU TIMOR': 'TL',
	DOMINIK: 'DM',
	'DOMINIK CUMHURIYETI': 'DO',
	EKVATOR: 'EC',
	'EKVATOR GINESI': 'GQ',
	ERITRE: 'ER',
	ESTONYA: 'EE',
	'FILDISI SAHILI': 'CI',
	FILISTIN: 'PS',
	GAMBIYA: 'GM',
	GRONLAND: 'GL',
	GUADELOPE: 'GP',
	'GUAM ISLAND': 'GU',
	'HONG KONG': 'HK',
	IZLANDA: 'IS',
	JAMAIKA: 'JM',
	KAMBOCYA: 'KH',
	KARADAG: 'ME',
	KATAR: 'QA',
	KIRGIZHSTAN: 'KG',
	KOLOMBIYA: 'CO',
	KOMORLAR: 'KM',
	KOSOVA: 'XK',
	KOSTARIKA: 'CR',
	'NORTH CYPRUS': 'CY',
	LESOTO: 'LS',
	LIBERYA: 'LR',
	MADAGASKAR: 'MG',
	MAKAO: 'MO',
	MACEDONIA: 'MK',
	MALAVI: 'MW',
	MALDIVLER: 'MV',
	'MAN ISLAND': 'IM',
	MARTINIK: 'MQ',
	'MAURITIUS ADASI': 'MU',
	MIKRONEZYA: 'FM',
	MOLDAVYA: 'MD',
	'MONTSERRAT UK': 'MS',
	MORITANYA: 'MR',
	MOZAMBIK: 'MZ',
	MYANMAR: 'MM',
	NAMIBYA: 'NA',
	NIJER: 'NE',
	NIKARAGUA: 'NI',
	'ORTA AFRIKA CUMHURIYETI': 'CF',
	'PAPUA YENI GINE': 'PG',
	'PITCAIRN ADASI': 'PN',
	RUANDA: 'RW',
	'SEYSEL ADALARI': 'SC',
	SIRBISTAN: 'RS',
	SURINAM: 'SR',
	SVALBARD: 'SJ',
	TANZANYA: 'TZ',
	'TRINIDAT VE TOBAGO': 'TT',
	TUNUSIA: 'TN',
	UMMAN: 'OM',
	VATIKAN: 'VA',
	'YENI KALEDONYA': 'NC',
	'YESIL BURUN': 'CV',
	ZAMBIYA: 'ZM',
	ZIMBABVE: 'ZW',
	USA: 'US',
	HOLLANDA: 'NL',
	INGILTERE: 'GB',
	ALMANYA: 'DE',
	'S ARABISTAN': 'SA',
	'SUUDI ARABISTAN': 'SA',
	KKTC: 'CY',
	BOLIVYA: 'BO',
	'ANTIGUA VE BARBUDA': 'AG',
	BOSNIAHERZEGOVINA: 'BA',
	BOSNAHERSEK: 'BA',
	MACARISTAN: 'HU',
	YUNANISTAN: 'GR',
	ISVICRE: 'CH',
	ISVEC: 'SE',
	RUSYA: 'RU',
	MISIR: 'EG',
	URDUN: 'JO',
	IRAK: 'IQ',
	IRAN: 'IR',
	CIN: 'CN',
	HINDISTAN: 'IN',
	JAPONYA: 'JP',
	KANADA: 'CA',
	BREZILYA: 'BR',
	ARJANTIN: 'AR',
	'GUNEY AFRIKA': 'ZA',
	'CEK CUMHURIYETI': 'CZ',
	TURKIYE: 'TR'
};

/**
 * Codes ISO has withdrawn or exceptionally reserved, which `Intl.DisplayNames`
 * still resolves to the SAME English name as the code actually in use. Left in,
 * they collide: "France" resolves for both FR and FX, "Russia" for RU and SU,
 * and so on. The collision is silent and worse than a miss — `countryIso2`
 * returns a plausible code that matches nothing in GeoNames, so the country
 * disappears from the output without ever appearing in the unmatched report.
 */
const DEPRECATED_ISO2 = new Set([
	'AN', // Netherlands Antilles  -> CW
	'BU', // Burma                 -> MM
	'CS', // Serbia and Montenegro -> RS
	'DD', // East Germany          -> DE
	'DY', // Dahomey               -> BJ
	'FX', // France, Metropolitan  -> FR
	'HV', // Upper Volta           -> BF
	'NH', // New Hebrides          -> VU
	'RH', // Southern Rhodesia     -> ZW
	'SU', // Soviet Union          -> RU
	'TP', // East Timor            -> TL
	'UK', // reserved for the UK   -> GB
	'VD', // North Vietnam         -> VN
	'YD', // Democratic Yemen      -> YE
	'YU', // Yugoslavia            -> RS
	'ZR' // Zaire                 -> CD
]);

/**
 * ISO2 -> normalised English name, built once from the runtime's own data.
 *
 * With every withdrawn code excluded, each name maps to exactly one live code
 * and iteration order stops mattering. If a future ICU update introduces a new
 * alias, this throws at load rather than silently picking one — the failure
 * mode we are guarding against is a country vanishing from the output while
 * `countryIso2` still returns a plausible-looking code.
 */
const BY_ENGLISH_NAME: Map<string, string> = (() => {
	const display = new Intl.DisplayNames(['en'], { type: 'region' });
	const map = new Map<string, string>();
	const collisions: string[] = [];
	for (let a = 65; a <= 90; a++) {
		for (let b = 65; b <= 90; b++) {
			const iso2 = String.fromCharCode(a, b);
			if (DEPRECATED_ISO2.has(iso2)) continue;
			let name: string | undefined;
			try {
				name = display.of(iso2);
			} catch {
				continue;
			}
			// Unknown codes echo themselves back.
			if (!name || name === iso2) continue;
			const key = normalize(name);
			const existing = map.get(key);
			if (existing) collisions.push(`${name}: ${existing} and ${iso2}`);
			else map.set(key, iso2);
		}
	}
	if (collisions.length) {
		throw new Error(
			`ambiguous ISO2 names, add the withdrawn code to DEPRECATED_ISO2:\n  ${collisions.join('\n  ')}`
		);
	}
	return map;
})();

export function countryIso2(diyanetName: string): string | null {
	const key = normalize(diyanetName);
	return COUNTRY_OVERRIDES[key] ?? BY_ENGLISH_NAME.get(key) ?? null;
}

/**
 * Match one GeoNames city to a district from the *same country's* list. Exact
 * names are tried across every district before alternate names are considered,
 * so "Mecca" prefers a district actually called MECCA over one called MAKKAH.
 */
/**
 * Comparable forms of one name. Diyanet qualifies many districts
 * parenthetically, and the parenthesis carries different information each time:
 *
 *   "SAO PAULO (S.P.)"   the state code is noise — strip it
 *   "BUKRES(bucharest)"  the English name is INSIDE the parens — keep it
 *   "ADAMCLISI "         trailing space, which normalize() does not trim
 *
 * Each of these silently cost us a city, São Paulo (12.4M) among them, so all
 * three forms are generated and any one may match.
 */
const clean = (s: string): string => normalize(s).trim().replace(/\s+/g, ' ');

/** The three readings of a district name, strongest first. */
/**
 * Cached because selection now tests every GeoNames city against every district
 * in its country — Germany alone is ~1,200 × 1,241 — and without this each of
 * those comparisons re-runs three regexes and a Unicode normalisation over the
 * same handful of district names.
 */
const formsCache = new Map<string, { full: string; stripped: string; inner: string }>();

function forms(s: string): { full: string; stripped: string; inner: string } {
	const hit = formsCache.get(s);
	if (hit) return hit;

	const inner = /\(([^)]+)\)/.exec(s);
	const out = {
		full: clean(s),
		stripped: clean(s.replace(/\([^)]*\)/g, ' ')),
		inner: inner ? clean(inner[1]) : ''
	};
	formsCache.set(s, out);
	return out;
}

/**
 * How good a match is, strongest first. The ranking is the whole point: taking
 * the first district that matched on ANY reading bound New York City to
 * MANHATTAN in *Kansas* while NEW YORK sat unused, and Perth to
 * "BAYSWATER (Perth)" while PERTH sat unused — real Diyanet data, for the wrong
 * place, which is worse than no data at all.
 */
const RANK = {
	fullPrimary: 6,
	strippedPrimary: 5,
	innerPrimary: 4,
	fullAlt: 3,
	strippedAlt: 2,
	innerAlt: 1,
	none: 0
};

function commonPrefix(a: string, b: string): number {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	return i;
}

function scoreDistrict(d: DiyanetDistrict, primary: Set<string>, alt: Set<string>): number {
	let best = RANK.none;
	for (const name of [d.nameEn, d.name]) {
		if (!name) continue;
		const f = forms(name);
		if (f.full && primary.has(f.full)) best = Math.max(best, RANK.fullPrimary);
		if (f.stripped && primary.has(f.stripped)) best = Math.max(best, RANK.strippedPrimary);
		if (f.inner && primary.has(f.inner)) best = Math.max(best, RANK.innerPrimary);
		if (f.full && alt.has(f.full)) best = Math.max(best, RANK.fullAlt);
		if (f.stripped && alt.has(f.stripped)) best = Math.max(best, RANK.strippedAlt);
		if (f.inner && alt.has(f.inner)) best = Math.max(best, RANK.innerAlt);
	}
	return best;
}

/**
 * Match one GeoNames city to a district from the *same country's* list — a
 * name-only match sends "Los Angeles" to Los Angeles, Chile.
 *
 * Every district is scored and the strongest wins, rather than the first one
 * that happens to match. Ties are broken by how much of the city's own name the
 * district name shares, which is what separates NEW YORK from MANHATTAN when
 * both appear in New York City's (alphabetically sorted, so otherwise
 * uninformative) alternate names. A tie that survives that is genuinely
 * ambiguous and returns null, so it lands in the unmatched report instead of
 * being guessed at.
 */
export function matchDistrict(city: GeoCity, districts: DiyanetDistrict[]): DiyanetDistrict | null {
	const primary = new Set([clean(city.name), clean(city.ascii)].filter(Boolean));
	const alt = new Set(city.alt.map(clean).filter(Boolean));
	const cityKey = clean(city.ascii) || clean(city.name);

	let winner: DiyanetDistrict | null = null;
	let bestScore = RANK.none;
	let bestPrefix = -1;
	let tied = false;

	for (const d of districts) {
		const score = scoreDistrict(d, primary, alt);
		if (score === RANK.none) continue;

		const prefix = commonPrefix(forms(d.nameEn || d.name).full, cityKey);
		if (score > bestScore || (score === bestScore && prefix > bestPrefix)) {
			winner = d;
			bestScore = score;
			bestPrefix = prefix;
			tied = false;
		} else if (score === bestScore && prefix === bestPrefix) {
			tied = true;
		}
	}

	return tied ? null : winner;
}
