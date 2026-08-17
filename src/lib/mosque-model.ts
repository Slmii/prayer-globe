// The mosque from the design's `mosque-model.js`, ported off the <three-d-stage>
// viewer shell so it can be dropped into any scene.
//
// Geometry, proportions and material names are unchanged from the design; the
// only edits are removing the stage/exporter plumbing and returning the group
// instead of handing it to a viewer. Built in metres, y-up, origin at ground
// level so it can sit directly on the globe's surface.

import * as THREE from 'three';

/** Footprint of the plinth in metres — used to size the model on screen. */
export const MOSQUE_FOOTPRINT = 34;
/** Height to the tip of the minaret finials, in metres. */
export const MOSQUE_HEIGHT = 36;

function materials() {
	return {
		limestone: new THREE.MeshStandardMaterial({
			name: 'limestone',
			color: 0xe8ddc8,
			roughness: 0.85,
			metalness: 0.02
		}),
		stoneDark: new THREE.MeshStandardMaterial({
			name: 'stone_shadow',
			color: 0xbfae94,
			roughness: 0.9,
			metalness: 0.02
		}),
		dome: new THREE.MeshStandardMaterial({
			name: 'dome_verdigris',
			color: 0x2f8f88,
			roughness: 0.45,
			metalness: 0.35
		}),
		brass: new THREE.MeshStandardMaterial({
			name: 'brass',
			color: 0xd8b04a,
			roughness: 0.35,
			metalness: 0.4
		}),
		tile: new THREE.MeshStandardMaterial({
			name: 'tile_indigo',
			color: 0x24406e,
			roughness: 0.4,
			metalness: 0.1
		}),
		void_: new THREE.MeshStandardMaterial({
			name: 'interior_void',
			color: 0x1b1d23,
			roughness: 1,
			metalness: 0
		})
	};
}

type Materials = ReturnType<typeof materials>;

/** Pointed-arch outline. */
function archShape(w: number, h: number, spring: number) {
	const s = new THREE.Shape();
	const hw = w / 2;
	s.moveTo(-hw, 0);
	s.lineTo(-hw, spring);
	s.quadraticCurveTo(-hw, h * 0.94, 0, h);
	s.quadraticCurveTo(hw, h * 0.94, hw, spring);
	s.lineTo(hw, 0);
	s.lineTo(-hw, 0);
	return s;
}

/** A wall panel with pointed-arch openings punched through it. */
function archWall(opts: {
	width: number;
	height: number;
	depth: number;
	count: number;
	archW: number;
	archH: number;
	spring: number;
	material: THREE.Material;
}) {
	const { width, height, depth, count, archW, archH, spring, material } = opts;
	const outer = new THREE.Shape();
	outer.moveTo(-width / 2, 0);
	outer.lineTo(width / 2, 0);
	outer.lineTo(width / 2, height);
	outer.lineTo(-width / 2, height);
	outer.lineTo(-width / 2, 0);

	const step = width / count;
	for (let i = 0; i < count; i++) {
		const cx = -width / 2 + step * (i + 0.5);
		const hole = archShape(archW, archH, spring);
		hole.getPoints(24);
		const pts = hole.extractPoints(24).shape.map(p => new THREE.Vector2(p.x + cx, p.y));
		outer.holes.push(new THREE.Path(pts));
	}

	const g = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: false, curveSegments: 24 });
	g.translate(0, 0, -depth / 2);
	return new THREE.Mesh(g, material);
}

function domeProfile(R: number, lift: number, segs = 40) {
	const pts: THREE.Vector2[] = [];
	for (let i = 0; i <= segs; i++) {
		const a = (i / segs) * (Math.PI / 2);
		pts.push(new THREE.Vector2(R * Math.cos(a) * (1 + 0.06 * Math.sin(a * 2)), R * Math.sin(a) * lift));
	}
	return pts;
}

function finial(M: Materials, scale: number, tag: string) {
	const g = new THREE.Group();
	g.name = 'finial_' + tag;
	const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.16 * scale, 1.4 * scale, 16), M.brass);
	stem.name = 'finial_stem_' + tag;
	stem.position.y = 0.7 * scale;
	g.add(stem);
	const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.34 * scale, 24, 16), M.brass);
	bulb.name = 'finial_bulb_' + tag;
	bulb.position.y = 1.5 * scale;
	g.add(bulb);
	const cres = new THREE.Mesh(new THREE.TorusGeometry(0.52 * scale, 0.075 * scale, 12, 40, Math.PI * 1.45), M.brass);
	cres.name = 'crescent_' + tag;
	cres.position.y = 2.35 * scale;
	cres.rotation.z = -Math.PI * 0.28;
	g.add(cres);
	return g;
}

function dome(
	M: Materials,
	opts: {
		radius: number;
		lift: number;
		drumH: number;
		drumR: number;
		windows: number;
		tag: string;
		y: number;
	}
) {
	const { radius, lift, drumH, drumR, windows, tag, y } = opts;
	const g = new THREE.Group();
	g.name = 'dome_group_' + tag;

	const drum = new THREE.Mesh(new THREE.CylinderGeometry(drumR, drumR, drumH, 40), M.limestone);
	drum.name = 'drum_' + tag;
	drum.position.y = drumH / 2;
	g.add(drum);

	for (let i = 0; i < windows; i++) {
		const a = (i / windows) * Math.PI * 2;
		const wnd = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8, 0.2), M.tile);
		wnd.name = `drum_window_${tag}_${i}`;
		wnd.position.set(Math.sin(a) * (drumR + 0.02), drumH * 0.55, Math.cos(a) * (drumR + 0.02));
		wnd.rotation.y = a;
		g.add(wnd);
	}

	const shell = new THREE.Mesh(new THREE.LatheGeometry(domeProfile(radius, lift), 48), M.dome);
	shell.name = 'dome_' + tag;
	shell.position.y = drumH;
	g.add(shell);

	const ring = new THREE.Mesh(new THREE.TorusGeometry(drumR + 0.12, 0.22, 12, 48), M.stoneDark);
	ring.name = 'dome_ring_' + tag;
	ring.rotation.x = Math.PI / 2;
	ring.position.y = drumH + 0.05;
	g.add(ring);

	const f = finial(M, radius * 0.42, tag);
	f.position.y = drumH + radius * lift;
	g.add(f);

	g.position.y = y;
	return g;
}

function minaret(M: Materials, tag: string) {
	const g = new THREE.Group();
	g.name = 'minaret_' + tag;

	const base = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.2, 3.0), M.stoneDark);
	base.name = 'minaret_base_' + tag;
	base.position.y = 1.6;
	g.add(base);

	const taper = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.5, 2.4, 16), M.limestone);
	taper.name = 'minaret_transition_' + tag;
	taper.position.y = 3.2 + 1.2;
	g.add(taper);

	const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.15, 20, 24), M.limestone);
	shaft.name = 'minaret_shaft_' + tag;
	shaft.position.y = 5.6 + 10;
	g.add(shaft);

	for (let i = 0; i < 12; i++) {
		const fl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 19, 0.16), M.stoneDark);
		fl.name = `minaret_flute_${tag}_${i}`;
		const a = (i / 12) * Math.PI * 2;
		fl.position.set(Math.sin(a) * 1.0, 15.6, Math.cos(a) * 1.0);
		fl.rotation.y = a;
		g.add(fl);
	}

	const bal = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.4, 0.45, 32), M.stoneDark);
	bal.name = 'balcony_floor_' + tag;
	bal.position.y = 25.6;
	g.add(bal);

	const rail = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 1.1, 32, 1, true), M.tile);
	rail.name = 'balcony_rail_' + tag;
	rail.position.y = 26.35;
	g.add(rail);

	const cap = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.09, 10, 40), M.brass);
	cap.name = 'balcony_cap_' + tag;
	cap.rotation.x = Math.PI / 2;
	cap.position.y = 26.92;
	g.add(cap);

	const up = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.8, 4.2, 20), M.limestone);
	up.name = 'minaret_upper_' + tag;
	up.position.y = 28.9;
	g.add(up);

	const cone = new THREE.Mesh(new THREE.ConeGeometry(1.05, 3.4, 24), M.dome);
	cone.name = 'minaret_cap_' + tag;
	cone.position.y = 32.7;
	g.add(cone);

	const f = finial(M, 0.62, 'min_' + tag);
	f.position.y = 34.3;
	g.add(f);
	return g;
}

/** The complete mosque, in metres, resting on y = 0. */
export function buildMosque(): THREE.Group {
	const M = materials();
	const model = new THREE.Group();
	model.name = 'mosque';
	const add = (mesh: THREE.Object3D, name: string, parent: THREE.Object3D = model) => {
		mesh.name = name;
		parent.add(mesh);
		return mesh;
	};

	// plinth & courtyard
	const PL = 34;
	const PD = 30;
	add(new THREE.Mesh(new THREE.BoxGeometry(PL, 0.9, PD), M.stoneDark), 'plinth').position.y = 0.45;
	add(new THREE.Mesh(new THREE.BoxGeometry(PL - 2.4, 0.35, PD - 2.4), M.limestone), 'plinth_top').position.y =
		0.9 + 0.175;

	// prayer hall
	const HW = 22;
	const HH = 11;
	const HD = 20;
	const BASE = 1.25;
	const hall = add(new THREE.Mesh(new THREE.BoxGeometry(HW, HH, HD), M.limestone), 'prayer_hall');
	hall.position.y = BASE + HH / 2;

	add(new THREE.Mesh(new THREE.BoxGeometry(HW + 0.9, 0.7, HD + 0.9), M.stoneDark), 'cornice').position.y =
		BASE + HH - 0.35;

	// arcade galleries on the two long sides
	for (const sgn of [1, -1]) {
		const w = archWall({
			width: HD - 1,
			height: 7.2,
			depth: 1.2,
			count: 5,
			archW: 2.4,
			archH: 5.2,
			spring: 3.0,
			material: M.limestone
		});
		w.name = sgn > 0 ? 'arcade_east' : 'arcade_west';
		w.rotation.y = Math.PI / 2;
		w.position.set(sgn * (HW / 2 + 0.6), BASE, 0);
		model.add(w);
		const roof = add(
			new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.4, HD), M.stoneDark),
			sgn > 0 ? 'arcade_roof_east' : 'arcade_roof_west'
		);
		roof.position.set(sgn * (HW / 2 + 0.65), BASE + 7.3, 0);
	}

	// front arcade and recess
	const front = archWall({
		width: HW,
		height: 8.6,
		depth: 1.0,
		count: 3,
		archW: 3.0,
		archH: 6.4,
		spring: 3.4,
		material: M.limestone
	});
	front.name = 'front_arcade';
	front.position.set(0, BASE, HD / 2 + 0.5);
	model.add(front);
	add(new THREE.Mesh(new THREE.BoxGeometry(HW - 0.2, 8.6, 0.4), M.void_), 'front_recess').position.set(
		0,
		BASE + 4.3,
		HD / 2 - 0.1
	);

	// iwan: tall recessed entrance frame
	const iwan = new THREE.Group();
	iwan.name = 'iwan';
	const frame = archWall({
		width: 8.4,
		height: 10,
		depth: 1.6,
		count: 1,
		archW: 5.0,
		archH: 8.4,
		spring: 4.4,
		material: M.tile
	});
	frame.name = 'iwan_frame';
	iwan.add(frame);
	const inner = new THREE.Mesh(
		new THREE.ExtrudeGeometry(archShape(5.0, 8.4, 4.4), {
			depth: 0.3,
			bevelEnabled: false,
			curveSegments: 24
		}),
		M.void_
	);
	inner.name = 'iwan_void';
	inner.position.z = -1.0;
	iwan.add(inner);
	iwan.position.set(0, BASE, HD / 2 + 1.3);
	model.add(iwan);

	// domes
	const domeY = BASE + HH;
	model.add(dome(M, { radius: 7.4, lift: 1.12, drumH: 3.6, drumR: 6.9, windows: 12, tag: 'main', y: domeY }));
	const semiPos: [number, number][] = [
		[-8.4, -7.2],
		[8.4, -7.2],
		[-8.4, 7.2],
		[8.4, 7.2]
	];
	semiPos.forEach(([x, z], i) => {
		const d = dome(M, {
			radius: 2.5,
			lift: 1.05,
			drumH: 1.2,
			drumR: 2.3,
			windows: 0,
			tag: 'corner' + i,
			y: domeY
		});
		d.position.set(x, domeY, z);
		model.add(d);
	});

	// minarets
	const mA = minaret(M, 'west');
	mA.position.set(-(HW / 2 + 3.2), BASE, HD / 2 - 1.0);
	model.add(mA);
	const mB = minaret(M, 'east');
	mB.position.set(HW / 2 + 3.2, BASE, HD / 2 - 1.0);
	model.add(mB);

	// steps
	for (let i = 0; i < 3; i++) {
		const s = add(new THREE.Mesh(new THREE.BoxGeometry(10 - i * 0.8, 0.42, 1.1), M.stoneDark), 'step_' + i);
		s.position.set(0, 0.21 + i * 0.42, PD / 2 - 0.6 - i * 1.0);
	}

	return model;
}
