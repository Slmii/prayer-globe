// Major mosques that get a 3D model on the globe in place of a city dot.
//
// The model *replaces* that city's dot, so its position is taken from the city
// rather than from the mosque's own coordinates — otherwise the building floats
// away from the dot it stands for. That constraint also means each entry has to
// name a mosque genuinely in that city: an earlier version paired Dubai with
// Sheikh Zayed (Abu Dhabi, ~100 km away) and Tunis with Kairouan (~130 km).

import { CITIES } from './cities';
import type { DesignMosqueKey } from './mosques-model';

/**
 * Which 3D model stands for a site.
 *
 * Every site now names its own building. Most used to share the generic mosque —
 * one shape that read as "a mosque" at marker size — which was the right trade
 * while there were thirteen models for twenty-six places, and stopped being one
 * the moment the other thirteen were built. A globe of identical domes says
 * nothing about where you are looking; Djenné in mud and Xi'an in timber do.
 *
 * `'mosque'` stays as the fallback for a site added without a model, but nothing
 * uses it, so it is no longer built (see `mosqueLayer`).
 */
export type MosqueModel = 'mosque' | 'kaaba' | 'nabawi' | DesignMosqueKey;

/** Mosque name paired with the city whose dot it replaces. */
const PAIRS: { name: string; city: string; model?: MosqueModel }[] = [
	{ name: 'Masjid al-Haram', city: 'Makkah', model: 'kaaba' },
	{ name: 'Al-Masjid an-Nabawi', city: 'Madinah', model: 'nabawi' },
	{ name: 'Al-Aqsa', city: 'Jerusalem', model: 'al-aqsa' },
	{ name: 'Sultan Ahmed (Blue Mosque)', city: 'Istanbul', model: 'sultan-ahmed' },
	{ name: 'Sheikh Zayed Grand Mosque', city: 'Abu Dhabi', model: 'sheikh-zayed' },
	{ name: 'Great Mosque of Kairouan', city: 'Kairouan', model: 'kairouan' },
	{ name: 'Jumeirah Mosque', city: 'Dubai', model: 'jumeirah' },
	{ name: 'Hassan II Mosque', city: 'Casablanca', model: 'hassan-ii' },
	{ name: 'Faisal Mosque', city: 'Islamabad', model: 'faisal' },
	{ name: 'Badshahi Mosque', city: 'Lahore', model: 'badshahi' },
	{ name: 'Istiqlal Mosque', city: 'Jakarta', model: 'istiqlal' },
	{ name: 'Imam Reza Shrine', city: 'Mashhad', model: 'imam-reza' },
	{ name: 'Shah (Imam) Mosque', city: 'Isfahan', model: 'shah' },
	{ name: 'Zaytuna Mosque', city: 'Tunis', model: 'zaytuna' },
	{ name: 'Al-Azhar Mosque', city: 'Cairo', model: 'al-azhar' },
	{ name: 'Bamako Grand Mosque', city: 'Bamako', model: 'bamako' },
	{ name: 'Masjid Negara', city: 'Kuala Lumpur', model: 'masjid-negara' },
	{ name: 'Jama Masjid', city: 'Delhi', model: 'jama-masjid' },
	{ name: 'Bibi-Khanym', city: 'Samarkand', model: 'bibi-khanym' },
	{ name: 'Kul Sharif', city: 'Kazan', model: 'kul-sharif' },
	{ name: 'Gazi Husrev-beg', city: 'Sarajevo', model: 'gazi-husrev-beg' },
	{ name: 'Lagos Central Mosque', city: 'Lagos', model: 'lagos-central' },
	{ name: 'Imam Muhammad ibn Abd al-Wahhab Mosque', city: 'Doha', model: 'doha-grand' },
	{ name: 'Great Mosque of Damascus', city: 'Damascus', model: 'damascus' },
	{ name: 'Great Mosque of Samarra', city: "Samarra'", model: 'samarra' },
	{ name: "Great Mosque of Xi'an", city: "Xi'an", model: 'xian' }
];

export interface Mosque {
	name: string;
	/** For a city-anchored mosque, City.n in cities.ts. Otherwise its own name. */
	city: string;
	lat: number;
	lon: number;
	model: MosqueModel;
	/**
	 * Where the position came from.
	 *
	 * `city` — it stands on a city's dot and hides it, so the two can never drift
	 * apart. `point` — the app ships no city there, so it carries its own
	 * coordinates and hides nothing. Tests need the distinction: "every mosque
	 * resolves to a city" is exactly the guard that caught two mosques being
	 * silently dropped, and it still has to hold for everything anchored that way.
	 */
	anchored: 'city' | 'point';
}

/**
 * Mosques that stand on their own coordinates rather than on a city's dot.
 *
 * The rule above — take the position from the city, so the building cannot drift
 * away from the dot it replaces — only works when the app ships that city. Both
 * of these are in towns it does not: Diyanet publishes only four Mali districts
 * (Bamako, Gao, Ségou, Tombouctou), and none is within ~230 km of Djenné, while
 * Aya Sofya shares Istanbul's single district with the Blue Mosque, which
 * already holds that dot.
 *
 * So they are placed directly, and no dot is hidden for them. The coordinates
 * are each building's own, to about the width of its courtyard — enough for a
 * marker on a globe, not a survey.
 */
const PLACED: { name: string; at: [number, number]; model: MosqueModel }[] = [
	{ name: 'Aya Sofya (Hagia Sophia)', at: [41.0086, 28.98], model: 'hagia-sophia' },
	{ name: 'Great Mosque of Djenné', at: [13.9054, -4.5551], model: 'djenne' }
];

const ANCHORED: Mosque[] = PAIRS.flatMap(({ name, city, model }) => {
	const c = CITIES.find(x => x.n === city);
	// A typo in `city` would otherwise place a mosque at 0°,0° in the Atlantic.
	if (!c) {
		console.warn(`[mosques] unknown city "${city}" for ${name}`);
		return [];
	}
	return [{ name, city, lat: c.la, lon: c.lo, model: model ?? 'mosque', anchored: 'city' as const }];
});

export const MOSQUES: Mosque[] = [
	...ANCHORED,
	// `city` is the town's name here rather than a key into CITIES, which is
	// exactly why these hide no dot: nothing in the list matches it.
	...PLACED.map(
		({ name, at, model }): Mosque => ({
			name,
			city: name,
			lat: at[0],
			lon: at[1],
			model,
			anchored: 'point'
		})
	)
];
