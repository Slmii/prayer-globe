// The numbers behind the qibla: where the Kaaba is from here, and how far.
//
// The bearing is the initial great-circle heading — what a compass must be
// turned to, not the rhumb line a flat map would suggest.
//
// The dip is here because the geometry is unusually tidy and worth keeping even
// though nothing draws it at the moment. For two points separated by an angular
// distance θ on a sphere, the straight chord between them lies exactly θ/2 below
// the local horizontal. Amsterdam to Makkah is about 4,500 km, so θ ≈ 40° and
// the true line to the Kaaba points some 20° into the ground; from the antipode
// it is straight down. A compass cannot show that, which is the one thing worth
// remembering about it.

import { D, qibla } from './astro';

/** Mean earth radius, km — the same figure the globe layer uses. */
const EARTH_KM = 6371.0088;

export interface QiblaGeometry {
	/** Great-circle initial bearing from north, degrees clockwise. */
	bearing: number;
	/** Great-circle surface distance, km. */
	distance: number;
	/** How far below horizontal the straight line to the Kaaba points, degrees. */
	dip: number;
	/** Angular separation on the sphere, degrees. */
	theta: number;
}

/** Everything the readout needs, from a pair of coordinates. */
export function qiblaGeometry(lat: number, lon: number): QiblaGeometry {
	const bearing = qibla(lat, lon);
	// Haversine, for the angle subtended at the earth's centre.
	const f1 = lat * D;
	const f2 = 21.4225 * D;
	const dF = f2 - f1;
	const dL = (39.8262 - lon) * D;
	const a = Math.sin(dF / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dL / 2) ** 2;
	const theta = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
	return {
		bearing,
		distance: EARTH_KM * theta,
		// The chord's dip below the horizon is half the angular separation.
		dip: theta / 2 / D,
		theta: theta / D
	};
}
