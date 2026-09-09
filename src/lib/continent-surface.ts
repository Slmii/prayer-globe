import { ShapeUtils, Vector2 } from 'three';
import type { FeatureCollection, Position } from 'geojson';
import { featureContinent } from './continents';
import type { Continent } from './continents';

type Coordinate = [number, number];
export interface ContinentSurface {
	continent: Continent;
	triangles: Coordinate[][];
}

function subdivide(a: Coordinate, b: Coordinate, c: Coordinate, output: Coordinate[][], depth = 0) {
	const distance = (p: Coordinate, q: Coordinate) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
	const ab = distance(a, b),
		bc = distance(b, c),
		ca = distance(c, a);
	if (depth >= 16 || Math.max(ab, bc, ca) <= 49) {
		output.push([a, b, c]);
		return;
	}
	const midpoint = (p: Coordinate, q: Coordinate): Coordinate => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
	// Split only the longest edge; coastlines keep the same resolution without
	// multiplying skinny triangles along every short edge.
	if (ab >= bc && ab >= ca) {
		const mid = midpoint(a, b);
		subdivide(a, mid, c, output, depth + 1);
		subdivide(mid, b, c, output, depth + 1);
	} else if (bc >= ca) {
		const mid = midpoint(b, c);
		subdivide(a, b, mid, output, depth + 1);
		subdivide(a, mid, c, output, depth + 1);
	} else {
		const mid = midpoint(c, a);
		subdivide(a, b, mid, output, depth + 1);
		subdivide(mid, b, c, output, depth + 1);
	}
}

/** Tessellate geographic outlines for a flat canvas; no solid models or scene. */
export function createContinentSurfaces(world: FeatureCollection): ContinentSurface[] {
	return world.features.flatMap((feature, index) => {
		const geometry = feature.geometry;
		if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return [];
		const triangles: Coordinate[][] = [];
		const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
		for (const polygon of polygons) {
			const rings = polygon.map((ring: Position[]) =>
				ring.slice(0, -1).map(([lon, lat]) => new Vector2(lon, lat))
			);
			const points = rings.flat();
			for (const [a, b, c] of ShapeUtils.triangulateShape(rings[0], rings.slice(1)))
				subdivide(points[a].toArray(), points[b].toArray(), points[c].toArray(), triangles);
		}
		return [{ continent: featureContinent(index), triangles }];
	});
}
