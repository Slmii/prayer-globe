// Plates for the two buildings the design's model set does not cover.
//
// `DESIGN_MOSQUES` already carries a name, city, era and note for its
// twenty-six, which is exactly what the viewer's plate shows — so those are read
// straight from it rather than copied here, and there is no second list to keep
// in step. Makkah and Madinah are the exception: they are drawn from this app's
// own `kaaba-model` and `nabawi-model`, built before the design set existed and
// kept because nobody looking for the Kaaba would accept a stand-in. They have
// no entry there, so they get one here.
//
// Deliberately free of three.js. The popover on the globe reads from this file,
// and the globe must not pull the whole model library into its critical path
// just to draw a card with a name on it.

import type { MosqueModel } from './mosques';

/** What the viewer says about a building, under the building. */
export interface Plate {
	name: string;
	city: string;
	era: string;
	note: string;
}

export const EXTRA_PLATES: Partial<Record<MosqueModel, Plate>> = {
	kaaba: {
		name: 'Masjid al-Haram',
		city: 'Makkah, Saudi Arabia',
		era: 'Mosque 638',
		note: 'The Kaaba in its mataf — the point every other model on this globe faces'
	},
	nabawi: {
		name: 'Al-Masjid an-Nabawi',
		city: 'Madinah, Saudi Arabia',
		era: '622',
		note: 'The Prophet’s mosque, under the green dome'
	}
};
