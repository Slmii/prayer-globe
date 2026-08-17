// The Kaaba from the design's `kaaba-model.js`, ported off the <three-d-stage>
// viewer shell so it can be dropped into any scene.
//
// Geometry, proportions and material names are unchanged from the design; the
// only edits are removing the stage/exporter plumbing and returning the group
// instead of handing it to a viewer. Built in metres, y-up, origin at ground
// level so it can sit directly on the globe's surface.

import * as THREE from 'three';

/**
 * Footprint of the shadharwan's base in metres — W + 1.9 = 12.86 + 1.9 = 14.76 m,
 * the widest thing left. This is the full ground extent, used to size the model on screen.
 */
export const KAABA_FOOTPRINT = 15;
/** Height to the top of the roof parapet, in metres (y0 0.72 + H 13.10 + 0.5 ≈ 14.3). */
export const KAABA_HEIGHT = 14.6;

function materials() {
	return {
		kiswah: new THREE.MeshStandardMaterial({
			name: 'kiswah_black',
			color: 0x0d0d10,
			roughness: 0.62,
			metalness: 0.14
		}),
		gold: new THREE.MeshStandardMaterial({
			name: 'gold_thread',
			color: 0xc79a3c,
			roughness: 0.3,
			metalness: 0.75
		}),
		goldDeep: new THREE.MeshStandardMaterial({
			name: 'gold_deep',
			color: 0x9c7529,
			roughness: 0.38,
			metalness: 0.7
		}),
		marble: new THREE.MeshStandardMaterial({
			name: 'marble_white',
			color: 0xe9e6dd,
			roughness: 0.42,
			metalness: 0.03
		}),
		marbleGrey: new THREE.MeshStandardMaterial({
			name: 'marble_grey',
			color: 0xc9c5ba,
			roughness: 0.5,
			metalness: 0.03
		}),
		silver: new THREE.MeshStandardMaterial({
			name: 'silver_frame',
			color: 0xc9cdd4,
			roughness: 0.26,
			metalness: 0.85
		}),
		stone: new THREE.MeshStandardMaterial({
			name: 'hajar_aswad',
			color: 0x14100f,
			roughness: 0.34,
			metalness: 0.1
		})
	};
}

type Materials = ReturnType<typeof materials>;

/** shadharwan — the marble skirt, sloping outward toward the ground. */
function taperedBox(wTop: number, dTop: number, wBot: number, dBot: number, h: number) {
	const g = new THREE.BoxGeometry(1, h, 1, 1, 1, 1);
	const p = g.attributes.position;
	for (let i = 0; i < p.count; i++) {
		const up = p.getY(i) > 0;
		p.setX(i, p.getX(i) * (up ? wTop : wBot));
		p.setZ(i, p.getZ(i) * (up ? dTop : dBot));
	}
	p.needsUpdate = true;
	g.computeVertexNormals();
	return g;
}

/** The complete Kaaba, in metres, resting on y = 0. */
export function buildKaaba(): THREE.Group {
	const M: Materials = materials();
	const model = new THREE.Group();
	model.name = 'kaaba';
	const put = (
		g: THREE.BufferGeometry,
		mat: THREE.Material,
		name: string,
		pos?: [number, number, number],
		parent: THREE.Object3D = model
	): THREE.Mesh => {
		const m = new THREE.Mesh(g, mat);
		m.name = name;
		if (pos) m.position.set(pos[0], pos[1], pos[2]);
		parent.add(m);
		return m;
	};

	/* true proportions in metres */
	const W = 12.86,
		D = 11.03,
		H = 13.1;

	/* shadharwan — the marble skirt, sloping outward toward the ground */
	put(taperedBox(W + 0.3, D + 0.3, W + 1.9, D + 1.9, 0.72), M.marble, 'shadharwan', [0, 0.36, 0]);
	put(new THREE.BoxGeometry(W + 0.34, 0.12, D + 0.34), M.marbleGrey, 'shadharwan_cap', [0, 0.78, 0]);

	/* body under the cloth */
	put(new THREE.BoxGeometry(W - 0.1, H, D - 0.1), M.kiswah, 'kaaba_core', [0, 0.72 + H / 2, 0]);

	/* kiswah panels — one per face, slightly proud of the core so folds read */
	const y0 = 0.72;
	const faces: [string, [number, number, number], [number, number, number]][] = [
		['kiswah_east', [W / 2 + 0.06, y0 + H / 2, 0], [0.12, H, D]],
		['kiswah_west', [-W / 2 - 0.06, y0 + H / 2, 0], [0.12, H, D]],
		['kiswah_north', [0, y0 + H / 2, -D / 2 - 0.06], [W, H, 0.12]],
		['kiswah_south', [0, y0 + H / 2, D / 2 + 0.06], [W, H, 0.12]]
	];
	for (const [n, p, s] of faces) put(new THREE.BoxGeometry(s[0], s[1], s[2]), M.kiswah, n, p);

	/* vertical fold ribs on the cloth */
	const ribGroups: [string, number, number, number][] = [
		['x', W, 9, 1],
		['x', W, 9, -1],
		['z', D, 8, 1],
		['z', D, 8, -1]
	];
	for (const [axis, len, count, sgn] of ribGroups) {
		for (let i = 0; i < count; i++) {
			const f = (i + 0.5) / count - 0.5;
			const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, H - 0.3, 8), M.kiswah);
			rib.name = `kiswah_fold_${axis}${sgn > 0 ? 'p' : 'm'}_${i}`;
			if (axis === 'x') rib.position.set(f * len, y0 + H / 2, sgn * (D / 2 + 0.13));
			else rib.position.set(sgn * (W / 2 + 0.13), y0 + H / 2, f * len);
			model.add(rib);
		}
	}

	/* hizam — embroidered gold belt, two-thirds up */
	const hzY = y0 + H * 0.66;
	put(new THREE.BoxGeometry(W + 0.34, 0.95, D + 0.34), M.gold, 'hizam_belt', [0, hzY, 0]);
	put(new THREE.BoxGeometry(W + 0.42, 0.07, D + 0.42), M.goldDeep, 'hizam_edge_top', [0, hzY + 0.5, 0]);
	put(new THREE.BoxGeometry(W + 0.42, 0.07, D + 0.42), M.goldDeep, 'hizam_edge_bottom', [0, hzY - 0.5, 0]);
	/* medallions along the belt */
	const medallionGroups: [string, number, number][] = [
		['x', W, 4],
		['z', D, 3]
	];
	for (const [ax, len, n] of medallionGroups) {
		for (const sgn of [1, -1]) {
			for (let i = 0; i < n; i++) {
				const f = (i + 0.5) / n - 0.5;
				const med = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.075, 10, 28), M.goldDeep);
				med.name = `hizam_medallion_${ax}${sgn > 0 ? 'p' : 'm'}_${i}`;
				if (ax === 'x') {
					med.position.set(f * len, hzY, sgn * (D / 2 + 0.22));
				} else {
					med.position.set(sgn * (W / 2 + 0.22), hzY, f * len);
					med.rotation.y = Math.PI / 2;
				}
				model.add(med);
			}
		}
	}

	/* crown band and roof */
	put(new THREE.BoxGeometry(W + 0.5, 0.42, D + 0.5), M.goldDeep, 'crown_band', [0, y0 + H - 0.2, 0]);
	put(new THREE.BoxGeometry(W + 0.2, 0.3, D + 0.2), M.marbleGrey, 'roof_slab', [0, y0 + H + 0.15, 0]);
	put(new THREE.BoxGeometry(W + 0.6, 0.5, 0.34), M.marble, 'roof_parapet_south', [0, y0 + H + 0.5, D / 2 + 0.2]);
	put(new THREE.BoxGeometry(W + 0.6, 0.5, 0.34), M.marble, 'roof_parapet_north', [0, y0 + H + 0.5, -D / 2 - 0.2]);
	put(new THREE.BoxGeometry(0.34, 0.5, D + 0.6), M.marble, 'roof_parapet_east', [W / 2 + 0.2, y0 + H + 0.5, 0]);
	put(new THREE.BoxGeometry(0.34, 0.5, D + 0.6), M.marble, 'roof_parapet_west', [-W / 2 - 0.2, y0 + H + 0.5, 0]);

	/* mizab al-rahmah — golden waterspout, north face */
	const spout = new THREE.Group();
	spout.name = 'mizab_al_rahmah';
	const chute = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 2.3), M.gold);
	chute.name = 'mizab_chute';
	chute.rotation.x = -0.2;
	spout.add(chute);
	for (const sx of [-1, 1]) {
		const wall = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 2.3), M.gold);
		wall.name = 'mizab_wall_' + (sx > 0 ? 'e' : 'w');
		wall.position.set(sx * 0.31, 0.2, 0);
		wall.rotation.x = -0.2;
		spout.add(wall);
	}
	const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.24, 0.34, 20), M.goldDeep);
	lip.name = 'mizab_lip';
	lip.position.set(0, -0.1, -1.2);
	spout.add(lip);
	spout.position.set(0, y0 + H + 0.5, -D / 2 - 1.1);
	model.add(spout);

	/* the door — gold, on the east face, raised above the ground */
	const door = new THREE.Group();
	door.name = 'bab_al_kaaba';
	put(new THREE.BoxGeometry(0.22, 3.3, 1.7), M.gold, 'door_leaf_north', [0, 0, -0.46], door);
	put(new THREE.BoxGeometry(0.22, 3.3, 1.7), M.gold, 'door_leaf_south', [0, 0, 0.46], door);
	put(new THREE.BoxGeometry(0.3, 3.7, 0.16), M.goldDeep, 'door_mullion', [0.02, 0, 0], door);
	put(new THREE.BoxGeometry(0.3, 0.3, 3.9), M.goldDeep, 'door_lintel', [0.02, 1.85, 0], door);
	put(new THREE.BoxGeometry(0.3, 0.3, 3.9), M.goldDeep, 'door_sill', [0.02, -1.85, 0], door);
	put(new THREE.BoxGeometry(0.3, 4.0, 0.3), M.goldDeep, 'door_jamb_north', [0.02, 0, -1.8], door);
	put(new THREE.BoxGeometry(0.3, 4.0, 0.3), M.goldDeep, 'door_jamb_south', [0.02, 0, 1.8], door);
	for (let i = 0; i < 4; i++) {
		for (const sz of [-0.46, 0.46]) {
			const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 1.3), M.goldDeep);
			p.name = `door_panel_${i}_${sz > 0 ? 's' : 'n'}`;
			p.position.set(0.14, 1.15 - i * 0.78, sz);
			door.add(p);
		}
	}
	door.position.set(W / 2 + 0.14, y0 + 2.0 + 1.85, -1.3);
	model.add(door);

	/* hajar al-aswad — the Black Stone in its silver setting, eastern corner */
	const corner = new THREE.Group();
	corner.name = 'hajar_al_aswad_setting';
	const frame = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.12, 14, 32), M.silver);
	frame.name = 'silver_frame';
	frame.position.z = 0.16;
	corner.add(frame);
	const stoneM = new THREE.Mesh(new THREE.SphereGeometry(0.4, 24, 18), M.stone);
	stoneM.name = 'black_stone';
	stoneM.scale.set(1, 1, 0.42);
	stoneM.position.z = 0.1;
	corner.add(stoneM);
	const setting = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.35, 0.22), M.silver);
	setting.name = 'silver_plate';
	corner.add(setting);
	/* sits on the bisector of the eastern corner, facing outward */
	corner.rotation.y = Math.PI / 4;
	corner.position.set(W / 2 + 0.19, y0 + 1.5, D / 2 + 0.19);
	model.add(corner);

	model.traverse(o => {
		const mesh = o as THREE.Mesh;
		if (!mesh.isMesh) return;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
	});

	return model;
}
