import { describe, expect, it } from 'vitest';
import { CITIES } from './cities';
import { CONTINENTS, cityContinent, featureContinent } from './continents';
import metadata from '../data/continents.json';
import world from '../../public/world.json';
import { buildContinents } from './continent-model';
import type { FeatureCollection } from 'geojson';
import { Mesh } from 'three';

describe('continent pieces', () => {
	it('assigns every map feature and every live city to exactly one piece', () => {
		expect(metadata).toHaveLength(world.features.length);
		world.features.forEach((_, index) => expect(CONTINENTS).toContain(featureContinent(index)));
		const counts = CONTINENTS.map(continent => CITIES.filter(city => cityContinent(city) === continent).length);
		expect(counts.reduce((sum, count) => sum + count, 0)).toBe(CITIES.length);
	});

	it('keeps island dots in their geographic region', () => {
		for (const [iso2, continent] of [
			['HK', 'Asia'],
			['MT', 'Europe'],
			['MU', 'Africa'],
			['WS', 'Oceania'],
			['BB', 'North America']
		]) {
			expect(cityContinent({ iso2, la: 0, lo: 0 })).toBe(continent);
		}
	});

	it('builds finite curved shells with real thickness for every continent', () => {
		const { groups, materials } = buildContinents(world as FeatureCollection);
		for (const group of groups.values()) {
			expect(group.children.length).toBeGreaterThan(0);
			for (const child of group.children) {
				if (!(child instanceof Mesh)) continue;
				const positions = child.geometry.getAttribute('position');
				let low = Infinity;
				let high = 0;
				for (let index = 0; index < positions.count; index++) {
					const radius = Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index));
					expect(Number.isFinite(radius)).toBe(true);
					low = Math.min(low, radius);
					high = Math.max(high, radius);
				}
				expect(low).toBeCloseTo(1.86, 4);
				expect(high).toBeCloseTo(2, 4);
				child.geometry.dispose();
			}
		}
		materials.forEach(material => material.dispose());
	});
});
