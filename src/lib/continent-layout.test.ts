import { describe, expect, it } from 'vitest';
import type { FeatureCollection, Position } from 'geojson';
import world from '../../public/world.json';
import { CITIES } from './cities';
import { CONTINENTS, cityContinent, featureContinent } from './continents';
import { continentOutlines, createContinentLayout } from './continent-layout';

const source = world as FeatureCollection;

describe('inline continent layout', () => {
	it('keeps every original geographic coordinate when reassembled', () => {
		const layout = createContinentLayout(source, CITIES);
		const restored = layout.transform(source, 0);
		expect(restored.features.map(feature => feature.geometry)).toEqual(
			source.features.map(feature => feature.geometry)
		);
		for (const city of CITIES)
			expect(layout.project([city.lo, city.la], cityContinent(city), 0)).toEqual([city.lo, city.la]);
	});

	it('puts every city inside its continent tile without losing its identity', () => {
		const layout = createContinentLayout(source, CITIES);
		const mercatorY = (lat: number) => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
		for (const city of CITIES) {
			const continent = cityContinent(city);
			const [x, lat] = layout.project([city.lo, city.la], continent);
			const [centerX, centerLat] = layout.center(continent);
			expect(Math.abs(x - centerX)).toBeLessThanOrEqual(42.000001);
			expect(Math.abs(mercatorY(lat) - mercatorY(centerLat))).toBeLessThanOrEqual(27.000001);
		}
		expect(
			CONTINENTS.map(continent => layout.center(continent))
				.flat()
				.every(Number.isFinite)
		).toBe(true);
	});

	it('moves a point on the land and a dot at that point together throughout the animation', () => {
		const layout = createContinentLayout(source, CITIES);
		for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
			const transformed = layout.transform(source, progress);
			for (let index = 0; index < source.features.length; index++) {
				const geometry = source.features[index].geometry;
				const target = transformed.features[index].geometry;
				if (!('coordinates' in geometry) || !('coordinates' in target)) continue;
				const first = (coordinates: unknown): Position => {
					const values = coordinates as unknown[];
					return typeof values[0] === 'number' ? (coordinates as Position) : first(values[0]);
				};
				expect(first(target.coordinates)).toEqual(
					layout.project(first(geometry.coordinates), featureContinent(index), progress)
				);
			}
		}
	});

	it('removes a shared country boundary from a continent hover outline', () => {
		const countries: FeatureCollection = {
			type: 'FeatureCollection',
			features: [
				{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [] } },
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[0, 0],
								[1, 0],
								[1, 1],
								[0, 1],
								[0, 0]
							]
						]
					}
				},
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[1, 0],
								[2, 0],
								[2, 1],
								[1, 1],
								[1, 0]
							]
						]
					}
				}
			]
		};
		const africa = continentOutlines(countries).features.find(
			feature => feature.properties?.continent === 'Africa'
		)!;
		expect(africa.geometry.coordinates).toHaveLength(6);
		expect(africa.geometry.coordinates).not.toContainEqual([
			[1, 0],
			[1, 1]
		]);
	});
});
