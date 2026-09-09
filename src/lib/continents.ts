import metadata from '../data/continents.json';
import type { City } from './cities';

export const CONTINENTS = [
	'Africa',
	'Asia',
	'Europe',
	'North America',
	'South America',
	'Oceania',
	'Antarctica'
] as const;
export type Continent = (typeof CONTINENTS)[number];

export const CONTINENT_CENTERS: Record<Continent, [number, number]> = {
	Africa: [20, 5],
	Asia: [95, 35],
	Europe: [35, 55],
	'North America': [-100, 40],
	'South America': [-60, -20],
	Oceania: [140, -25],
	Antarctica: [0, -90]
};

const COUNTRY_CONTINENTS = new Map<string, Continent>();
for (const item of metadata)
	if (!COUNTRY_CONTINENTS.has(item.iso)) COUNTRY_CONTINENTS.set(item.iso, item.continent as Continent);

const ISLANDS: Record<string, Continent> = {};
for (const [continent, countries] of [
	['Africa', 'MU YT CV KM SC'],
	['Asia', 'HK MO MV BH SG'],
	['Europe', 'AD MT IM SJ MC LI VA'],
	['North America', 'GP MS BB LC MQ BM AW DM GD AG AI CW'],
	['Oceania', 'PN NU WS GU TO FM']
] as [Continent, string][]) {
	for (const country of countries.split(' ')) ISLANDS[country] = continent;
}

export function featureContinent(index: number): Continent {
	return metadata[index].continent as Continent;
}

export function cityContinent(city: Pick<City, 'iso2' | 'lo' | 'la'>): Continent {
	const continent = COUNTRY_CONTINENTS.get(city.iso2);
	if (continent) return continent;
	if (ISLANDS[city.iso2]) return ISLANDS[city.iso2];
	// Guest cities may have no country code. Assign the nearest continent centre.
	const radians = Math.PI / 180;
	return CONTINENTS.reduce((nearest, candidate) => {
		const distance = (name: Continent) => {
			const [lon, lat] = CONTINENT_CENTERS[name];
			return (
				Math.sin(city.la * radians) * Math.sin(lat * radians) +
				Math.cos(city.la * radians) * Math.cos(lat * radians) * Math.cos((city.lo - lon) * radians)
			);
		};
		return distance(candidate) > distance(nearest) ? candidate : nearest;
	});
}
