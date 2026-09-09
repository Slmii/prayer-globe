import type { FeatureCollection, Position, MultiLineString } from 'geojson';
import type { City } from './cities';
import { CONTINENTS, CONTINENT_CENTERS, cityContinent, featureContinent } from './continents';
import type { Continent } from './continents';

const SLOTS: Record<Continent, [number, number]> = {
	'North America': [-105, 55],
	Europe: [0, 55],
	Asia: [105, 55],
	'South America': [-105, -15],
	Africa: [0, -15],
	Oceania: [105, -15],
	Antarctica: [0, -78]
};
const mercatorY = (lat: number) =>
	(Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360)) * 180) / Math.PI;
const latitude = (y: number) => ((2 * Math.atan(Math.exp((y * Math.PI) / 180)) - Math.PI / 2) * 180) / Math.PI;

function local([lon, lat]: Position, continent: Continent): [number, number] {
	const center = CONTINENT_CENTERS[continent][0];
	return [continent === 'Antarctica' ? lon : ((lon - center + 540) % 360) - 180, mercatorY(lat)];
}

function visit(coordinates: unknown, point: (position: Position) => Position): unknown {
	if (!Array.isArray(coordinates)) return coordinates;
	if (typeof coordinates[0] === 'number') return point(coordinates as Position);
	return coordinates.map(value => visit(value, point));
}

/** Fit each piece and its city dots together, with one shared geographic transform. */
export function createContinentLayout(world: FeatureCollection, cities: City[]) {
	const bounds = Object.fromEntries(
		CONTINENTS.map(name => [name, [Infinity, Infinity, -Infinity, -Infinity]])
	) as Record<Continent, number[]>;
	const include = (point: Position, name: Continent) => {
		const [x, y] = local(point, name);
		const b = bounds[name];
		b[0] = Math.min(b[0], x);
		b[1] = Math.min(b[1], y);
		b[2] = Math.max(b[2], x);
		b[3] = Math.max(b[3], y);
		return point;
	};
	world.features.forEach((feature, index) => {
		if ('coordinates' in feature.geometry)
			visit(feature.geometry.coordinates, point => include(point, featureContinent(index)));
	});
	cities.forEach(city => include([city.lo, city.la], cityContinent(city)));
	const project = (point: Position, continent: Continent, progress = 1): [number, number] => {
		if (progress === 0) return [point[0], point[1]];
		const [x, y] = local(point, continent);
		const [left, bottom, right, top] = bounds[continent];
		const scale = Math.min(84 / Math.max(right - left, 1), 54 / Math.max(top - bottom, 1));
		const [slotX, slotY] = SLOTS[continent];
		const target = [slotX + (x - (left + right) / 2) * scale, latitude(slotY + (y - (bottom + top) / 2) * scale)];
		return [point[0] + (target[0] - point[0]) * progress, point[1] + (target[1] - point[1]) * progress];
	};
	const transform = (source: FeatureCollection, progress: number): FeatureCollection => ({
		...source,
		features: source.features.map((feature, index) => {
			const continent = (feature.properties?.continent as Continent | undefined) ?? featureContinent(index);
			return {
				...feature,
				properties: { ...feature.properties, continent },
				geometry:
					'coordinates' in feature.geometry
						? ({
								...feature.geometry,
								coordinates: visit(feature.geometry.coordinates, point =>
									project(point, continent, progress)
								)
							} as typeof feature.geometry)
						: feature.geometry
			};
		})
	});
	const center = (continent: Continent): [number, number] => [SLOTS[continent][0], latitude(SLOTS[continent][1])];
	return { project, transform, center };
}

/** Cancel shared country edges so hover highlights the continent perimeter. */
export function continentOutlines(world: FeatureCollection): FeatureCollection<MultiLineString> {
	const groups = new Map(CONTINENTS.map(name => [name, new Map<string, Position[]>()]));
	world.features.forEach((feature, index) => {
		const geometry = feature.geometry;
		if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return;
		const edges = groups.get(featureContinent(index))!;
		const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
		for (const polygon of polygons)
			for (const ring of polygon)
				for (let i = 1; i < ring.length; i++) {
					const a = ring[i - 1];
					const b = ring[i];
					const key = [a.join(','), b.join(',')].sort().join('|');
					if (edges.has(key)) edges.delete(key);
					else edges.set(key, [a, b]);
				}
	});
	return {
		type: 'FeatureCollection',
		features: CONTINENTS.map(continent => ({
			type: 'Feature',
			properties: { continent },
			geometry: { type: 'MultiLineString', coordinates: [...groups.get(continent)!.values()] }
		}))
	};
}
