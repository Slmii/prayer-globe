import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { analemma } from './analemma';
import { fitSky, sampleSky, skyDirection } from './analemma-sky';

describe('analemma sky geometry', () => {
	it('keeps bearings continuous across north and at the zenith', () => {
		expect(skyDirection(359.99, 30).distanceTo(skyDirection(0.01, 30))).toBeLessThan(0.001);
		expect(skyDirection(0, 90).distanceTo(skyDirection(180, 90))).toBeLessThan(0.000001);
		expect(skyDirection(90, 0).x).toBeCloseTo(1);
		expect(skyDirection(0, -30).y).toBeCloseTo(-0.5);
	});

	it('fits all dates at polar, equatorial and middle latitudes at every hour', () => {
		for (const lat of [-80, -52, 0, 21, 52, 80]) {
			for (let hour = 0; hour < 24; hour++) {
				const figure = analemma(lat, 0, 0, hour, Date.UTC(2028, 5, 15));
				const { positions } = fitSky(figure.points);
				expect(positions).toHaveLength(366);
				for (const position of positions) {
					expect(Number.isFinite(position.length())).toBe(true);
					expect(position.length()).toBeLessThanOrEqual(2.000001);
				}
			}
		}
	});

	it('moves smoothly through the year boundary in either direction', () => {
		const positions = [new Vector3(0, 0, 0), new Vector3(2, 0, 0)];
		expect(sampleSky(positions, 1.75).x).toBeCloseTo(0.5);
		expect(sampleSky(positions, -0.25).x).toBeCloseTo(0.5);
		expect(sampleSky(positions, 2).x).toBe(0);
	});
});
