import {
	BufferGeometry,
	DoubleSide,
	Float32BufferAttribute,
	Group,
	Mesh,
	MeshStandardMaterial,
	ShapeUtils,
	Vector2
} from 'three';
import type { FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';
import { CONTINENTS, featureContinent } from './continents';
import type { Continent } from './continents';
import { skyDirection } from './analemma-sky';

const SURFACE = 2;
const UNDERSIDE = 1.86;

/** Subdivide in geographic space before projecting, so broad land stays curved. */
function triangle(vertices: number[], a: Vector2, b: Vector2, c: Vector2, depth = 0) {
	if (depth < 6 && Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) > 6) {
		const ab = a.clone().add(b).multiplyScalar(0.5);
		const bc = b.clone().add(c).multiplyScalar(0.5);
		const ca = c.clone().add(a).multiplyScalar(0.5);
		triangle(vertices, a, ab, ca, depth + 1);
		triangle(vertices, ab, b, bc, depth + 1);
		triangle(vertices, ca, bc, c, depth + 1);
		triangle(vertices, ab, bc, ca, depth + 1);
		return;
	}
	for (const point of [a, b, c]) vertices.push(...skyDirection(point.x, point.y).multiplyScalar(SURFACE).toArray());
	for (const point of [c, b, a]) vertices.push(...skyDirection(point.x, point.y).multiplyScalar(UNDERSIDE).toArray());
}

function shell(rings: Position[][]) {
	const outline = rings.map(ring => ring.slice(0, -1).map(([lon, lat]) => new Vector2(lon, lat)));
	const vertices: number[] = [];
	const points = outline.flat();
	for (const [a, b, c] of ShapeUtils.triangulateShape(outline[0], outline.slice(1)))
		triangle(vertices, points[a], points[b], points[c]);
	for (const ring of outline) {
		for (let index = 0; index < ring.length; index++) {
			const a = ring[index];
			const b = ring[(index + 1) % ring.length];
			const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 4));
			for (let step = 0; step < steps; step++) {
				const start = a.clone().lerp(b, step / steps);
				const end = a.clone().lerp(b, (step + 1) / steps);
				const topA = skyDirection(start.x, start.y).multiplyScalar(SURFACE);
				const topB = skyDirection(end.x, end.y).multiplyScalar(SURFACE);
				const lowA = topA.clone().multiplyScalar(UNDERSIDE / SURFACE);
				const lowB = topB.clone().multiplyScalar(UNDERSIDE / SURFACE);
				for (const point of [topA, lowA, topB, topB, lowA, lowB]) vertices.push(...point.toArray());
			}
		}
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
	geometry.computeVertexNormals();
	return geometry;
}

export function buildContinents(world: FeatureCollection) {
	const groups = new Map<Continent, Group>(
		CONTINENTS.map(name => {
			const group = new Group();
			group.name = name;
			return [name, group];
		})
	);
	const materials = new Map(
		CONTINENTS.map(name => [
			name,
			new MeshStandardMaterial({
				color: '#687788',
				metalness: 0.35,
				roughness: 0.42,
				side: DoubleSide
			})
		])
	);
	world.features.forEach((feature, index) => {
		if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') return;
		const continent = featureContinent(index);
		const geometry = feature.geometry as Polygon | MultiPolygon;
		const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
		for (const polygon of polygons) {
			const mesh = new Mesh(shell(polygon), materials.get(continent));
			mesh.userData.continent = continent;
			groups.get(continent)!.add(mesh);
		}
	});
	return { groups, materials };
}
