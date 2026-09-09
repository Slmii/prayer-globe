import { Box3, Vector3 } from 'three';
import type { AnalemmaPoint } from './analemma';

/** Unit sky direction, with north along Z and east along X. */
export function skyDirection(az: number, alt: number) {
	const bearing = (az * Math.PI) / 180;
	const elevation = (alt * Math.PI) / 180;
	return new Vector3(
		Math.cos(elevation) * Math.sin(bearing),
		Math.sin(elevation),
		Math.cos(elevation) * Math.cos(bearing)
	);
}

export function fitSky(points: AnalemmaPoint[]) {
	const positions = points.map(point => skyDirection(point.az, point.alt));
	const box = new Box3().setFromPoints(positions);
	const center = box.getCenter(new Vector3());
	const radius = Math.max(...positions.map(point => point.distanceTo(center)), 0.01);
	const project = (az: number, alt: number) =>
		skyDirection(az, alt)
			.sub(center)
			.multiplyScalar(2 / radius);
	return { positions: points.map(point => project(point.az, point.alt)), project };
}

/** Interpolate adjacent dates, including the December–January seam. */
export function sampleSky(positions: Vector3[], day: number, target = new Vector3()) {
	const wrapped = ((day % positions.length) + positions.length) % positions.length;
	const index = Math.floor(wrapped);
	return target.copy(positions[index]).lerp(positions[(index + 1) % positions.length], wrapped - index);
}
