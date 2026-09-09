import {
	BufferGeometry,
	Group,
	LineLoop,
	LineBasicMaterial,
	Vector3,
	Mesh,
	CylinderGeometry,
	MeshStandardMaterial,
	PointLight
} from 'three';
import { buildBody } from './planets-model';
import type { BodyId } from './planets-model';
import { buildEarth } from './earth-model';

const ORBITS: { id: BodyId; radius: number; size: number; period: number }[] = [
	{ id: 'mercury', radius: 3.5, size: 0.12, period: 0.241 },
	{ id: 'venus', radius: 4.7, size: 0.2, period: 0.615 },
	{ id: 'earth', radius: 6, size: 0.22, period: 1 },
	{ id: 'mars', radius: 7.3, size: 0.16, period: 1.881 },
	{ id: 'jupiter', radius: 9.5, size: 0.52, period: 11.86 },
	{ id: 'saturn', radius: 12.5, size: 0.42, period: 29.45 },
	{ id: 'uranus', radius: 15.5, size: 0.3, period: 84 },
	{ id: 'neptune', radius: 18, size: 0.28, period: 164.8 }
];

function orbit(radius: number, color: string) {
	return new LineLoop(
		new BufferGeometry().setFromPoints(
			Array.from({ length: 180 }, (_, index) => {
				const angle = (index / 180) * Math.PI * 2;
				return new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
			})
		),
		new LineBasicMaterial({ color, transparent: true, opacity: 0.4 })
	);
}

export function buildSolarSystem() {
	const group = new Group();
	group.name = 'Solar_system_illustration';
	const sun = buildBody('sun');
	sun.scale.setScalar(0.65);
	group.add(sun, new PointLight('#fff1d6', 2.2, 0, 0));
	const motions: { body: Group; angle: number; radius: number; period: number }[] = [];
	ORBITS.forEach((entry, index) => {
		const body = buildBody(entry.id);
		body.scale.setScalar(entry.size);
		const angle = index * 2.4;
		body.position.set(Math.cos(angle) * entry.radius, 0, Math.sin(angle) * entry.radius);
		motions.push({ body, angle, radius: entry.radius, period: entry.period });
		group.add(orbit(entry.radius, entry.id === 'earth' ? '#8bc5dc' : '#52576c'), body);
	});
	group.userData.animate = (delta: number) => {
		for (const motion of motions) {
			motion.angle += (delta * Math.PI * 2) / (40 * motion.period);
			motion.body.position.set(Math.cos(motion.angle) * motion.radius, 0, Math.sin(motion.angle) * motion.radius);
		}
	};
	return group;
}

/** A fixed axis in space makes the changing illumination across seasons visible. */
export function buildSeasons() {
	const group = new Group();
	group.name = 'Earth_seasons_illustration';
	const earth = buildEarth();

	group.add(earth);
	const equator = orbit(2.08, '#f4c56a');
	earth.add(equator);
	const axis = new Mesh(
		new CylinderGeometry(0.015, 0.015, 5.4, 10),
		new MeshStandardMaterial({ color: '#f4c56a', emissive: '#f4c56a', emissiveIntensity: 0.3 })
	);
	earth.add(axis);
	return group;
}
