import { BackSide, CanvasTexture, Group, Mesh, MeshStandardMaterial, SphereGeometry, SRGBColorSpace } from 'three';
import world from '../../public/world.json';

/** Paint the existing geographic dataset, rather than inventing continent shapes. */
export function buildEarth() {
	const canvas = document.createElement('canvas');
	canvas.width = 2048;
	canvas.height = 1024;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Earth texture could not be created');
	context.fillStyle = '#123b60';
	context.fillRect(0, 0, canvas.width, canvas.height);
	for (const feature of world.features) {
		const polygons =
			feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates];
		for (const polygon of polygons as number[][][][]) {
			context.beginPath();
			for (const ring of polygon) {
				ring.forEach(([lon, lat], index) => {
					const x = ((lon + 180) / 360) * canvas.width;
					const y = ((90 - lat) / 180) * canvas.height;
					if (index === 0) context.moveTo(x, y);
					else context.lineTo(x, y);
				});
				context.closePath();
			}
			context.fillStyle = '#638275';
			context.fill('evenodd');
		}
	}
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	texture.anisotropy = 4;
	const earth = new Group();
	earth.name = 'Earth';
	earth.rotation.z = (-23.44 * Math.PI) / 180;
	const surface = new Mesh(
		new SphereGeometry(2, 96, 64),
		new MeshStandardMaterial({ map: texture, roughness: 0.65, metalness: 0.08 })
	);
	surface.name = 'Earth_surface';
	earth.add(surface);
	const atmosphere = new Mesh(
		new SphereGeometry(2.035, 64, 40),
		new MeshStandardMaterial({
			color: '#6fbfff',
			emissive: '#236b9a',
			emissiveIntensity: 0.35,
			transparent: true,
			opacity: 0.2,
			side: BackSide,
			depthWrite: false
		})
	);
	atmosphere.name = 'Earth_atmosphere';
	earth.add(atmosphere);
	return earth;
}
