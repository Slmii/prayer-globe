// The sun and moon glyphs, as the design's 3D bodies rather than CSS discs.
//
// These do not join the orrery in `cosmos.ts`, and that is deliberate. The sun
// and moon are not drawn where they actually are: a body on the near side of the
// earth projects *inside* the silhouette, where it was getting buried under city
// labels, so `positionBody` in Globe.tsx rides them around the outside of the rim
// in the direction of the point they stand over. Placing them in the orrery's 3D
// scene would undo that.
//
// So each keeps its own small canvas inside the existing glyph node, which means
// the surrounding layout — the ring placement, the fade near dead centre, the
// label — carries on working untouched, and the CSS opacity on the glyph still
// applies to the whole thing.

import * as THREE from 'three';
import { buildBody, PLANET_RADIUS } from '../lib/planets-model';
import type { BodyId } from '../lib/planets-model';

/**
 * How much of the frame the body's own disc fills.
 *
 * The sun is built with a corona at 1.26 radii and flares beyond that, so it has
 * to sit further back or it loses its own atmosphere off the edges.
 */
const FILL: Partial<Record<BodyId, number>> = { sun: 0.44, moon: 0.92 };

export interface Orb {
	/** Redraw. `illum` and `tilt` only mean anything for the moon. */
	render(illum: number, tilt: number): void;
	dispose(): void;
}

export function createOrb(canvas: HTMLCanvasElement, id: BodyId, px: number): Orb {
	const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setSize(px, px, false);

	const scene = new THREE.Scene();
	const model = buildBody(id);
	scene.add(model);

	// The sun lights itself — it is emissive, and its corona and flares carry
	// their own emission — so it needs only enough ambient to keep the surface
	// texture from going flat. The moon is lit for real, from one side, because
	// that is the whole point of drawing it in 3D: the phase becomes a shadow
	// falling across a sphere instead of a black disc slid across a circle.
	//
	// Its ambient stays low on purpose. Near new moon the crescent is a two-pixel
	// arc, and lifting the night side far enough to "help" simply washes it out
	// until the disc is a flat grey blob with no phase at all. So the disc is left
	// dark and honest, and the glyph's halo — behind it, in CSS — is what makes
	// the marker findable. Earthshine is a good enough excuse for the rest.
	const sun = id === 'sun';
	scene.add(new THREE.AmbientLight(0xbfc8dc, sun ? 2.2 : 0.2));
	const key = new THREE.DirectionalLight(0xfff6e8, sun ? 0 : 7);
	key.position.set(1, 0, 1);
	scene.add(key);

	const fill = FILL[id] ?? 0.8;
	const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
	// Distance that makes a sphere of PLANET_RADIUS span `fill` of the frame.
	camera.position.set(0, 0, PLANET_RADIUS / (fill * Math.tan((35 / 2) * (Math.PI / 180))));
	camera.lookAt(0, 0, 0);

	return {
		render(illum, tilt) {
			if (!sun) {
				// Put the light where it has to be for this illuminated fraction. The
				// phase angle is the angle at the moon between the sun and us, and
				// illumination is (1 + cos) / 2 — so invert that, then swing the
				// direction round by the terminator's tilt on screen.
				const phase = Math.acos(Math.max(-1, Math.min(1, 2 * illum - 1)));
				const x = Math.sin(phase);
				const z = Math.cos(phase);
				key.position.set(x * Math.cos(tilt), x * Math.sin(tilt), z);
			}
			renderer.render(scene, camera);
		},
		dispose() {
			renderer.dispose();
		}
	};
}
