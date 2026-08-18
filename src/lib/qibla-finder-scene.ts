// The live qibla finder's scene — the design's `qibla-scene.js`.
//
// This is the other half of the qibla question, and it is not the one
// `qibla-scene.ts` answers. That one is a diagram: north-up, static, showing
// that the true line to the Kaaba runs *through* the earth. This one is an
// instrument: you turn, and the world turns under you until the Kaaba is
// straight ahead.
//
// THE CONVENTION THAT MAKES IT WORK
//
// Inside `world`, north is −Z. The camera never moves. Rotating `world` by the
// heading puts whatever you are facing at −Z in camera space — straight away
// from the viewer — so "the arrow points away from me" and "I am facing the
// qibla" become the same statement. The two faint posts are parented to the
// scene rather than to `world`, so they stay put as sights while everything
// else swings past them.
//
// Ported from the design with one substitution: the design file carries its own
// small inline Kaaba, and the app already has a fuller one at the same true
// dimensions (12.86 × 11.03 × 13.10 m), so `buildKaaba` is used instead of
// keeping a second copy of the same building.

import * as THREE from 'three';
import { buildKaaba, KAABA_FOOTPRINT } from './kaaba-model';

/** Signed smallest angle from a to b, in degrees (−180…180]. */
export function delta(a: number, b: number): number {
	return ((b - a + 540) % 360) - 180;
}

/*
 * Options go through the constructor, never Object.assign: assigning would
 * replace the material's THREE.Color instances with raw numbers and every lit
 * surface would render black.
 */
const mat = (name: string, o: THREE.MeshStandardMaterialParameters) =>
	new THREE.MeshStandardMaterial({ name, ...o });

/**
 * The scene's materials, built per scene rather than once per module.
 *
 * They were module-level, which meant `dispose()` freed materials that a later
 * mount would go on to reuse — switching to the diagram and back handed the new
 * scene a set of already-disposed materials. Owning them per scene makes the
 * disposal correct and leaves no shared state between mounts.
 */
function materials() {
	return {
		granite: mat('granite_plaza', { color: 0x3b4256, roughness: 0.8, metalness: 0.02 }),
		ring: mat('compass_ring', { color: 0x5b6480, roughness: 0.62, metalness: 0.14 }),
		tick: mat('compass_tick', { color: 0xb2b9cf, roughness: 0.55, metalness: 0.12 }),
		arrow: mat('qibla_arrow', {
			color: 0x968ae0,
			roughness: 0.34,
			metalness: 0.35,
			emissive: new THREE.Color(0x2a2360),
			emissiveIntensity: 0.7
		}),
		arrowOk: mat('qibla_arrow_locked', {
			color: 0x7ee0b8,
			roughness: 0.3,
			metalness: 0.4,
			emissive: new THREE.Color(0x116b4c),
			emissiveIntensity: 1.0
		})
	};
}

const named = <T extends THREE.Object3D>(m: T, n: string): T => {
	m.name = n;
	return m;
};

/** A cardinal letter, drawn to a canvas — there is no font in a WebGL scene. */
function label(text: string, color: string, px = 128): THREE.Sprite {
	const c = document.createElement('canvas');
	c.width = c.height = px;
	const x = c.getContext('2d')!;
	x.fillStyle = color;
	x.font = '600 ' + Math.round(px * 0.62) + 'px ui-monospace, Menlo, monospace';
	x.textAlign = 'center';
	x.textBaseline = 'middle';
	x.fillText(text, px / 2, px / 2 + px * 0.03);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
	s.name = 'label_' + text;
	return s;
}

export interface FinderScene {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	/** Rotated by the viewer's heading. Everything in the world is under it. */
	world: THREE.Group;
	/** Rotated to the qibla bearing. Carries the arrow and the Kaaba. */
	ray: THREE.Group;
	halo: THREE.Mesh;
	/** Green when you are facing it, violet when you are not. */
	setLocked(on: boolean): void;
	resize(): void;
	dispose(): void;
}

export function buildFinderScene(canvas: HTMLCanvasElement): FinderScene {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;

	const M = materials();

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x12151f);
	scene.fog = new THREE.Fog(0x12151f, 170, 380);

	const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 600);
	camera.position.set(0, 44, 96);
	camera.lookAt(0, 6, -14);

	/*
	 * Floodlit, not moonlit: the Kaaba has to read as a lit object, so there is a
	 * warm key from the camera side, a cool fill, and a rim from behind to
	 * separate the cloth from the sky.
	 */
	scene.add(new THREE.AmbientLight(0xb9c0dd, 0.5));
	scene.add(new THREE.HemisphereLight(0x8b96c8, 0x1a1f2e, 1.15));
	const key = new THREE.DirectionalLight(0xfff4e0, 2.3);
	key.position.set(34, 66, 62);
	key.castShadow = true;
	key.shadow.mapSize.set(1024, 1024);
	Object.assign(key.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 240 });
	key.shadow.camera.updateProjectionMatrix();
	scene.add(key);
	const fill = new THREE.DirectionalLight(0x9f8ff0, 0.85);
	fill.position.set(-46, 30, 34);
	scene.add(fill);
	const rim = new THREE.DirectionalLight(0xc9d2ff, 1.1);
	rim.position.set(-10, 26, -78);
	scene.add(rim);

	const world = new THREE.Group();
	world.name = 'world_north_up';
	scene.add(world);

	// The plate the whole compass stands on.
	const plate = named(new THREE.Mesh(new THREE.CircleGeometry(74, 72), M.granite), 'ground_plate');
	plate.rotation.x = -Math.PI / 2;
	plate.receiveShadow = true;
	world.add(plate);

	// Ring and degree ticks, one every 5° with a longer mark at each cardinal.
	const ring = named(new THREE.Mesh(new THREE.TorusGeometry(50, 0.5, 8, 128), M.ring), 'compass_ring');
	ring.rotation.x = -Math.PI / 2;
	ring.position.y = 0.2;
	world.add(ring);
	for (let i = 0; i < 72; i++) {
		const a = (i / 72) * Math.PI * 2;
		const major = i % 9 === 0;
		const t = named(
			new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, major ? 5.2 : 2.4), M.tick),
			'tick_' + i * 5
		);
		t.position.set(Math.sin(a) * (major ? 46.4 : 47.8), 0.2, -Math.cos(a) * (major ? 46.4 : 47.8));
		t.rotation.y = a;
		world.add(t);
	}
	const CARDINALS: [string, number, string][] = [
		['N', 0, '#e9e9ed'],
		['E', 90, '#7d84a0'],
		['S', 180, '#7d84a0'],
		['W', 270, '#7d84a0']
	];
	for (const [txt, deg, col] of CARDINALS) {
		const s = label(txt, col);
		const a = (deg * Math.PI) / 180;
		s.position.set(Math.sin(a) * 58, 3.4, -Math.cos(a) * 58);
		s.scale.setScalar(deg === 0 ? 11 : 8.5);
		world.add(s);
	}

	/*
	 * The qibla ray: a beam along the ground and the arrow above it, both
	 * children of one group that is simply rotated to the bearing.
	 */
	const ray = new THREE.Group();
	ray.name = 'qibla_ray';
	world.add(ray);

	const beam = named(
		new THREE.Mesh(
			new THREE.PlaneGeometry(2.6, 44),
			new THREE.MeshBasicMaterial({
				color: 0x968ae0,
				transparent: true,
				opacity: 0.3,
				side: THREE.DoubleSide,
				depthWrite: false
			})
		),
		'qibla_beam'
	);
	beam.rotation.x = -Math.PI / 2;
	beam.position.set(0, 0.35, -25);
	ray.add(beam);

	/*
	 * A round shaft with a long, smooth spear point — a low-segment pyramid head
	 * read as a faceted lump rather than as an arrow.
	 */
	const shaft = named(
		new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 22, 20), M.arrow),
		'arrow_shaft'
	);
	shaft.rotation.x = Math.PI / 2;
	shaft.position.set(0, 2.4, -12);
	shaft.castShadow = true;
	ray.add(shaft);
	const head = named(new THREE.Mesh(new THREE.ConeGeometry(3.5, 13, 28), M.arrow), 'arrow_head');
	head.rotation.x = -Math.PI / 2;
	head.position.set(0, 2.4, -29);
	head.castShadow = true;
	ray.add(head);
	// A thin collar where the point meets the shaft, so the join reads deliberate.
	const collar = named(
		new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.9, 24), M.arrow),
		'arrow_collar'
	);
	collar.rotation.x = Math.PI / 2;
	collar.position.set(0, 2.4, -22.4);
	ray.add(collar);
	const tail = named(new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.2, 1.2, 28), M.arrow), 'arrow_pivot');
	tail.position.y = 2.4;
	ray.add(tail);

	// The Kaaba itself, standing on the ring at the bearing. Sized to the design's
	// footprint rather than to its scale factor, since this is the app's model.
	const kaaba = buildKaaba();
	kaaba.traverse(o => {
		const mesh = o as THREE.Mesh;
		if (mesh.isMesh) {
			mesh.castShadow = true;
			mesh.receiveShadow = true;
		}
	});
	kaaba.scale.setScalar(15.4 / KAABA_FOOTPRINT);
	kaaba.position.set(0, 0, -52);
	ray.add(kaaba);

	// A soft halo under it, which turns green on lock.
	const halo = named(
		new THREE.Mesh(
			new THREE.RingGeometry(13, 22, 48),
			new THREE.MeshBasicMaterial({
				color: 0x968ae0,
				transparent: true,
				opacity: 0.18,
				side: THREE.DoubleSide,
				depthWrite: false
			})
		),
		'kaaba_halo'
	);
	halo.rotation.x = -Math.PI / 2;
	halo.position.set(0, 0.3, -52);
	ray.add(halo);

	/*
	 * The fixed "you are facing this way" sights, parented to the scene rather
	 * than to `world` so they never rotate — the world turns between them.
	 */
	const gate = new THREE.Group();
	gate.name = 'facing_gate';
	scene.add(gate);
	for (const s of [1, -1]) {
		const post = named(
			new THREE.Mesh(
				new THREE.BoxGeometry(0.7, 0.7, 30),
				new THREE.MeshBasicMaterial({ color: 0xe9e9ed, transparent: true, opacity: 0.26 })
			),
			'facing_guide_' + (s > 0 ? 'r' : 'l')
		);
		post.position.set(s * 7, 0.5, -18);
		gate.add(post);
	}

	return {
		renderer,
		scene,
		camera,
		world,
		ray,
		halo,

		setLocked(on) {
			const m = on ? M.arrowOk : M.arrow;
			shaft.material = head.material = tail.material = collar.material = m;
			const c = on ? 0x7ee0b8 : 0x968ae0;
			const beamMat = beam.material as THREE.MeshBasicMaterial;
			const haloMat = halo.material as THREE.MeshBasicMaterial;
			beamMat.color.setHex(c);
			haloMat.color.setHex(c);
			beamMat.opacity = on ? 0.5 : 0.3;
			haloMat.opacity = on ? 0.34 : 0.18;
		},

		resize() {
			const box = canvas.parentElement;
			const w = box?.clientWidth || canvas.clientWidth || 1;
			const h = box?.clientHeight || canvas.clientHeight || 1;
			renderer.setSize(w, h, false);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
		},

		dispose() {
			// The pair the arrow swaps between: whichever is not currently mounted
			// on a mesh would otherwise be missed by the traversal below.
			M.arrow.dispose();
			M.arrowOk.dispose();
			/*
			 * Meshes *and* sprites. Testing `isMesh` skipped the four cardinal
			 * letters, and those are the only things in the scene carrying a
			 * texture — a CanvasTexture each, leaked on every close.
			 *
			 * Sprites share an internal geometry rather than owning one, so the
			 * geometry is disposed only where it exists.
			 */
			scene.traverse(o => {
				const part = o as THREE.Object3D & {
					geometry?: THREE.BufferGeometry;
					material?: THREE.Material | THREE.Material[];
				};
				part.geometry?.dispose();
				if (!part.material) return;
				for (const m of Array.isArray(part.material) ? part.material : [part.material]) {
					(m as THREE.MeshStandardMaterial | THREE.SpriteMaterial).map?.dispose();
					m.dispose();
				}
			});
			renderer.dispose();
		}
	};
}
