// The design's `mosques-model.js`, ported: twenty-six major mosques, each built to
// its own architectural tradition.
//
// Geometry, proportions and material names are unchanged from the design. Every
// model rests directly on the ground plane — no plinths, podiums or terrace
// plateaus — so it can sit straight on the globe's surface.
//
// Each entry also carries a `footprint`: the ground extent in metres the layer
// scales the model by, so a 40 m courtyard mosque and a 60 m tent read at the
// same size on screen. It is measured from the built geometry rather than typed
// in, because these are large hand-assembled models and a number that has to be
// kept in step with them by hand will eventually stop being true.

import * as THREE from 'three';
import {
	palette,
	mat,
	group,
	box,
	cyl,
	named,
	dome,
	minaret,
	iwan,
	hypostyle,
	hall,
	archWall,
	arcadeRing,
	archShape,
	horseshoeShape,
	chhatri,
	merlons,
	finial
} from './mosque-kit';

const put = <T extends THREE.Object3D>(g: THREE.Object3D, obj: T, x: number, y: number, z: number): T => {
	obj.position.set(x, y, z);
	g.add(obj);
	return obj;
};

/* 1 ─ Sultan Ahmed (Blue Mosque), Istanbul — cascading Ottoman domes, six minarets */
function blueMosque(): THREE.Group {
	const P = palette({
		stone: mat('stone_grey', 0xd9d2c4, 0.85),
		dome: mat('lead_grey', 0x8d99a6, 0.5, 0.3),
		tile: mat('iznik_blue', 0x1f4f8f, 0.4, 0.1)
	});
	const g = group('sultan_ahmed_mosque');
	const HW = 30,
		HD = 30,
		HH = 17;
	g.add(hall({ w: HW, h: HH, d: HD, P, tag: 'main' }));
	g.add(merlons({ len: HW, y: HH, z: HD / 2, count: 16, P, tag: 'front' }));
	g.add(merlons({ len: HW, y: HH, z: -HD / 2, count: 16, P, tag: 'back' }));

	// semi-dome buttress tier
	(
		[
			[0, HD / 2],
			[0, -HD / 2],
			[HW / 2, 0],
			[-HW / 2, 0]
		] as [number, number][]
	).forEach(([x, z], i) => {
		const d = dome({
			radius: 8.4,
			kind: 'shallow',
			drumH: 2.2,
			drumR: 8.0,
			windows: 8,
			tag: 'semi' + i,
			P,
			crescent: false,
			finialScale: 0.2
		});
		put(g, d, x * 0.62, HH - 1.5, z * 0.62);
	});
	(
		[
			[1, 1],
			[1, -1],
			[-1, 1],
			[-1, -1]
		] as [number, number][]
	).forEach(([sx, sz], i) => {
		const d = dome({
			radius: 4.4,
			kind: 'shallow',
			drumH: 1.6,
			drumR: 4.2,
			tag: 'corner' + i,
			P,
			crescent: false,
			finialScale: 0.2
		});
		put(g, d, sx * 12.4, HH, sz * 12.4);
		const t = cyl(2.2, 2.6, 5.0, P.stone, `turret_${i}`, 8);
		put(g, t, sx * 14.2, HH + 2.5, sz * 14.2);
	});
	put(
		g,
		dome({ radius: 13.4, kind: 'hemi', drumH: 6.4, drumR: 12.6, windows: 20, ribs: 20, tag: 'central', P }),
		0,
		HH,
		0
	);

	// courtyard in front, arcaded
	put(
		g,
		arcadeRing({
			w: HW,
			d: 22,
			height: 8.4,
			depth: 1.3,
			step: 4.2,
			archW: 2.7,
			archH: 6.2,
			spring: 3.4,
			material: P.stone,
			tag: 'court'
		}),
		0,
		0,
		HD / 2 + 11
	);
	for (let i = 0; i < 3; i++) {
		const s = box(11 - i * 0.9, 0.4, 1.1, P.stoneDark, 'step_' + i);
		put(g, s, 0, 0.2 + i * 0.4, HD / 2 + 22.4 + i * 1.0);
	}

	// six minarets: four at the hall corners (tall), two at the courtyard (shorter)
	(
		[
			[1, 1, 52],
			[-1, 1, 52],
			[1, -1, 46],
			[-1, -1, 46]
		] as [number, number, number][]
	).forEach(([sx, sz, h], i) => {
		put(g, minaret({ kind: 'ottoman', h, tag: 'hall' + i, P }), sx * (HW / 2 + 3.4), 0, sz * (HD / 2 + 3.4));
	});
	[1, -1].forEach((sx, i) => {
		put(g, minaret({ kind: 'ottoman', h: 38, tag: 'court' + i, P }), sx * (HW / 2 + 2.4), 0, HD / 2 + 22);
	});
	return g;
}

/* 2 ─ Sheikh Zayed Grand Mosque, Abu Dhabi — white marble, dome field, four minarets */
function sheikhZayed(): THREE.Group {
	const P = palette({
		stone: mat('white_marble', 0xf4f1e9, 0.6, 0.04),
		stoneDark: mat('marble_shadow', 0xd8d3c6, 0.7),
		dome: mat('marble_dome', 0xf7f5ef, 0.5, 0.05),
		tile: mat('floral_inlay', 0x3f6f52, 0.45)
	});
	const g = group('sheikh_zayed_grand_mosque');
	const HW = 34,
		HD = 26,
		HH = 13;
	g.add(hall({ w: HW, h: HH, d: HD, P, tag: 'main' }));
	put(g, dome({ radius: 10.6, kind: 'ogee', drumH: 5.0, drumR: 9.6, windows: 16, tag: 'central', P }), 0, HH, 0);
	(
		[
			[1, 1],
			[1, -1],
			[-1, 1],
			[-1, -1]
		] as [number, number][]
	).forEach(([sx, sz], i) => {
		put(
			g,
			dome({ radius: 4.6, kind: 'ogee', drumH: 2.6, drumR: 4.2, windows: 8, tag: 'flank' + i, P }),
			sx * 13.0,
			HH,
			sz * 9.0
		);
	});

	// arcaded courtyard ringed with small domes on every pier
	const CW = 46,
		CD = 34;
	put(
		g,
		arcadeRing({
			w: CW,
			d: CD,
			height: 9.0,
			depth: 1.5,
			step: 4.6,
			archW: 3.0,
			archH: 6.8,
			spring: 3.6,
			material: P.stone,
			tag: 'riwaq'
		}),
		0,
		0,
		HD / 2 + CD / 2 - 1
	);
	const ringZ = HD / 2 + CD / 2 - 1;
	let k = 0;
	for (let i = 0; i < 10; i++) {
		const t = -CW / 2 + (CW / 10) * (i + 0.5);
		[ringZ - CD / 2, ringZ + CD / 2].forEach(z => {
			put(
				g,
				dome({ radius: 1.9, kind: 'ogee', drumH: 0.9, drumR: 1.7, tag: 'riwaq' + k++, P, finialScale: 0.28 }),
				t,
				9.0,
				z
			);
		});
	}
	for (let j = 0; j < 7; j++) {
		const z = ringZ - CD / 2 + (CD / 7) * (j + 0.5);
		[-CW / 2, CW / 2].forEach(x => {
			put(
				g,
				dome({ radius: 1.9, kind: 'ogee', drumH: 0.9, drumR: 1.7, tag: 'riwaq' + k++, P, finialScale: 0.28 }),
				x,
				9.0,
				z
			);
		});
	}
	(
		[
			[1, 1],
			[-1, 1],
			[1, -1],
			[-1, -1]
		] as [number, number][]
	).forEach(([sx, sz], i) => {
		put(
			g,
			minaret({ kind: 'ottoman', h: 60, tag: 'c' + i, P }),
			sx * (CW / 2 + 3.0),
			0,
			ringZ + sz * (CD / 2 + 3.0)
		);
	});
	return g;
}

/* 3 ─ Faisal Mosque, Islamabad — desert-tent prayer hall, four needle minarets */
function faisalMosque(): THREE.Group {
	const P = palette({
		stone: mat('white_concrete', 0xf0ece2, 0.7),
		stoneDark: mat('concrete_shadow', 0xcdc7ba, 0.8),
		dome: mat('tent_shell', 0xe8e4da, 0.65),
		tile: mat('mosaic_blue', 0x1d5f9c, 0.4)
	});
	const g = group('faisal_mosque');
	const R = 21,
		H = 30;
	// eight folded planes rising to a point — the tent
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * Math.PI * 2;
		const geo = new THREE.BufferGeometry();
		const half = Math.PI / 8;
		const p1 = new THREE.Vector3(Math.sin(a - half) * R, 0, Math.cos(a - half) * R);
		const p2 = new THREE.Vector3(Math.sin(a + half) * R, 0, Math.cos(a + half) * R);
		const apex = new THREE.Vector3(Math.sin(a) * R * 0.1, H, Math.cos(a) * R * 0.1);
		const mid = new THREE.Vector3(Math.sin(a) * R * 0.62, H * 0.34, Math.cos(a) * R * 0.62);
		const v = [p1, mid, p2, p1, apex, mid, p2, mid, apex];
		geo.setAttribute(
			'position',
			new THREE.Float32BufferAttribute(
				v.flatMap(p => [p.x, p.y, p.z]),
				3
			)
		);
		geo.computeVertexNormals();
		const face = named(new THREE.Mesh(geo, P.dome), 'tent_face_' + i);
		(face.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
		g.add(face);
		const edge = named(
			new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, p1.distanceTo(apex), 8), P.stoneDark),
			'tent_rib_' + i
		);
		edge.position.copy(p1.clone().add(apex).multiplyScalar(0.5));
		edge.position.y += 0.31;
		edge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), apex.clone().sub(p1).normalize());
		g.add(edge);
	}
	// glazed base band under the tent
	const band = named(
		new THREE.Mesh(new THREE.CylinderGeometry(R * 0.99, R * 0.99, 6.2, 8, 1, true), P.tile),
		'glazed_band'
	);
	put(g, band, 0, 3.1, 0);
	const sill = named(new THREE.Mesh(new THREE.CylinderGeometry(R * 1.05, R * 1.05, 0.7, 8), P.stone), 'sill');
	put(g, sill, 0, 6.4, 0);
	const f = finial(1.5, 'apex', P.trim);
	put(g, f, 0, H, 0);
	(
		[
			[1, 1],
			[1, -1],
			[-1, 1],
			[-1, -1]
		] as [number, number][]
	).forEach(([sx, sz], i) => {
		put(g, minaret({ kind: 'needle', h: 62, tag: 'n' + i, P }), sx * R * 1.22, 0, sz * R * 1.22);
	});
	return g;
}

/* 4 ─ Great Mosque of Djenné, Mali — Sudano-Sahelian mud brick, toron spikes */
function djenne(): THREE.Group {
	const P = palette({
		stone: mat('mud_brick', 0xc08b52, 0.95),
		stoneDark: mat('mud_shadow', 0x9c6c3c, 0.98),
		dome: mat('mud_cap', 0xb47f47, 0.95),
		tile: mat('mud_recess', 0x7d5530, 0.98),
		wood: mat('palm_toron', 0x5c4326, 0.9)
	});
	const g = group('great_mosque_of_djenne');
	// Prayer hall, its long face BEING the east qibla wall.
	const W = 40,
		D = 21,
		H = 11;
	const body = box(W, H, D, P.stone, 'qibla_block');
	put(g, body, 0, H / 2, 0);
	// engaged buttress pilasters with pinnacles all round
	const pil = (x: number, z: number, rot: number) => {
		const p = box(1.7, H + 2.6, 1.2, P.stone, `buttress_${x.toFixed(1)}_${z.toFixed(1)}`);
		p.rotation.y = rot;
		put(g, p, x, (H + 2.6) / 2, z);
		const cone = named(
			new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.9, 5), P.dome),
			`pinnacle_${x.toFixed(1)}_${z.toFixed(1)}`
		);
		cone.rotation.y = rot;
		put(g, cone, x, H + 3.5, z);
	};
	for (let i = 0; i < 19; i++) pil(-W / 2 + (W / 18) * i, D / 2 + 0.5, 0);
	for (let i = 0; i < 13; i++) pil(-W / 2 + (W / 12) * i, -D / 2 - 0.5, 0);
	for (let j = 1; j < 7; j++) {
		pil(W / 2 + 0.5, -D / 2 + (D / 7) * j, Math.PI / 2);
		pil(-W / 2 - 0.5, -D / 2 + (D / 7) * j, Math.PI / 2);
	}
	// toron: the bristling palm beams
	for (let ring = 0; ring < 4; ring++) {
		for (let i = 0; i < 17; i++) {
			const x = -W / 2 + (W / 16) * i;
			[D / 2 + 1.1, -D / 2 - 1.1].forEach((z, s) => {
				const t = named(
					new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.5, 6), P.wood),
					`toron_${ring}_${i}_${s}`
				);
				t.rotation.x = Math.PI / 2;
				put(g, t, x, 3.0 + ring * 2.3, z);
			});
		}
	}
	// Three box-like tower-minarets ENGAGED in the qibla wall, jutting from its
	// face rather than standing free; the central one over the mihrab is tallest,
	// each capped by a cone spire crowned with an ostrich egg.
	(
		[
			[-13, 13.4],
			[0, 16.4],
			[13, 13.4]
		] as [number, number][]
	).forEach(([x, th], i) => {
		const tw = i === 1 ? 6.6 : 5.4;
		const proj = 3.2;
		// tapering box: two stacked batters keep the Djenné wall profile
		const lower = box(tw, th * 0.6, proj, P.stone, `qibla_tower_${i}_lower`);
		put(g, lower, x, th * 0.3, D / 2 + proj / 2 - 0.4);
		const upper = box(tw * 0.84, th * 0.4, proj * 0.86, P.stone, `qibla_tower_${i}_upper`);
		put(g, upper, x, th * 0.6 + th * 0.2, D / 2 + proj * 0.43 - 0.4);
		// toron bristling across the tower face
		for (let r = 0; r < 4; r++) {
			for (let c = 0; c < 3; c++) {
				const t = named(
					new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.4, 6), P.wood),
					`tower_toron_${i}_${r}_${c}`
				);
				t.rotation.x = Math.PI / 2;
				put(g, t, x + (c - 1) * (tw * 0.3), 3.4 + r * 2.6, D / 2 + proj + 0.1);
			}
		}
		// cone spire + ostrich egg finial
		const spire = named(
			new THREE.Mesh(new THREE.ConeGeometry(tw * 0.42, th * 0.24, 6), P.dome),
			`tower_spire_${i}`
		);
		put(g, spire, x, th + th * 0.11, D / 2 + proj * 0.43 - 0.4);
		const egg = named(new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), P.tile), `ostrich_egg_${i}`);
		egg.scale.y = 1.35;
		put(g, egg, x, th + th * 0.24 + 0.5, D / 2 + proj * 0.43 - 0.4);
	});
	// Walled outer courtyard to the west, galleried on three sides.
	const wall = box(W, 4.2, 0.9, P.stone, 'court_wall_west');
	put(g, wall, 0, 2.1, -D / 2 - 30);
	for (const s of [1, -1]) {
		const side = box(0.9, 4.2, 30, P.stone, `court_wall_${s > 0 ? 'north' : 'south'}`);
		put(g, side, (s * W) / 2, 2.1, -D / 2 - 15);
	}
	return g;
}

/* 5 ─ Hassan II Mosque, Casablanca — long hall, tallest square minaret */
function hassanII(): THREE.Group {
	const P = palette({
		stone: mat('travertine', 0xe9e0cc, 0.82),
		stoneDark: mat('cedar_trim', 0x7a5a34, 0.8),
		dome: mat('green_zellij', 0x2c6b4f, 0.4, 0.25),
		tile: mat('zellij_green', 0x1f5e47, 0.35, 0.15)
	});
	const g = group('hassan_ii_mosque');
	const W = 26,
		D = 44,
		H = 20;
	g.add(hall({ w: W, h: H, d: D, P, tag: 'main' }));
	// green tiled gable roof over the hall
	const roof = named(new THREE.Mesh(new THREE.BoxGeometry(W + 2.4, 5.6, D + 2.4), P.dome), 'tiled_roof');
	roof.geometry.translate(0, 0, 0);
	put(g, roof, 0, H + 2.8, 0);
	const ridge = box(2.0, 1.0, D + 3.0, P.trim, 'roof_ridge');
	put(g, ridge, 0, H + 6.0, 0);
	// horseshoe arcades down both flanks
	for (const s of [1, -1]) {
		const a = archWall({
			width: D,
			height: 11.0,
			depth: 1.4,
			count: 9,
			archW: 3.2,
			archH: 8.6,
			spring: 4.2,
			material: P.stone,
			shape: horseshoeShape,
			name: s > 0 ? 'arcade_east' : 'arcade_west'
		});
		a.rotation.y = Math.PI / 2;
		put(g, a, s * (W / 2 + 0.7), 0, 0);
	}
	// grand horseshoe portal
	put(g, iwan({ w: 13, h: 15, depth: 2.4, P, tag: 'portal', shape: horseshoeShape }), 0, 0, D / 2 + 1.2);
	// the square minaret with lantern and pyramidal cap
	put(g, minaret({ kind: 'square', h: 78, tag: 'main', P }), 0, 0, -D / 2 - 9);
	return g;
}

/* 6 ─ Shah (Imam) Mosque, Isfahan — turquoise bulbous dome, twin tiled minarets */
function shahMosque(): THREE.Group {
	const P = palette({
		stone: mat('isfahan_brick', 0xd8c29a, 0.85),
		stoneDark: mat('brick_shadow', 0xb59a72, 0.9),
		dome: mat('turquoise_tile', 0x28a3a8, 0.35, 0.25),
		tile: mat('cobalt_tile', 0x1c4f9c, 0.35, 0.15),
		trim: mat('gold_leaf', 0xd9ae4b, 0.3, 0.4)
	});
	const g = group('shah_mosque_isfahan');

	/* The mosque's famous move: the entrance vestibule holds the alignment of the
	   maidan, while the whole rest of the building is turned 45 degrees onto the
	   qibla. So court and sanctuary are built in their own group and rotated. */
	const inner = group('qibla_aligned_mosque');
	const CW = 26,
		CD = 32; // courtyard, two-storey arcades all round
	inner.add(
		arcadeRing({
			w: CW,
			d: CD,
			height: 8.4,
			depth: 1.5,
			step: 4.0,
			archW: 2.5,
			archH: 6.4,
			spring: 3.2,
			material: P.stone,
			tag: 'court_lower'
		})
	);
	const upperArc = arcadeRing({
		w: CW,
		d: CD,
		height: 7.2,
		depth: 1.5,
		step: 4.0,
		archW: 2.3,
		archH: 5.6,
		spring: 2.9,
		material: P.stoneDark,
		tag: 'court_upper'
	});
	put(inner, upperArc, 0, 8.4, 0);
	put(inner, box(9.0, 0.35, 13.0, P.dome, 'courtyard_pool'), 0, 0.18, 0);

	// Four iwans, one at the centre of each side of the court.
	put(inner, iwan({ w: 15, h: 20, depth: 3.0, P, tag: 'qibla' }), 0, 0, -CD / 2 - 1.5);
	const courtEntry = iwan({ w: 13, h: 17, depth: 2.6, P, tag: 'court_entry' });
	courtEntry.rotation.y = Math.PI;
	put(inner, courtEntry, 0, 0, CD / 2 + 1.5);
	for (const s of [1, -1]) {
		const si = iwan({ w: 12, h: 16, depth: 2.6, P, tag: s > 0 ? 'east' : 'west' });
		si.rotation.y = (s * Math.PI) / 2;
		put(inner, si, s * (CW / 2 + 1.5), 0, 0);
		// domed chamber behind each lateral iwan
		put(inner, box(11, 11, 11, P.stone, `lateral_chamber_${s > 0 ? 'e' : 'w'}`), s * (CW / 2 + 8.0), 5.5, 0);
		put(
			inner,
			dome({
				radius: 5.4,
				kind: 'pointed',
				drumH: 2.2,
				drumR: 4.6,
				tag: s > 0 ? 'lat_e' : 'lat_w',
				P,
				crescent: false,
				finialScale: 0.22
			}),
			s * (CW / 2 + 8.0),
			11,
			0
		);
	}

	// Domed sanctuary behind the qibla iwan, on a sixteen-sided drum.
	const SW = 24,
		SD = 22,
		SH = 15;
	const sz = -CD / 2 - 3 - SD / 2;
	put(inner, box(SW, SH, SD, P.stone, 'sanctuary_block'), 0, SH / 2, sz);
	put(inner, cyl(9.0, 9.4, 6.0, P.tile, 'sanctuary_drum_16', 16), 0, SH + 3.0, sz);
	put(
		inner,
		dome({ radius: 10.4, kind: 'pointed', drumH: 0, drumR: 8.8, windows: 16, tag: 'sanctuary', P }),
		0,
		SH + 6.0,
		sz
	);
	// Winter prayer halls flanking the sanctuary, each under eight small domes.
	for (const s of [1, -1]) {
		put(inner, box(12, 10, SD - 2, P.stone, `winter_hall_${s > 0 ? 'e' : 'w'}`), s * (SW / 2 + 6.2), 5, sz);
		for (let i = 0; i < 4; i++)
			for (let j = 0; j < 2; j++) {
				const d = dome({
					radius: 2.5,
					kind: 'shallow',
					tag: `winter_${s > 0 ? 'e' : 'w'}_${i}_${j}`,
					P,
					crescent: false,
					finialScale: 0
				});
				put(inner, d, s * (SW / 2 + 6.2) + (j - 0.5) * 5.6, 10, sz - (SD - 8) / 2 + i * ((SD - 8) / 3));
			}
	}
	// Paired sanctuary minarets on the qibla iwan — the taller pair.
	for (const s of [1, -1]) {
		put(
			inner,
			minaret({ kind: 'persian', h: 48, tag: s > 0 ? 'sanct_e' : 'sanct_w', P }),
			s * 8.6,
			0,
			-CD / 2 - 2.2
		);
	}

	inner.rotation.y = -Math.PI / 4;
	put(g, inner, 0, 0, -14);

	// Entrance portal, held to the maidan's own alignment, with its own pair of
	// shorter minarets, joined to the court by a bent vestibule.
	put(g, iwan({ w: 17, h: 23, depth: 3.2, P, tag: 'maidan_portal' }), 0, 0, 26);
	for (const s of [1, -1]) {
		put(g, minaret({ kind: 'persian', h: 34, tag: s > 0 ? 'portal_e' : 'portal_w', P }), s * 9.4, 0, 27.0);
	}
	put(g, box(13, 12, 14, P.stone, 'bent_vestibule'), 0, 6, 17.5);
	return g;
}

/* 7 ─ Badshahi Mosque, Lahore — red sandstone, three marble domes, four minarets */
function badshahi(): THREE.Group {
	const P = palette({
		stone: mat('red_sandstone', 0xa8492f, 0.85),
		stoneDark: mat('sandstone_shadow', 0x82361f, 0.9),
		dome: mat('white_marble_dome', 0xf2eee2, 0.5, 0.05),
		tile: mat('marble_inlay', 0xe8e2d2, 0.5),
		trim: mat('gilt_finial', 0xd8b04a, 0.35, 0.4)
	});
	const g = group('badshahi_mosque');
	const W = 36,
		D = 20,
		H = 14;
	g.add(hall({ w: W, h: H, d: D, P, tag: 'prayer' }));
	put(g, dome({ radius: 8.0, kind: 'ogee', drumH: 3.4, drumR: 6.6, windows: 10, tag: 'central', P }), 0, H, 0);
	[-13, 13].forEach((x, i) => {
		put(g, dome({ radius: 5.4, kind: 'ogee', drumH: 2.6, drumR: 4.6, windows: 8, tag: 'side' + i, P }), x, H, 0);
	});
	// central pishtaq + flanking arch screen
	put(g, iwan({ w: 13, h: 17, depth: 2.6, P, tag: 'pishtaq' }), 0, 0, D / 2 + 1.3);
	for (const s of [1, -1]) {
		const scr = archWall({
			width: 11,
			height: 11.0,
			depth: 1.2,
			count: 2,
			archW: 3.8,
			archH: 8.4,
			spring: 4.4,
			material: P.stone,
			name: s > 0 ? 'screen_east' : 'screen_west'
		});
		put(g, scr, s * 12.5, 0, D / 2 + 0.6);
	}
	// roofline chhatris
	[-19.5, -6.5, 6.5, 19.5].forEach((x, i) =>
		put(g, chhatri({ r: 1.7, h: 3.4, tag: 'roof' + i, P }), x, H, D / 2 - 2.2)
	);
	// four corner minarets with chhatri crowns
	(
		[
			[1, 1],
			[-1, 1],
			[1, -1],
			[-1, -1]
		] as [number, number][]
	).forEach(([sx, sz], i) => {
		put(g, minaret({ kind: 'mughal', h: 40, tag: 'c' + i, P }), sx * (W / 2 + 4.0), 0, sz * (D / 2 + 12));
	});
	return g;
}

/* 8 ─ Great Mosque of Kairouan, Tunisia — oldest hypostyle plan, stepped square minaret */
function kairouan(): THREE.Group {
	const P = palette({
		stone: mat('kairouan_stone', 0xd9cdb0, 0.9),
		stoneDark: mat('stone_shadow', 0xb2a487, 0.92),
		dome: mat('ribbed_dome', 0xcfc3a6, 0.85),
		tile: mat('dark_recess', 0x6e6350, 0.95)
	});
	const g = group('great_mosque_of_kairouan');
	const W = 30,
		D = 22;
	const hy = hypostyle({ w: W, d: D, colH: 8.0, cols: 8, rows: 6, P, tag: 'hall' });
	g.add(hy);
	const roofY = hy.userData.roofY as number;
	put(
		g,
		dome({
			radius: 4.2,
			kind: 'hemi',
			drumH: 2.4,
			drumR: 3.6,
			ribs: 24,
			tag: 'mihrab',
			P,
			crescent: false,
			finialScale: 0.25
		}),
		0,
		roofY,
		-D / 2 + 3.2
	);
	put(
		g,
		dome({
			radius: 3.4,
			kind: 'hemi',
			drumH: 2.0,
			drumR: 3.0,
			ribs: 20,
			tag: 'bahou',
			P,
			crescent: false,
			finialScale: 0.25
		}),
		0,
		roofY,
		D / 2 - 2.4
	);
	g.add(merlons({ len: W + 1.6, y: roofY, z: D / 2 + 0.8, count: 20, P, tag: 'south' }));
	// courtyard walls with a colonnade facing in
	const CD = 30;
	const cz = D / 2 + CD / 2 + 0.8;
	put(
		g,
		arcadeRing({
			w: W + 1.6,
			d: CD,
			height: 7.4,
			depth: 1.3,
			step: 3.4,
			archW: 2.2,
			archH: 5.8,
			spring: 2.9,
			material: P.stone,
			shape: horseshoeShape,
			tag: 'court'
		}),
		0,
		0,
		cz
	);
	// the three-tiered square minaret on the courtyard axis
	put(g, minaret({ kind: 'square', h: 32, tag: 'main', P }), 0, 0, cz + CD / 2 - 1.0);
	return g;
}

/* 9 ─ Great Mosque of Samarra, Iraq — the spiralling Malwiya minaret */
function samarra(): THREE.Group {
	const P = palette({
		stone: mat('baked_brick', 0xc9a678, 0.92),
		stoneDark: mat('brick_shadow', 0xa2814f, 0.95),
		dome: mat('brick_cap', 0xb99765, 0.92),
		tile: mat('recess_shadow', 0x6d5638, 0.95)
	});
	const g = group('great_mosque_of_samarra');
	const W = 44,
		D = 34,
		H = 10.5;
	// the surviving enclosure: high brick wall with semicircular bastions
	const wallRun = (len: number, x: number, z: number, rot: number, nm: string) => {
		const w = box(len, H, 1.6, P.stone, nm);
		w.rotation.y = rot;
		put(g, w, x, H / 2, z);
	};
	wallRun(W, 0, -D / 2, 0, 'wall_north');
	wallRun(W, 0, D / 2, 0, 'wall_south');
	wallRun(D, W / 2, 0, Math.PI / 2, 'wall_east');
	wallRun(D, -W / 2, 0, Math.PI / 2, 'wall_west');
	let bi = 0;
	const bastion = (x: number, z: number) => {
		const b = cyl(1.5, 1.8, H + 1.2, P.stoneDark, 'bastion_' + bi++, 16);
		put(g, b, x, (H + 1.2) / 2, z);
	};
	for (let i = 0; i <= 6; i++) {
		const x = -W / 2 + (W / 6) * i;
		bastion(x, -D / 2);
		bastion(x, D / 2);
	}
	for (let j = 1; j < 5; j++) {
		const z = -D / 2 + (D / 5) * j;
		bastion(W / 2, z);
		bastion(-W / 2, z);
	}
	g.add(merlons({ len: W, y: H, z: -D / 2, count: 24, P, tag: 'north', h: 0.8 }));
	g.add(merlons({ len: W, y: H, z: D / 2, count: 24, P, tag: 'south', h: 0.8 }));
	// hypostyle qibla hall inside the south end
	const hy = hypostyle({ w: W - 6, d: 12, colH: 7.5, cols: 10, rows: 3, P, tag: 'qibla', shape: archShape });
	put(g, hy, 0, 0, D / 2 - 7.5);
	// Malwiya: the spiral minaret standing free to the north
	put(g, minaret({ kind: 'spiral', h: 34, tag: 'malwiya', P }), 0, 0, -D / 2 - 18);
	return g;
}

/* 10 ─ Kul Sharif, Kazan — white marble on two squares crossed at 45°, turquoise
   Kazan-cap cupola, four tall minarets plus two small and two pseudo-minarets. */
function kulSharif(): THREE.Group {
	const P = palette({
		stone: mat('kazan_white', 0xf2efe6, 0.7),
		stoneDark: mat('grey_trim', 0xc7c3b6, 0.8),
		dome: mat('turquoise_tatar', 0x2fa8a8, 0.4, 0.28),
		tile: mat('azure_glass', 0x2f6fbf, 0.3, 0.2),
		trim: mat('gilt', 0xd9b451, 0.3, 0.4)
	});
	const g = group('kul_sharif_mosque');
	const W = 22,
		H = 15;
	// Two squares intersecting at 45 degrees form the plan.
	g.add(hall({ w: W, h: H, d: W, P, tag: 'square_a' }));
	const squareB = hall({ w: W * 0.94, h: H * 0.96, d: W * 0.94, P, tag: 'square_b' });
	squareB.rotation.y = Math.PI / 4;
	g.add(squareB);
	// Eight lancet arches, one on each face of the two squares.
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * Math.PI * 2;
		const w = archWall({
			width: 9.0,
			height: 12.0,
			depth: 0.8,
			count: 1,
			archW: 5.0,
			archH: 10.8,
			spring: 4.6,
			material: P.stoneDark,
			name: `lancet_arch_${i}`
		});
		w.rotation.y = a;
		put(g, w, Math.sin(a) * (W / 2 + 0.2), 0, Math.cos(a) * (W / 2 + 0.2));
	}
	// corner pavilions
	(
		[
			[1, 1],
			[1, -1],
			[-1, 1],
			[-1, -1]
		] as [number, number][]
	).forEach(([sx, sz], i) => {
		const t = box(6.4, H + 1.6, 6.4, P.stone, 'pavilion_' + i);
		put(g, t, sx * 9.6, (H + 1.6) / 2, sz * 9.6);
		const spire = named(new THREE.Mesh(new THREE.ConeGeometry(4.0, 7.4, 4), P.dome), 'pavilion_spire_' + i);
		spire.rotation.y = Math.PI / 4;
		put(g, spire, sx * 9.6, H + 5.3, sz * 9.6);
		const f = finial(0.6, 'pav' + i, P.trim);
		put(g, f, sx * 9.6, H + 9.2, sz * 9.6);
	});
	// central drum + turquoise "Kazan cap" cupola with tulip windows
	const drum = cyl(7.6, 8.2, 7.0, P.stone, 'central_drum', 16);
	put(g, drum, 0, H + 3.5, 0);
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * Math.PI * 2;
		const win = box(1.5, 4.4, 0.3, P.tile, 'drum_glass_' + i);
		win.rotation.y = a;
		put(g, win, Math.sin(a) * 7.9, H + 3.8, Math.cos(a) * 7.9);
	}
	const cupola = named(new THREE.Mesh(new THREE.ConeGeometry(8.4, 13.0, 8), P.dome), 'kazan_cap_cupola');
	put(g, cupola, 0, H + 13.5, 0);
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
		const tulip = named(new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 10), P.tile), 'tulip_window_' + i);
		tulip.scale.y = 1.5;
		put(g, tulip, Math.sin(a) * 5.6, H + 10.6, Math.cos(a) * 5.6);
	}
	put(g, finial(1.5, 'apex', P.trim), 0, H + 20.0, 0);
	// four tall minarets at the corners, turquoise-capped
	(
		[
			[1, 1],
			[1, -1],
			[-1, 1],
			[-1, -1]
		] as [number, number][]
	).forEach(([sx, sz], i) => {
		put(g, minaret({ kind: 'ottoman', h: 40, tag: 'tall' + i, P }), sx * 15.5, 0, sz * 15.5);
	});
	// two smaller minarets on the qibla flank
	for (const s of [1, -1]) {
		put(g, minaret({ kind: 'ottoman', h: 24, tag: s > 0 ? 'small_e' : 'small_w', P }), s * 16.4, 0, -2);
	}
	// entrance block with two decorative pseudo-minarets above it
	put(g, box(13, 12, 6.4, P.stone, 'entrance_block'), 0, 6, W / 2 + 5.4);
	put(
		g,
		archWall({
			width: 13,
			height: 11.0,
			depth: 0.9,
			count: 1,
			archW: 5.6,
			archH: 9.6,
			spring: 4.2,
			material: P.stoneDark,
			name: 'entrance_arch'
		}),
		0,
		0,
		W / 2 + 8.7
	);
	for (const s of [1, -1]) {
		const key = s > 0 ? 'e' : 'w';
		put(g, cyl(0.9, 1.15, 9.0, P.stone, `pseudo_minaret_${key}`, 12), s * 5.1, 16.5, W / 2 + 5.4);
		const cap = named(new THREE.Mesh(new THREE.ConeGeometry(1.35, 3.4, 12), P.dome), `pseudo_cap_${key}`);
		put(g, cap, s * 5.1, 22.7, W / 2 + 5.4);
		put(g, finial(0.34, `pseudo_${key}`, P.trim), s * 5.1, 24.6, W / 2 + 5.4);
	}
	return g;
}

/* 11 ─ Great Mosque of Xi'an, China — Ming courtyard pavilions and a wooden minaret */
function xian(): THREE.Group {
	const P = palette({
		stone: mat('plaster_wall', 0xe4dcc8, 0.88),
		stoneDark: mat('stone_base', 0xb9ae95, 0.9),
		dome: mat('glazed_tile_roof', 0x2f4436, 0.5, 0.2),
		tile: mat('roof_tile_green', 0x36573f, 0.5),
		wood: mat('painted_timber', 0x8a3c28, 0.75),
		trim: mat('gilt_bronze', 0xc9a24a, 0.35, 0.4)
	});
	const g = group('great_mosque_of_xian');
	// Chinese hall: timber columns, deep hipped roof, no dome
	function pavilion({
		w,
		d,
		colH,
		tag,
		tiers = 2
	}: {
		w: number;
		d: number;
		colH: number;
		tag: string;
		tiers?: number;
	}) {
		const p = group('pavilion_' + tag);
		for (let i = 0; i < 2; i++)
			for (let j = 0; j < 2; j++) {
				const c = cyl(0.34, 0.38, colH, P.wood, `col_${tag}_${i}_${j}`, 12);
				put(p, c, (i ? 1 : -1) * (w / 2 - 0.8), colH / 2, (j ? 1 : -1) * (d / 2 - 0.8));
			}
		const wall = box(w - 1.2, colH * 0.92, d - 1.2, P.stone, 'wall_' + tag);
		put(p, wall, 0, colH * 0.46, 0);
		const beam = box(w + 1.0, 0.6, d + 1.0, P.wood, 'beam_' + tag);
		put(p, beam, 0, colH + 0.3, 0);
		for (let t = 0; t < tiers; t++) {
			const s = 1 - t * 0.24;
			const eaveW = (w + 4.4) * s,
				eaveD = (d + 4.4) * s;
			const roof = named(new THREE.Mesh(new THREE.BoxGeometry(eaveW, 0.55, eaveD), P.dome), `eave_${tag}_${t}`);
			put(p, roof, 0, colH + 1.0 + t * 2.6, 0);
			const slope = named(
				new THREE.Mesh(new THREE.CylinderGeometry(0.2, eaveW * 0.42, 2.2, 4), P.tile),
				`roof_slope_${tag}_${t}`
			);
			slope.rotation.y = Math.PI / 4;
			put(p, slope, 0, colH + 2.3 + t * 2.6, 0);
			const ridge = box(eaveW * 0.5, 0.4, 0.5, P.trim, `ridge_${tag}_${t}`);
			put(p, ridge, 0, colH + 3.4 + t * 2.6, 0);
		}
		return p;
	}
	put(g, pavilion({ w: 24, d: 14, colH: 8.0, tag: 'prayer_hall', tiers: 2 }), 0, 0, -18);
	put(g, pavilion({ w: 14, d: 10, colH: 6.4, tag: 'lecture', tiers: 1 }), 0, 0, 2);
	put(g, pavilion({ w: 10, d: 8, colH: 5.6, tag: 'gate', tiers: 1 }), 0, 0, 20);
	// the minaret is a three-storey timber pavilion tower
	put(g, minaret({ kind: 'pagoda', h: 22, tag: 'tower', P }), 0, 0, 11);
	// courtyard side walls and a pailou screen
	for (const s of [1, -1]) {
		const w = box(0.8, 4.0, 42, P.stone, `court_wall_${s > 0 ? 'east' : 'west'}`);
		put(g, w, s * 15, 2.0, -2);
		const cap = box(1.4, 0.4, 42, P.tile, `wall_cap_${s > 0 ? 'east' : 'west'}`);
		put(g, cap, s * 15, 4.2, -2);
	}
	return g;
}

/* 12 ─ Al-Aqsa Mosque, Jerusalem — silver-lead dome over a broad arcaded hall */
function alAqsa(): THREE.Group {
	const P = palette({
		stone: mat('jerusalem_stone', 0xe3d6b8, 0.88),
		stoneDark: mat('stone_shadow', 0xbfae8c, 0.9),
		dome: mat('lead_silver', 0xa9b0b6, 0.45, 0.35),
		tile: mat('mosaic_band', 0x2a5f7a, 0.4)
	});
	const g = group('al_aqsa_mosque');
	const W = 30,
		D = 22,
		H = 12;
	g.add(hall({ w: W, h: H, d: D, P, tag: 'main' }));
	// seven-arch north façade porch
	const porch = archWall({
		width: W,
		height: 9.6,
		depth: 1.6,
		count: 7,
		archW: 2.9,
		archH: 7.4,
		spring: 3.8,
		material: P.stone,
		name: 'facade_porch'
	});
	put(g, porch, 0, 0, D / 2 + 0.8);
	const porchRoof = box(W + 1.2, 0.8, 3.4, P.stoneDark, 'porch_roof');
	put(g, porchRoof, 0, 9.9, D / 2 + 0.9);
	// clerestory nave running to the qibla
	const nave = box(11, 4.6, D, P.stone, 'nave_clerestory');
	put(g, nave, 0, H + 2.3, 0);
	for (let i = 0; i < 6; i++) {
		const z = -D / 2 + (D / 6) * (i + 0.5);
		for (const s of [1, -1]) {
			const w = box(0.3, 2.6, 1.4, P.tile, `clerestory_window_${i}_${s > 0 ? 'e' : 'w'}`);
			put(g, w, s * 5.6, H + 2.6, z);
		}
	}
	put(
		g,
		dome({ radius: 7.4, kind: 'hemi', drumH: 4.2, drumR: 6.2, windows: 12, tag: 'silver', P }),
		0,
		H + 4.6,
		-D / 2 + 6.0
	);
	g.add(merlons({ len: W, y: H, z: -D / 2, count: 18, P, tag: 'qibla' }));
	// flanking aisles, lower and arcaded
	for (const s of [1, -1]) {
		const a = archWall({
			width: D,
			height: 8.2,
			depth: 1.3,
			count: 6,
			archW: 2.5,
			archH: 6.2,
			spring: 3.2,
			material: P.stone,
			name: s > 0 ? 'aisle_east' : 'aisle_west'
		});
		a.rotation.y = Math.PI / 2;
		put(g, a, s * (W / 2 + 0.65), 0, 0);
	}
	return g;
}

/* 13 ─ Aya Sofya / Hagia Sophia, Istanbul — Byzantine dome on pendentives,
   flanked east and west by half-domes, buttressed ochre-rose walls, and four
   Ottoman minarets of differing dates added at the corners. */
function hagiaSophia(): THREE.Group {
	const P = palette({
		stone: mat('rose_render', 0xd8a68a, 0.9),
		stoneDark: mat('render_shadow', 0xb07f68, 0.9),
		dome: mat('lead_grey', 0x9aa3ab, 0.55, 0.28),
		trim: mat('gilt', 0xc8a24a, 0.4, 0.6),
		tile: mat('window_glass', 0x4a5a6a, 0.35, 0.2),
		wood: mat('marble_trim', 0xe4dccb, 0.7)
	});
	const g = group('hagia_sophia');

	// Naos core: a square block carrying the great dome on four arches.
	const CW = 31,
		CH = 30;
	put(g, box(CW, CH, CW, P.stone, 'naos_core'), 0, CH / 2, 0);
	const cornice = box(CW + 1.4, 1.2, CW + 1.4, P.stoneDark, 'naos_cornice');
	put(g, cornice, 0, CH - 0.6, 0);

	// Four great piers expressed as pilasters at the core corners.
	(
		[
			[1, 1],
			[1, -1],
			[-1, 1],
			[-1, -1]
		] as [number, number][]
	).forEach(([sx, sz], i) => {
		put(
			g,
			box(4.6, CH + 2.4, 4.6, P.stoneDark, `great_pier_${i}`),
			sx * (CW / 2 - 1),
			(CH + 2.4) / 2,
			sz * (CW / 2 - 1)
		);
	});

	// Dome: shallow, ribbed, ringed by forty arched windows at its base.
	put(
		g,
		dome({
			radius: 15.6,
			kind: 'shallow',
			drumH: 3.4,
			drumR: 15.2,
			windows: 40,
			ribs: 40,
			tag: 'great',
			P,
			finialScale: 0.34
		}),
		0,
		CH + 0.4,
		0
	);

	// Half-domes closing the nave east and west, each with its own conches.
	[1, -1].forEach((s, i) => {
		const hd = dome({
			radius: 15.2,
			kind: 'shallow',
			drumH: 2.0,
			drumR: 14.4,
			windows: 9,
			tag: 'half' + i,
			P,
			crescent: false,
			finialScale: 0
		});
		hd.scale.z = 0.55;
		put(g, hd, 0, CH - 8.2, s * (CW / 2 + 3.6));
		put(g, box(CW - 2, CH - 9.4, 9.6, P.stone, `exedra_block_${i}`), 0, (CH - 9.4) / 2, s * (CW / 2 + 4.2));
		[-1, 1].forEach((t, j) => {
			const c = dome({
				radius: 4.5,
				kind: 'hemi',
				drumH: 1.2,
				drumR: 4.3,
				tag: `conch_${i}_${j}`,
				P,
				crescent: false,
				finialScale: 0
			});
			put(g, c, t * 9.0, CH - 13.4, s * (CW / 2 + 7.2));
		});
	});

	// Apse projecting from the qibla end, and the narthex opposite.
	const apse = cyl(6.4, 6.8, 19, P.stone, 'apse', 20);
	put(g, apse, 0, 9.5, CW / 2 + 12.6);
	put(g, dome({ radius: 6.6, kind: 'hemi', tag: 'apse', P, crescent: false, finialScale: 0 }), 0, 19, CW / 2 + 12.6);
	put(g, box(CW - 4, 15, 8.2, P.stone, 'narthex'), 0, 7.5, -(CW / 2 + 4.6));

	// Aisles and galleries down the flanks, arcaded in two storeys.
	[1, -1].forEach((s, i) => {
		put(g, box(9.4, 19, CW + 8, P.stone, `aisle_${i}`), s * (CW / 2 + 4.7), 9.5, 0);
		put(
			g,
			archWall({
				width: CW + 8,
				height: 8.4,
				depth: 1.0,
				count: 7,
				archW: 2.6,
				archH: 6.4,
				spring: 3.4,
				material: P.stoneDark,
				name: `gallery_arcade_${i}`
			}),
			0,
			0,
			0
		);
		const arc = archWall({
			width: CW + 7.6,
			height: 8.0,
			depth: 1.1,
			count: 7,
			archW: 2.5,
			archH: 6.0,
			spring: 3.2,
			material: P.stoneDark,
			name: `aisle_arcade_${i}`
		});
		arc.rotation.y = Math.PI / 2;
		put(g, arc, s * (CW / 2 + 9.4), 0, 0);
		const upper = archWall({
			width: CW + 7.6,
			height: 7.4,
			depth: 1.1,
			count: 7,
			archW: 2.3,
			archH: 5.6,
			spring: 3.0,
			material: P.stoneDark,
			name: `gallery_windows_${i}`
		});
		upper.rotation.y = Math.PI / 2;
		put(g, upper, s * (CW / 2 + 9.4), 9.6, 0);

		// Flying buttresses stepping down the flanks — the building's signature bulk.
		for (let k = -1; k <= 1; k++) {
			const b = box(6.2, 24, 5.4, P.stoneDark, `buttress_${i}_${k + 1}`);
			put(g, b, s * (CW / 2 + 12.4), 12, k * 12.5);
			const cap = named(
				new THREE.Mesh(new THREE.ConeGeometry(4.2, 5.2, 4), P.dome),
				`buttress_cap_${i}_${k + 1}`
			);
			cap.rotation.y = Math.PI / 4;
			put(g, cap, s * (CW / 2 + 12.4), 26.6, k * 12.5);
		}
	});

	// Tympanum window walls under the great arches, north and south.
	[1, -1].forEach((s, i) => {
		const t = archWall({
			width: 22,
			height: 9.0,
			depth: 0.9,
			count: 5,
			archW: 2.9,
			archH: 7.2,
			spring: 3.8,
			material: P.tile,
			name: `tympanum_${i}`
		});
		t.rotation.y = Math.PI / 2;
		put(g, t, s * (CW / 2 + 0.2), CH - 10.6, 0);
	});

	// Four Ottoman minarets, deliberately unlike one another in girth and height.
	(
		[
			[1, 1, 56, 'ottoman'],
			[-1, 1, 60, 'ottoman'],
			[1, -1, 52, 'square'],
			[-1, -1, 54, 'square']
		] as [number, number, number, 'ottoman' | 'square'][]
	).forEach(([sx, sz, h, kind], i) => {
		put(g, minaret({ kind, h, tag: 'aya' + i, P }), sx * (CW / 2 + 15.6), 0, sz * (CW / 2 + 15.4));
	});
	return g;
}

/* 14 ─ Al-Azhar, Cairo — Fatimid hypostyle court, Mamluk minarets of five dates */
function alAzhar(): THREE.Group {
	const P = palette({
		stone: mat('cairo_limestone', 0xdfceac, 0.9),
		stoneDark: mat('limestone_shadow', 0xb8a37e, 0.92),
		dome: mat('ribbed_stone_dome', 0xd6c4a2, 0.85),
		tile: mat('mashrabiya_shade', 0x6b5433, 0.9),
		trim: mat('brass', 0xc9a24a, 0.4, 0.5)
	});
	const g = group('al_azhar_mosque');
	const CW = 30,
		CD = 26;
	// Arcaded court on all four sides, keel-arched.
	g.add(
		arcadeRing({
			w: CW,
			d: CD,
			height: 8.6,
			depth: 1.6,
			step: 3.6,
			archW: 2.3,
			archH: 6.8,
			spring: 3.2,
			material: P.stone,
			tag: 'sahn'
		})
	);
	g.add(merlons({ len: CW, y: 8.6, z: CD / 2 + 0.8, count: 20, P, tag: 'sahn_n', h: 1.1 }));
	g.add(merlons({ len: CW, y: 8.6, z: -CD / 2 - 0.8, count: 20, P, tag: 'sahn_s', h: 1.1 }));
	// Hypostyle prayer hall behind the qibla side.
	const hyp = hypostyle({ w: CW + 4, d: 20, colH: 7.4, cols: 11, rows: 6, P, tag: 'qibla' });
	put(g, hyp, 0, 0, -CD / 2 - 11);
	put(g, box(CW + 6, 1.6, 22, P.stoneDark, 'hall_roof'), 0, 8.2, -CD / 2 - 11);
	// Ribbed dome over the mihrab bay, and two smaller over the aisles.
	put(
		g,
		dome({
			radius: 5.6,
			kind: 'hemi',
			drumH: 3.4,
			drumR: 4.8,
			ribs: 24,
			tag: 'mihrab',
			P,
			crescent: false,
			finialScale: 0.3
		}),
		0,
		9.0,
		-CD / 2 - 17
	);
	for (const s of [1, -1]) {
		put(
			g,
			dome({
				radius: 3.2,
				kind: 'hemi',
				drumH: 2.0,
				drumR: 2.8,
				ribs: 16,
				tag: s > 0 ? 'aisle_e' : 'aisle_w',
				P,
				crescent: false,
				finialScale: 0.2
			}),
			s * 11,
			9.0,
			-CD / 2 - 8
		);
	}
	// Entrance block on the court's north face.
	put(g, box(13, 12.5, 5.0, P.stone, 'bab_al_muzayinin'), 0, 6.25, CD / 2 + 3.4);
	put(
		g,
		archWall({
			width: 13,
			height: 11.4,
			depth: 0.9,
			count: 1,
			archW: 5.0,
			archH: 9.8,
			spring: 4.4,
			material: P.stoneDark,
			name: 'entrance_keel_arch'
		}),
		0,
		0,
		CD / 2 + 6.1
	);
	// Five minarets of five different centuries — deliberately unmatched.
	const set: [number, number, number][] = [
		[-CW / 2 - 3, CD / 2 + 3, 30],
		[CW / 2 + 3, CD / 2 + 3, 34],
		[CW / 2 + 3, -CD / 2 - 14, 38],
		[-CW / 2 - 3, -CD / 2 - 6, 27]
	];
	set.forEach(([x, z, h], i) => put(g, minaret({ kind: 'square', h, tag: 'azhar' + i, P }), x, 0, z));
	// The famous double-headed Mamluk minaret: twin finialled lanterns on one shaft.
	const twin = minaret({ kind: 'square', h: 42, tag: 'twin', P });
	put(g, twin, -CW / 2 - 3, 0, -CD / 2 - 16);
	for (const s of [1, -1]) {
		put(
			g,
			cyl(1.05, 1.25, 5.2, P.stone, `twin_head_${s > 0 ? 'a' : 'b'}`, 12),
			-CW / 2 - 3 + s * 1.5,
			40.6,
			-CD / 2 - 16
		);
		const capT = named(
			new THREE.Mesh(new THREE.ConeGeometry(1.35, 2.6, 12), P.dome),
			`twin_cap_${s > 0 ? 'a' : 'b'}`
		);
		put(g, capT, -CW / 2 - 3 + s * 1.5, 44.5, -CD / 2 - 16);
		put(g, finial(0.3, `twin_${s > 0 ? 'a' : 'b'}`, P.trim), -CW / 2 - 3 + s * 1.5, 46.2, -CD / 2 - 16);
	}
	return g;
}

/* 15 ─ Jama Masjid, Delhi — red sandstone, marble-striped onion domes, twin banded minarets */
function jamaMasjid(): THREE.Group {
	const P = palette({
		stone: mat('delhi_sandstone', 0xb0503a, 0.85),
		stoneDark: mat('sandstone_shadow', 0x8a3a26, 0.9),
		dome: mat('striped_marble_dome', 0xf3efe3, 0.5, 0.05),
		tile: mat('black_marble_stripe', 0x2c2b33, 0.4),
		trim: mat('gilt_finial', 0xd8b04a, 0.35, 0.4)
	});
	const g = group('jama_masjid_delhi');
	const W = 40,
		D = 18,
		H = 15;
	g.add(hall({ w: W, h: H, d: D, P, tag: 'prayer' }));
	// Central pishtaq, taller than the flanking arcade.
	put(g, box(15, H + 6.5, 3.2, P.stone, 'central_pishtaq'), 0, (H + 6.5) / 2, D / 2 + 1.4);
	put(
		g,
		archWall({
			width: 15,
			height: H + 5.5,
			depth: 1.0,
			count: 1,
			archW: 7.0,
			archH: H + 3.5,
			spring: 6.0,
			material: P.stoneDark,
			name: 'pishtaq_arch'
		}),
		0,
		0,
		D / 2 + 3.1
	);
	// Eleven-arch façade either side of it.
	for (const s of [1, -1]) {
		put(
			g,
			archWall({
				width: 12,
				height: 12.5,
				depth: 1.0,
				count: 5,
				archW: 1.9,
				archH: 9.4,
				spring: 4.6,
				material: P.stoneDark,
				name: `facade_arcade_${s > 0 ? 'e' : 'w'}`
			}),
			s * 13.5,
			0,
			D / 2 + 0.6
		);
	}
	// Three bulbous domes, marble with vertical black stripes.
	(
		[
			[0, 8.4],
			[-14.5, 6.2],
			[14.5, 6.2]
		] as [number, number][]
	).forEach(([x, r], i) => {
		put(g, dome({ radius: r, kind: 'ogee', drumH: 3.6, drumR: r * 0.8, tag: 'dome' + i, P }), x, H, 0);
		for (let k = 0; k < 12; k++) {
			const a = (k / 12) * Math.PI * 2;
			const stripe = box(0.34, r * 1.5, 0.34, P.tile, `dome_stripe_${i}_${k}`);
			stripe.rotation.y = a;
			put(g, stripe, Math.sin(a) * r * 0.72, H + 3.6 + r * 0.62, Math.cos(a) * r * 0.72);
		}
	});
	// Chhatri kiosks along the roofline.
	[-24, -19, 19, 24].forEach((x, i) => put(g, chhatri({ r: 1.5, h: 3.4, tag: 'roof' + i, P }), x, H, 0));
	// Two banded minarets, red sandstone striped with marble, at the hall's ends.
	for (const s of [1, -1]) {
		const x = s * (W / 2 + 3.6);
		put(g, minaret({ kind: 'mughal', h: 41, tag: s > 0 ? 'east' : 'west', P }), x, 0, 0);
		for (let k = 0; k < 9; k++) {
			const band = cyl(2.1 - k * 0.06, 2.1 - k * 0.06, 0.5, P.dome, `minaret_band_${s > 0 ? 'e' : 'w'}_${k}`, 16);
			put(g, band, x, 6.5 + k * 2.5, 0);
		}
	}
	// Wide walled courtyard in front, with its gate on the east.
	for (const s of [1, -1]) {
		put(g, box(1.0, 6.0, 34, P.stone, `court_wall_${s > 0 ? 'e' : 'w'}`), s * (W / 2 + 1), 3, D / 2 + 19);
	}
	put(g, box(W, 6.0, 1.0, P.stone, 'court_wall_front'), 0, 3, D / 2 + 36);
	put(g, box(12, 14, 4.0, P.stone, 'east_gate'), 0, 7, D / 2 + 36);
	put(
		g,
		archWall({
			width: 12,
			height: 12.6,
			depth: 0.9,
			count: 1,
			archW: 5.0,
			archH: 10.4,
			spring: 4.6,
			material: P.stoneDark,
			name: 'east_gate_arch'
		}),
		0,
		0,
		D / 2 + 38.1
	);
	return g;
}

/* 16 ─ Great Mosque of Damascus (Umayyad) — gabled transept, Dome of the Eagle, three minarets */
function damascus(): THREE.Group {
	const P = palette({
		stone: mat('damascus_stone', 0xdcd2ba, 0.88),
		stoneDark: mat('stone_shadow', 0xb2a68c, 0.9),
		dome: mat('lead_dome', 0x99a2a8, 0.55, 0.28),
		tile: mat('gold_mosaic', 0xc9a24a, 0.35, 0.5),
		trim: mat('brass_trim', 0xc9a24a, 0.4, 0.5)
	});
	const g = group('umayyad_mosque_damascus');
	const CW = 44,
		CD = 26;
	// Great courtyard, arcaded on three sides.
	for (const s of [1, -1]) {
		const side = archWall({
			width: CD,
			height: 9.0,
			depth: 1.4,
			count: 7,
			archW: 2.4,
			archH: 7.0,
			spring: 3.4,
			material: P.stone,
			name: `riwaq_${s > 0 ? 'e' : 'w'}`
		});
		side.rotation.y = Math.PI / 2;
		put(g, side, (s * CW) / 2, 0, CD / 2);
	}
	put(
		g,
		archWall({
			width: CW,
			height: 9.0,
			depth: 1.4,
			count: 13,
			archW: 2.4,
			archH: 7.0,
			spring: 3.4,
			material: P.stone,
			name: 'riwaq_north'
		}),
		0,
		0,
		CD + 0.7
	);
	// Treasury dome on eight columns, standing in the court.
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * Math.PI * 2;
		put(
			g,
			cyl(0.42, 0.48, 5.0, P.stoneDark, 'treasury_column_' + i),
			-CW / 2 + 9 + Math.sin(a) * 2.4,
			2.5,
			CD / 2 + Math.cos(a) * 2.4
		);
	}
	put(
		g,
		dome({
			radius: 3.0,
			kind: 'hemi',
			drumH: 1.4,
			drumR: 2.6,
			tag: 'treasury',
			P,
			crescent: false,
			finialScale: 0.2
		}),
		-CW / 2 + 9,
		5.0,
		CD / 2
	);
	// Broad prayer hall on the qibla side, three long aisles under a flat roof.
	put(g, hypostyle({ w: CW, d: 17, colH: 8.2, cols: 15, rows: 3, P, tag: 'haram' }), 0, 0, -9);
	put(g, box(CW + 2, 1.8, 19, P.stoneDark, 'haram_roof'), 0, 9.1, -9);
	// The transept: a gabled nave cutting across the hall on the mihrab axis.
	put(g, box(11, 15, 19, P.stone, 'transept_walls'), 0, 7.5, -9);
	const gable = named(new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.4, 19, 3), P.dome), 'transept_gable_roof');
	gable.rotation.x = Math.PI / 2;
	gable.rotation.z = Math.PI;
	put(g, gable, 0, 18.0, -9);
	// Dome of the Eagle over the transept's crossing.
	put(g, cyl(4.6, 4.9, 5.0, P.stone, 'eagle_drum', 16), 0, 17.5, -9);
	put(
		g,
		dome({ radius: 5.4, kind: 'hemi', drumH: 0, drumR: 4.7, windows: 12, tag: 'eagle', P, finialScale: 0.3 }),
		0,
		20.0,
		-9
	);
	// Three minarets of three eras: square Mamluk, octagonal Ottoman, and the Bride.
	put(g, minaret({ kind: 'square', h: 34, tag: 'bride', P }), 0, 0, CD + 2.4);
	put(g, minaret({ kind: 'square', h: 30, tag: 'qaitbay', P }), CW / 2 - 1, 0, -18.5);
	put(g, minaret({ kind: 'ottoman', h: 33, tag: 'isa', P }), -CW / 2 + 1, 0, -18.5);
	return g;
}

/* 17 ─ Masjid Negara, Kuala Lumpur — folded sixteen-point star roof, parasol minaret */
function masjidNegara(): THREE.Group {
	const P = palette({
		stone: mat('white_concrete', 0xf1eee6, 0.7),
		stoneDark: mat('concrete_shadow', 0xcfcabb, 0.8),
		dome: mat('blue_star_roof', 0x2f6f9e, 0.4, 0.25),
		tile: mat('pool_water', 0x2b5f7a, 0.2, 0.4),
		trim: mat('anodised_trim', 0xb9bec6, 0.35, 0.6)
	});
	const g = group('masjid_negara');
	const R = 17;
	// Prayer hall: an open ring of slender piers under the folded roof.
	for (let i = 0; i < 16; i++) {
		const a = (i / 16) * Math.PI * 2;
		put(g, cyl(0.55, 0.62, 11.0, P.stone, 'hall_pier_' + i), Math.sin(a) * R, 5.5, Math.cos(a) * R);
	}
	put(g, cyl(R + 1.2, R + 1.2, 1.2, P.stoneDark, 'hall_slab', 32), 0, 0.6, 0);
	put(g, cyl(R + 0.6, R + 0.6, 1.4, P.stone, 'hall_ring_beam', 32), 0, 11.7, 0);
	// The roof: a sixteen-sided folded concrete star, read as an opened umbrella.
	const star = named(new THREE.Mesh(new THREE.ConeGeometry(R + 3.4, 9.0, 16), P.dome), 'folded_star_roof');
	put(g, star, 0, 16.9, 0);
	for (let i = 0; i < 16; i++) {
		const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
		const point = named(new THREE.Mesh(new THREE.ConeGeometry(1.9, 4.2, 4), P.dome), 'star_point_' + i);
		point.rotation.y = a;
		point.rotation.x = Math.PI;
		put(g, point, Math.sin(a) * (R + 2.6), 13.4, Math.cos(a) * (R + 2.6));
	}
	put(g, finial(1.1, 'star_apex', P.trim), 0, 21.8, 0);
	// Low umbrella pavilions and reflecting pools around the hall.
	(
		[
			[R + 15, 0],
			[-R - 15, 0],
			[0, R + 15],
			[0, -R - 15]
		] as [number, number][]
	).forEach(([x, z], i) => {
		put(g, cyl(0.4, 0.46, 5.6, P.stone, 'umbrella_stem_' + i), x, 2.8, z);
		const canopy = named(new THREE.Mesh(new THREE.ConeGeometry(4.2, 2.2, 16), P.dome), 'umbrella_canopy_' + i);
		put(g, canopy, x, 6.7, z);
	});
	put(g, box(52, 0.3, 12, P.tile, 'reflecting_pool'), 0, 0.15, R + 22);
	// Arcaded screen walls with pierced concrete grilles.
	for (const s of [1, -1]) {
		put(
			g,
			archWall({
				width: 34,
				height: 7.0,
				depth: 0.9,
				count: 11,
				archW: 1.7,
				archH: 5.6,
				spring: 2.8,
				material: P.stone,
				name: `grille_screen_${s > 0 ? 'e' : 'w'}`
			}),
			s * 8,
			0,
			s * (R + 9)
		);
	}
	// Single tapered minaret with a folded parasol crown.
	const mx = R + 24,
		mz = -R - 6;
	put(g, cyl(1.15, 2.3, 46, P.stone, 'minaret_shaft_negara', 20), mx, 23, mz);
	const crownDown = named(new THREE.Mesh(new THREE.ConeGeometry(4.4, 3.4, 16), P.dome), 'minaret_parasol_lower');
	crownDown.rotation.x = Math.PI;
	put(g, crownDown, mx, 47.4, mz);
	const crownUp = named(new THREE.Mesh(new THREE.ConeGeometry(4.0, 5.0, 16), P.dome), 'minaret_parasol_upper');
	put(g, crownUp, mx, 51.4, mz);
	put(g, finial(0.7, 'minaret_negara', P.trim), mx, 55.4, mz);
	return g;
}

/* 18 ─ Imam Muhammad ibn Abd al-Wahhab, Doha — Najdi plainness, a field of small domes */
function dohaGrand(): THREE.Group {
	const P = palette({
		stone: mat('najdi_plaster', 0xe0cfa8, 0.94),
		stoneDark: mat('plaster_shadow', 0xbfa87c, 0.95),
		dome: mat('plaster_dome', 0xd8c69d, 0.92),
		tile: mat('timber_lintel', 0x6f5334, 0.9),
		trim: mat('brass_cap', 0xb99348, 0.45, 0.45)
	});
	const g = group('imam_muhammad_ibn_abd_al_wahhab_mosque');
	const W = 42,
		D = 30,
		H = 12;
	g.add(hall({ w: W, h: H, d: D, P, tag: 'prayer' }));
	g.add(merlons({ len: W, y: H, z: D / 2, count: 26, P, tag: 'front', h: 0.8 }));
	g.add(merlons({ len: W, y: H, z: -D / 2, count: 26, P, tag: 'back', h: 0.8 }));
	// Ninety-odd shallow plaster domes stepping across the roof.
	const cols = 9,
		rows = 6;
	for (let i = 0; i < cols; i++)
		for (let j = 0; j < rows; j++) {
			const x = -W / 2 + (W / cols) * (i + 0.5);
			const z = -D / 2 + (D / rows) * (j + 0.5);
			const mid = i === (cols - 1) / 2 && j === 0;
			put(
				g,
				dome({
					radius: mid ? 4.4 : 2.1,
					kind: 'hemi',
					drumH: mid ? 2.4 : 0.9,
					drumR: mid ? 3.8 : 1.9,
					tag: `roof_${i}_${j}`,
					P,
					crescent: false,
					finialScale: 0
				}),
				x,
				H,
				z
			);
		}
	// Deep arcaded riwaq wrapping the courtyard side.
	put(
		g,
		archWall({
			width: W,
			height: 9.0,
			depth: 1.5,
			count: 13,
			archW: 2.1,
			archH: 7.0,
			spring: 3.4,
			material: P.stone,
			name: 'riwaq_front'
		}),
		0,
		0,
		D / 2 + 8
	);
	for (const s of [1, -1]) {
		const side = archWall({
			width: 16,
			height: 9.0,
			depth: 1.5,
			count: 5,
			archW: 2.1,
			archH: 7.0,
			spring: 3.4,
			material: P.stone,
			name: `riwaq_${s > 0 ? 'e' : 'w'}`
		});
		side.rotation.y = Math.PI / 2;
		put(g, side, (s * W) / 2, 0, D / 2 + 8);
	}
	// One square minaret with a spiral external stair, Najdi in its plainness.
	const mx = -W / 2 - 5,
		mz = D / 2 + 6;
	put(g, minaret({ kind: 'square', h: 44, tag: 'doha', P }), mx, 0, mz);
	for (let i = 0; i < 34; i++) {
		const t = i / 34,
			a = t * Math.PI * 5;
		const r = 2.6 - t * 0.5;
		const step = box(1.5, 0.34, 1.5, P.stoneDark, 'spiral_step_' + i);
		step.rotation.y = a;
		put(g, step, mx + Math.sin(a) * r, 3.5 + t * 28, mz + Math.cos(a) * r);
	}
	return g;
}

/* 19 ─ Gazi Husrev-beg, Sarajevo — classical Ottoman single dome and stone porch */
function gaziHusrevBeg(): THREE.Group {
	const P = palette({
		stone: mat('bosnian_limestone', 0xdad2c0, 0.86),
		stoneDark: mat('limestone_shadow', 0xb0a68f, 0.9),
		dome: mat('lead_sheet', 0x8f99a3, 0.5, 0.32),
		tile: mat('leaded_window', 0x3f4a58, 0.35, 0.2),
		trim: mat('gilt_alem', 0xc9a24a, 0.35, 0.5)
	});
	const g = group('gazi_husrev_beg_mosque');
	const S = 17,
		H = 13;
	g.add(hall({ w: S, h: H, d: S, P, tag: 'main' }));
	// Squinch tier stepping the square up to the drum.
	put(g, box(S - 2.4, 2.6, S - 2.4, P.stone, 'squinch_tier'), 0, H + 1.3, 0);
	(
		[
			[1, 1],
			[1, -1],
			[-1, 1],
			[-1, -1]
		] as [number, number][]
	).forEach(([sx, sz], i) => {
		const w = named(new THREE.Mesh(new THREE.ConeGeometry(2.0, 2.6, 4), P.dome), 'corner_weight_' + i);
		w.rotation.y = Math.PI / 4;
		put(g, w, sx * (S / 2 - 1.4), H + 3.9, sz * (S / 2 - 1.4));
	});
	put(
		g,
		dome({ radius: 8.4, kind: 'hemi', drumH: 2.8, drumR: 7.4, windows: 12, tag: 'main', P, finialScale: 0.34 }),
		0,
		H + 2.6,
		0
	);
	// Three-domed stone porch over the entrance.
	put(g, box(S, 8.0, 6.4, P.stone, 'porch_back'), 0, 4.0, S / 2 + 3.2);
	put(
		g,
		archWall({
			width: S,
			height: 8.0,
			depth: 1.2,
			count: 3,
			archW: 3.6,
			archH: 6.4,
			spring: 3.2,
			material: P.stoneDark,
			name: 'porch_arcade'
		}),
		0,
		0,
		S / 2 + 6.4
	);
	[-5.4, 0, 5.4].forEach((x, i) => {
		put(
			g,
			dome({
				radius: 2.5,
				kind: 'hemi',
				drumH: 0.9,
				drumR: 2.2,
				tag: 'porch' + i,
				P,
				crescent: false,
				finialScale: 0
			}),
			x,
			8.0,
			S / 2 + 3.2
		);
	});
	// Sadrvan ablution fountain in the forecourt, under its own little roof.
	const fx = 0,
		fz = S / 2 + 16;
	put(g, cyl(2.2, 2.5, 1.4, P.stoneDark, 'sadrvan_basin', 12), fx, 0.7, fz);
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * Math.PI * 2;
		put(g, cyl(0.22, 0.26, 4.0, P.stone, 'sadrvan_post_' + i), fx + Math.sin(a) * 2.9, 2.0, fz + Math.cos(a) * 2.9);
	}
	const froof = named(new THREE.Mesh(new THREE.ConeGeometry(3.9, 2.4, 6), P.dome), 'sadrvan_roof');
	put(g, froof, fx, 5.2, fz);
	// Single pencil minaret with one balcony.
	put(g, minaret({ kind: 'ottoman', h: 45, tag: 'sarajevo', P }), S / 2 + 3.4, 0, S / 2 + 1.4);
	// Low walled graveyard court with turbe domes.
	for (const s of [1, -1]) {
		put(g, box(0.7, 2.6, 26, P.stone, `court_wall_${s > 0 ? 'e' : 'w'}`), s * (S / 2 + 7), 1.3, S / 2 + 9);
	}
	(
		[
			[-S / 2 - 4, S / 2 + 8],
			[-S / 2 - 4, S / 2 + 14]
		] as [number, number][]
	).forEach(([x, z], i) => {
		put(g, box(4.4, 4.0, 4.4, P.stone, 'turbe_' + i), x, 2.0, z);
		put(
			g,
			dome({
				radius: 2.4,
				kind: 'hemi',
				drumH: 0.6,
				drumR: 2.1,
				tag: 'turbe' + i,
				P,
				crescent: false,
				finialScale: 0.18
			}),
			x,
			4.0,
			z
		);
	});
	return g;
}

/* 20 ─ Lagos Central Mosque — contemporary West African, dome on four corner minarets */
function lagosCentral(): THREE.Group {
	const P = palette({
		stone: mat('cream_render', 0xece3cf, 0.85),
		stoneDark: mat('render_shadow', 0xc3b696, 0.88),
		dome: mat('lagos_green_dome', 0x2f6b48, 0.42, 0.3),
		tile: mat('green_trim', 0x27573a, 0.4, 0.2),
		trim: mat('gilt', 0xd0a94c, 0.35, 0.45)
	});
	const g = group('lagos_central_mosque');
	const W = 30,
		D = 26,
		H = 16;
	g.add(hall({ w: W, h: H, d: D, P, tag: 'prayer' }));
	// Two-storey arcaded façade with a projecting entrance porch.
	put(
		g,
		archWall({
			width: W,
			height: 8.0,
			depth: 1.2,
			count: 7,
			archW: 2.6,
			archH: 6.4,
			spring: 3.2,
			material: P.stoneDark,
			name: 'facade_lower'
		}),
		0,
		0,
		D / 2 + 0.6
	);
	put(
		g,
		archWall({
			width: W,
			height: 7.0,
			depth: 1.2,
			count: 7,
			archW: 2.3,
			archH: 5.6,
			spring: 2.9,
			material: P.stoneDark,
			name: 'facade_upper'
		}),
		0,
		8.0,
		D / 2 + 0.6
	);
	put(g, box(11, 13, 4.4, P.stone, 'entrance_porch'), 0, 6.5, D / 2 + 3.2);
	put(
		g,
		archWall({
			width: 11,
			height: 12.0,
			depth: 0.9,
			count: 1,
			archW: 4.6,
			archH: 10.0,
			spring: 4.4,
			material: P.stoneDark,
			name: 'porch_arch'
		}),
		0,
		0,
		D / 2 + 5.5
	);
	// Large green central dome, with four small ones over the corners.
	put(g, dome({ radius: 10.4, kind: 'ogee', drumH: 5.2, drumR: 9.0, windows: 14, tag: 'central', P }), 0, H, 0);
	(
		[
			[1, 1],
			[1, -1],
			[-1, 1],
			[-1, -1]
		] as [number, number][]
	).forEach(([sx, sz], i) => {
		put(
			g,
			dome({
				radius: 3.0,
				kind: 'ogee',
				drumH: 1.8,
				drumR: 2.6,
				tag: 'corner' + i,
				P,
				crescent: false,
				finialScale: 0.22
			}),
			sx * 11.5,
			H,
			sz * 10.0
		);
	});
	// Four corner minarets, green-capped.
	(
		[
			[1, 1],
			[1, -1],
			[-1, 1],
			[-1, -1]
		] as [number, number][]
	).forEach(([sx, sz], i) => {
		put(g, minaret({ kind: 'ottoman', h: 34, tag: 'lagos' + i, P }), sx * (W / 2 + 3.2), 0, sz * (D / 2 + 3.2));
	});
	return g;
}

/* 21 ─ Bibi-Khanym, Samarkand — colossal Timurid portal, ribbed melon dome */
function bibiKhanym(): THREE.Group {
	const P = palette({
		stone: mat('timurid_brick', 0xc9a878, 0.9),
		stoneDark: mat('brick_shadow', 0xa2825a, 0.92),
		dome: mat('samarkand_turquoise', 0x2a9ec4, 0.35, 0.3),
		tile: mat('cobalt_tile', 0x1b4a9c, 0.35, 0.2),
		trim: mat('gilt', 0xd0a94c, 0.35, 0.45)
	});
	const g = group('bibi_khanym_mosque');
	const CW = 30,
		CD = 34;
	// Courtyard walls, plain fired brick between the four structures.
	for (const s of [1, -1]) {
		put(g, box(1.6, 11, CD, P.stone, `court_wall_${s > 0 ? 'e' : 'w'}`), (s * CW) / 2, 5.5, 0);
	}
	// Colossal entrance portal, with a corner minaret at each flank.
	const portal = iwan({ w: 20, h: 30, depth: 4.4, P, tag: 'entrance' });
	portal.rotation.y = Math.PI;
	put(g, portal, 0, 0, CD / 2 + 2.2);
	for (const s of [1, -1]) {
		put(g, minaret({ kind: 'persian', h: 27, tag: s > 0 ? 'portal_e' : 'portal_w', P }), s * 11.4, 0, CD / 2 + 2.6);
	}
	// Main sanctuary opposite: high iwan, then the ribbed melon dome on its drum.
	put(g, iwan({ w: 18, h: 26, depth: 4.0, P, tag: 'sanctuary' }), 0, 0, -CD / 2 - 2.0);
	put(g, box(24, 20, 20, P.stone, 'sanctuary_block'), 0, 10, -CD / 2 - 12);
	put(g, cyl(8.0, 8.6, 12.0, P.tile, 'melon_drum', 24), 0, 26, -CD / 2 - 12);
	put(
		g,
		dome({ radius: 9.4, kind: 'pointed', drumH: 0, drumR: 8.2, ribs: 22, tag: 'melon', P, finialScale: 0.42 }),
		0,
		32,
		-CD / 2 - 12
	);
	for (const s of [1, -1]) {
		put(g, minaret({ kind: 'persian', h: 24, tag: s > 0 ? 'sanct_e' : 'sanct_w', P }), s * 12.6, 0, -CD / 2 - 3.0);
	}
	// Two smaller domed halls on the court's flanks.
	for (const s of [1, -1]) {
		put(g, box(16, 13, 16, P.stone, `side_hall_${s > 0 ? 'e' : 'w'}`), s * (CW / 2 + 8), 6.5, 0);
		put(g, cyl(4.6, 5.0, 6.0, P.tile, `side_drum_${s > 0 ? 'e' : 'w'}`, 20), s * (CW / 2 + 8), 16, 0);
		put(
			g,
			dome({
				radius: 5.4,
				kind: 'pointed',
				drumH: 0,
				drumR: 4.8,
				ribs: 16,
				tag: s > 0 ? 'side_e' : 'side_w',
				P,
				finialScale: 0.26
			}),
			s * (CW / 2 + 8),
			19,
			0
		);
		const si = iwan({ w: 9, h: 13, depth: 2.2, P, tag: s > 0 ? 'side_iwan_e' : 'side_iwan_w' });
		si.rotation.y = (-s * Math.PI) / 2;
		put(g, si, s * (CW / 2 - 0.2), 0, 0);
	}
	// The great marble Quran stand in the middle of the court.
	put(g, box(4.0, 1.5, 3.0, P.stoneDark, 'quran_stand_base'), 0, 0.75, 0);
	for (const s of [1, -1]) {
		const leaf = box(3.4, 0.4, 2.6, P.stoneDark, `quran_stand_leaf_${s > 0 ? 'a' : 'b'}`);
		leaf.rotation.x = s * 0.5;
		put(g, leaf, 0, 1.9, s * 0.5);
	}
	return g;
}

/* 22 ─ Imam Reza Shrine, Mashhad — golden dome, Iwan of Gold, twin gilt minarets */
function imamReza(): THREE.Group {
	const P = palette({
		stone: mat('mashhad_stone', 0xe6dcc2, 0.82),
		stoneDark: mat('stone_shadow', 0xc0b393, 0.88),
		dome: mat('gold_leaf_dome', 0xd9a83a, 0.3, 0.72),
		tile: mat('persian_turquoise', 0x2a9ba8, 0.35, 0.25),
		trim: mat('gold_trim', 0xe0b64a, 0.28, 0.75)
	});
	const g = group('imam_reza_shrine');
	const CW = 30,
		CD = 30;
	// Sahn of the shrine, two-storey arcades all round.
	g.add(
		arcadeRing({
			w: CW,
			d: CD,
			height: 8.2,
			depth: 1.5,
			step: 3.8,
			archW: 2.3,
			archH: 6.4,
			spring: 3.2,
			material: P.stone,
			tag: 'sahn_lower'
		})
	);
	put(
		g,
		arcadeRing({
			w: CW,
			d: CD,
			height: 7.0,
			depth: 1.5,
			step: 3.8,
			archW: 2.1,
			archH: 5.4,
			spring: 2.8,
			material: P.stoneDark,
			tag: 'sahn_upper'
		}),
		0,
		8.2,
		0
	);
	// The Iwan of Gold, its whole face and flanking minarets gilded.
	const gold = iwan({ w: 15, h: 21, depth: 3.0, P, tag: 'gold' });
	gold.traverse(o => {
		if ((o as THREE.Mesh).isMesh && /frame|screen|wall/.test(o.name)) (o as THREE.Mesh).material = P.trim;
	});
	put(g, gold, 0, 0, -CD / 2 - 1.5);
	for (const s of [1, -1]) {
		const m = minaret({ kind: 'persian', h: 34, tag: s > 0 ? 'gold_e' : 'gold_w', P });
		m.traverse(o => {
			if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = P.trim;
		});
		put(g, m, s * 8.8, 0, -CD / 2 - 2.2);
	}
	// Shrine chamber and the golden dome on its high drum.
	const sz = -CD / 2 - 3 - 11;
	put(g, box(22, 16, 22, P.stone, 'shrine_chamber'), 0, 8, sz);
	put(g, cyl(6.4, 6.8, 9.0, P.trim, 'gold_drum', 20), 0, 20.5, sz);
	put(g, dome({ radius: 7.6, kind: 'ogee', drumH: 0, drumR: 6.6, tag: 'golden', P, finialScale: 0.4 }), 0, 25, sz);
	// Turquoise-tiled iwans on the court's three other sides.
	const front = iwan({ w: 13, h: 17, depth: 2.6, P, tag: 'front' });
	front.rotation.y = Math.PI;
	put(g, front, 0, 0, CD / 2 + 1.5);
	for (const s of [1, -1]) {
		const si = iwan({ w: 12, h: 16, depth: 2.4, P, tag: s > 0 ? 'east' : 'west' });
		si.rotation.y = (s * Math.PI) / 2;
		put(g, si, s * (CW / 2 + 1.4), 0, 0);
	}
	// Marble pool at the centre of the sahn.
	put(g, box(8.0, 0.4, 8.0, P.tile, 'sahn_pool'), 0, 0.2, 0);
	return g;
}

/* 23 ─ Istiqlal, Jakarta — one vast shallow steel dome on a slab hall */
function istiqlal(): THREE.Group {
	const P = palette({
		stone: mat('jakarta_marble', 0xefece3, 0.68, 0.05),
		stoneDark: mat('marble_shadow', 0xcbc6b8, 0.78),
		dome: mat('stainless_dome', 0xc2c8ce, 0.3, 0.7),
		tile: mat('bronze_glazing', 0x4a5560, 0.35, 0.35),
		trim: mat('steel_trim', 0xa9b0b8, 0.3, 0.65)
	});
	const g = group('istiqlal_mosque');
	const W = 40,
		D = 40,
		H = 19;
	// Rectangular prayer hall: five slab storeys of galleries behind deep piers.
	g.add(hall({ w: W, h: H, d: D, P, tag: 'prayer' }));
	for (let i = 0; i < 5; i++) {
		put(g, box(W + 1.6, 0.5, D + 1.6, P.stoneDark, 'gallery_slab_' + i), 0, 3.4 + i * 3.4, 0);
	}
	for (let i = 0; i < 11; i++) {
		const x = -W / 2 + (W / 10) * i;
		for (const s of [1, -1])
			put(g, box(1.1, H, 1.1, P.stone, `pier_${i}_${s > 0 ? 'n' : 's'}`), x, H / 2, (s * D) / 2);
	}
	for (let j = 1; j < 10; j++) {
		const z = -D / 2 + (D / 10) * j;
		for (const s of [1, -1])
			put(g, box(1.1, H, 1.1, P.stone, `pier_side_${j}_${s > 0 ? 'e' : 'w'}`), (s * W) / 2, H / 2, z);
	}
	// The dome: 45 m across, very shallow, stainless clad, on a low ring.
	put(g, cyl(19.5, 20.2, 2.6, P.stone, 'dome_ring', 40), 0, H + 1.3, 0);
	put(
		g,
		dome({ radius: 21.0, kind: 'shallow', drumH: 0, drumR: 19.4, tag: 'great', P, finialScale: 0.46 }),
		0,
		H + 2.6,
		0
	);
	// Wide covered veranda, and the low arcaded courtyard wall.
	put(g, box(W + 26, 7.0, 16, P.stone, 'veranda_slab'), 0, 6.6, D / 2 + 14);
	for (let i = 0; i < 15; i++) {
		put(g, box(1.0, 6.6, 1.0, P.stone, 'veranda_pier_' + i), -W / 2 - 12 + i * ((W + 24) / 14), 3.3, D / 2 + 21.6);
	}
	put(g, box(W + 26, 0.35, 9, P.tile, 'court_paving'), 0, 0.17, D / 2 + 28);
	// One slender cylindrical minaret standing clear of the hall.
	const mx = -W / 2 - 17,
		mz = D / 2 + 6;
	put(g, cyl(1.3, 1.9, 56, P.stone, 'minaret_shaft_istiqlal', 24), mx, 28, mz);
	for (let i = 0; i < 5; i++) {
		put(g, cyl(2.1, 2.1, 0.4, P.trim, 'minaret_band_' + i), mx, 12 + i * 9, mz);
	}
	put(g, cyl(2.4, 2.4, 3.0, P.tile, 'minaret_gallery_istiqlal', 24), mx, 57.5, mz);
	const cap = named(new THREE.Mesh(new THREE.SphereGeometry(2.3, 20, 12), P.dome), 'minaret_cap_istiqlal');
	cap.scale.y = 0.7;
	put(g, cap, mx, 59.6, mz);
	put(g, finial(0.5, 'istiqlal', P.trim), mx, 61.6, mz);
	return g;
}

/* 24 ─ Zaytuna, Tunis — Aghlabid hypostyle under a tiered square minaret */
function zaytuna(): THREE.Group {
	const P = palette({
		stone: mat('tunis_stone', 0xe2d6ba, 0.88),
		stoneDark: mat('stone_shadow', 0xb9aa8b, 0.9),
		dome: mat('ribbed_dome', 0xd8caa8, 0.86),
		tile: mat('green_tile', 0x2f6b4a, 0.4, 0.2),
		trim: mat('brass', 0xc2a04a, 0.4, 0.5)
	});
	const g = group('zaytuna_mosque');
	const W = 32,
		D = 22;
	// Hypostyle hall of reused antique columns, under a flat parapeted roof.
	put(g, hypostyle({ w: W, d: D, colH: 8.0, cols: 11, rows: 5, P, tag: 'haram' }), 0, 0, -8);
	put(g, box(W + 2, 1.6, D + 2, P.stoneDark, 'haram_roof'), 0, 8.8, -8);
	g.add(merlons({ len: W + 2, y: 9.6, z: -8 + (D + 2) / 2, count: 22, P, tag: 'roof_front', h: 0.7 }));
	// Ribbed dome over the mihrab bay, and one over the court's entrance bay.
	put(
		g,
		dome({
			radius: 4.6,
			kind: 'hemi',
			drumH: 3.0,
			drumR: 4.0,
			ribs: 20,
			tag: 'mihrab',
			P,
			crescent: false,
			finialScale: 0.28
		}),
		0,
		9.6,
		-8 - D / 2 + 3.5
	);
	put(
		g,
		dome({
			radius: 3.4,
			kind: 'hemi',
			drumH: 2.2,
			drumR: 3.0,
			ribs: 16,
			tag: 'bahw',
			P,
			crescent: false,
			finialScale: 0.22
		}),
		0,
		9.6,
		-8 + D / 2 - 2.5
	);
	// Courtyard, arcaded on three sides, its paving sloping to the cisterns.
	put(
		g,
		archWall({
			width: W,
			height: 8.4,
			depth: 1.4,
			count: 11,
			archW: 2.1,
			archH: 6.6,
			spring: 3.2,
			material: P.stone,
			name: 'sahn_north'
		}),
		0,
		0,
		16
	);
	for (const s of [1, -1]) {
		const side = archWall({
			width: 20,
			height: 8.4,
			depth: 1.4,
			count: 6,
			archW: 2.1,
			archH: 6.6,
			spring: 3.2,
			material: P.stone,
			name: `sahn_${s > 0 ? 'e' : 'w'}`
		});
		side.rotation.y = Math.PI / 2;
		put(g, side, (s * W) / 2, 0, 6);
	}
	put(g, box(W - 4, 0.3, 16, P.stoneDark, 'sahn_paving'), 0, 0.15, 6);
	// The square minaret at the court's north-west corner, tiered with a lantern.
	const mx = -W / 2 - 2.4,
		mz = 15;
	put(g, minaret({ kind: 'square', h: 40, tag: 'zaytuna', P }), mx, 0, mz);
	put(g, box(4.4, 4.0, 4.4, P.stone, 'minaret_lantern_zaytuna'), mx, 36.5, mz);
	put(
		g,
		dome({
			radius: 2.4,
			kind: 'ogee',
			drumH: 0.8,
			drumR: 2.0,
			tag: 'lantern',
			P,
			crescent: false,
			finialScale: 0.22
		}),
		mx,
		38.5,
		mz
	);
	return g;
}

/* 25 ─ Jumeirah, Dubai — Fatimid revival in carved stone, twin matched minarets */
function jumeirah(): THREE.Group {
	const P = palette({
		stone: mat('carved_sandstone', 0xe4d3ae, 0.88),
		stoneDark: mat('carving_shadow', 0xbfa87f, 0.9),
		dome: mat('stone_dome', 0xdcc9a4, 0.86),
		tile: mat('teak_door', 0x6b4a2b, 0.85),
		trim: mat('brass_crescent', 0xc2a04a, 0.4, 0.5)
	});
	const g = group('jumeirah_mosque');
	const W = 20,
		D = 16,
		H = 11;
	g.add(hall({ w: W, h: H, d: D, P, tag: 'prayer' }));
	g.add(merlons({ len: W, y: H, z: D / 2, count: 14, P, tag: 'front', h: 0.7 }));
	g.add(merlons({ len: W, y: H, z: -D / 2, count: 14, P, tag: 'back', h: 0.7 }));
	// Central dome on a stepped octagonal drum, with four corner cupolas.
	put(g, box(11, 2.2, 11, P.stone, 'dome_pedestal'), 0, H + 1.1, 0);
	put(g, cyl(4.6, 5.0, 3.4, P.stone, 'dome_drum_octagon', 8), 0, H + 3.9, 0);
	put(
		g,
		dome({ radius: 5.4, kind: 'ogee', drumH: 0, drumR: 4.7, tag: 'central', P, finialScale: 0.3 }),
		0,
		H + 5.6,
		0
	);
	(
		[
			[1, 1],
			[1, -1],
			[-1, 1],
			[-1, -1]
		] as [number, number][]
	).forEach(([sx, sz], i) => {
		put(g, cyl(1.5, 1.7, 2.4, P.stone, 'cupola_drum_' + i, 8), sx * 7.4, H + 1.2, sz * 5.6);
		put(
			g,
			dome({
				radius: 1.8,
				kind: 'ogee',
				drumH: 0,
				drumR: 1.6,
				tag: 'cupola' + i,
				P,
				crescent: false,
				finialScale: 0.16
			}),
			sx * 7.4,
			H + 2.4,
			sz * 5.6
		);
	});
	// Deeply carved entrance screen, keel-arched, with a teak door.
	put(g, box(9.4, 12.5, 2.6, P.stone, 'entrance_screen'), 0, 6.25, D / 2 + 1.3);
	put(
		g,
		archWall({
			width: 9.4,
			height: 11.6,
			depth: 0.9,
			count: 1,
			archW: 4.2,
			archH: 9.8,
			spring: 4.2,
			material: P.stoneDark,
			name: 'entrance_keel_arch'
		}),
		0,
		0,
		D / 2 + 2.9
	);
	put(g, box(3.0, 5.4, 0.3, P.tile, 'teak_door'), 0, 2.7, D / 2 + 2.7);
	// Carved window screens down the flanks.
	for (const s of [1, -1]) {
		const scr = archWall({
			width: D - 2,
			height: 8.0,
			depth: 0.7,
			count: 4,
			archW: 1.5,
			archH: 6.0,
			spring: 3.0,
			material: P.stoneDark,
			name: `window_screen_${s > 0 ? 'e' : 'w'}`
		});
		scr.rotation.y = Math.PI / 2;
		put(g, scr, s * (W / 2 + 0.3), 1.4, 0);
	}
	// Twin matched minarets flanking the façade — the mosque's signature symmetry.
	for (const s of [1, -1]) {
		put(g, minaret({ kind: 'ottoman', h: 32, tag: s > 0 ? 'east' : 'west', P }), s * (W / 2 + 2.8), 0, D / 2 + 1.4);
	}
	return g;
}

/* 26 ─ Bamako Grand Mosque — twin banded square towers over a plain green-roofed hall */
function bamako(): THREE.Group {
	const P = palette({
		stone: mat('bamako_render', 0xeee7d4, 0.88),
		stoneDark: mat('render_shadow', 0xc8bda2, 0.9),
		dome: mat('green_roof', 0x2c6b45, 0.45, 0.2),
		tile: mat('green_band', 0x24583a, 0.45),
		trim: mat('gilt', 0xc9a44c, 0.38, 0.45)
	});
	const g = group('bamako_grand_mosque');
	const W = 34,
		D = 24,
		H = 13;
	g.add(hall({ w: W, h: H, d: D, P, tag: 'prayer' }));
	// Shallow green hipped roof over the hall.
	const roof = named(new THREE.Mesh(new THREE.ConeGeometry(W * 0.72, 5.0, 4), P.dome), 'hipped_roof');
	roof.rotation.y = Math.PI / 4;
	put(g, roof, 0, H + 2.5, 0);
	// Arcaded galleries on three sides, plain pointed arches.
	put(
		g,
		archWall({
			width: W,
			height: 8.0,
			depth: 1.3,
			count: 9,
			archW: 2.4,
			archH: 6.4,
			spring: 3.2,
			material: P.stoneDark,
			name: 'gallery_front'
		}),
		0,
		0,
		D / 2 + 4.6
	);
	for (const s of [1, -1]) {
		const side = archWall({
			width: D + 8,
			height: 8.0,
			depth: 1.3,
			count: 8,
			archW: 2.4,
			archH: 6.4,
			spring: 3.2,
			material: P.stoneDark,
			name: `gallery_${s > 0 ? 'e' : 'w'}`
		});
		side.rotation.y = Math.PI / 2;
		put(g, side, s * (W / 2 + 4.4), 0, 1);
	}
	put(g, box(W + 10, 0.35, 14, P.stoneDark, 'forecourt_paving'), 0, 0.17, D / 2 + 13);
	// Two tall square towers flanking the entrance, banded in green.
	for (const s of [1, -1]) {
		const mx = s * (W / 2 - 1);
		const mz = D / 2 + 5.2;
		put(g, minaret({ kind: 'square', h: 40, tag: s > 0 ? 'east' : 'west', P }), mx, 0, mz);
		for (let k = 0; k < 6; k++) {
			put(
				g,
				box(4.3 - k * 0.12, 0.5, 4.3 - k * 0.12, P.tile, `tower_band_${s > 0 ? 'e' : 'w'}_${k}`),
				mx,
				6.0 + k * 5.0,
				mz
			);
		}
		const spire = named(
			new THREE.Mesh(new THREE.ConeGeometry(2.4, 5.2, 4), P.dome),
			`tower_spire_${s > 0 ? 'e' : 'w'}`
		);
		spire.rotation.y = Math.PI / 4;
		put(g, spire, mx, 38.6, mz);
		put(g, finial(0.4, `bamako_${s > 0 ? 'e' : 'w'}`, P.trim), mx, 42.0, mz);
	}
	// Entrance porch between the towers.
	put(g, box(13, 11, 3.4, P.stone, 'entrance_porch'), 0, 5.5, D / 2 + 5.2);
	put(
		g,
		archWall({
			width: 13,
			height: 10.2,
			depth: 0.9,
			count: 1,
			archW: 5.2,
			archH: 8.6,
			spring: 3.8,
			material: P.stoneDark,
			name: 'porch_arch'
		}),
		0,
		0,
		D / 2 + 7.0
	);
	return g;
}

/** The twenty-six, in the design's own order. */
export interface MosqueEntry {
	key: string;
	name: string;
	city: string;
	era: string;
	note: string;
	build: () => THREE.Group;
}

export const DESIGN_MOSQUES: MosqueEntry[] = [
	{
		key: 'sultan-ahmed',
		name: 'Sultan Ahmed (Blue Mosque)',
		city: 'Istanbul, Türkiye',
		era: '1616',
		note: 'Cascading Ottoman domes, six fluted minarets',
		build: blueMosque
	},
	{
		key: 'hagia-sophia',
		name: 'Aya Sofya (Hagia Sophia)',
		city: 'Istanbul, Türkiye',
		era: '537',
		note: 'Byzantine pendentive dome, buttressed rose walls',
		build: hagiaSophia
	},
	{
		key: 'sheikh-zayed',
		name: 'Sheikh Zayed',
		city: 'Abu Dhabi, UAE',
		era: '2007',
		note: 'White marble, 82 domes over the riwaq',
		build: sheikhZayed
	},
	{
		key: 'faisal',
		name: 'Faisal Mosque',
		city: 'Islamabad, Pakistan',
		era: '1986',
		note: 'Bedouin tent of eight folded shells',
		build: faisalMosque
	},
	{
		key: 'djenne',
		name: 'Great Mosque of Djenné',
		city: 'Djenné, Mali',
		era: '1907',
		note: 'Three mud towers engaged in the qibla wall',
		build: djenne
	},
	{
		key: 'hassan-ii',
		name: 'Hassan II',
		city: 'Casablanca, Morocco',
		era: '1993',
		note: 'Maghrebi square minaret, 210 m tall',
		build: hassanII
	},
	{
		key: 'shah',
		name: 'Shah (Imam) Mosque',
		city: 'Isfahan, Iran',
		era: '1629',
		note: 'Four-iwan court turned 45° onto the qibla',
		build: shahMosque
	},
	{
		key: 'badshahi',
		name: 'Badshahi Mosque',
		city: 'Lahore, Pakistan',
		era: '1673',
		note: 'Red sandstone with three marble onion domes',
		build: badshahi
	},
	{
		key: 'kairouan',
		name: 'Great Mosque of Kairouan',
		city: 'Kairouan, Tunisia',
		era: '836',
		note: 'Oldest hypostyle plan in the Maghreb',
		build: kairouan
	},
	{
		key: 'samarra',
		name: 'Great Mosque of Samarra',
		city: 'Samarra, Iraq',
		era: '851',
		note: 'Walled enclosure and the spiral Malwiya',
		build: samarra
	},
	{
		key: 'kul-sharif',
		name: 'Kul Sharif',
		city: 'Kazan, Tatarstan',
		era: '2005',
		note: 'Turquoise Kazan-cap cupola on crossed squares',
		build: kulSharif
	},
	{
		key: 'xian',
		name: "Great Mosque of Xi'an",
		city: "Xi'an, China",
		era: '1392',
		note: 'Ming courtyard pavilions, timber minaret tower',
		build: xian
	},
	{
		key: 'al-aqsa',
		name: 'Al-Aqsa Mosque',
		city: 'Jerusalem',
		era: '705',
		note: 'Silver lead dome over a seven-arch façade',
		build: alAqsa
	},
	{
		key: 'al-azhar',
		name: 'Al-Azhar',
		city: 'Cairo, Egypt',
		era: '970',
		note: 'Fatimid court, five minarets of five dates',
		build: alAzhar
	},
	{
		key: 'jama-masjid',
		name: 'Jama Masjid',
		city: 'Delhi, India',
		era: '1656',
		note: 'Marble-striped domes, banded twin minarets',
		build: jamaMasjid
	},
	{
		key: 'damascus',
		name: 'Great Mosque of Damascus',
		city: 'Damascus, Syria',
		era: '715',
		note: 'Gabled Umayyad transept, Dome of the Eagle',
		build: damascus
	},
	{
		key: 'masjid-negara',
		name: 'Masjid Negara',
		city: 'Kuala Lumpur, Malaysia',
		era: '1965',
		note: 'Folded sixteen-point star roof, parasol minaret',
		build: masjidNegara
	},
	{
		key: 'doha-grand',
		name: 'Imam Muhammad ibn Abd al-Wahhab',
		city: 'Doha, Qatar',
		era: '2011',
		note: 'Najdi plainness under a field of small domes',
		build: dohaGrand
	},
	{
		key: 'gazi-husrev-beg',
		name: 'Gazi Husrev-beg',
		city: 'Sarajevo, Bosnia',
		era: '1531',
		note: 'Ottoman single dome, three-domed stone porch',
		build: gaziHusrevBeg
	},
	{
		key: 'lagos-central',
		name: 'Lagos Central Mosque',
		city: 'Lagos, Nigeria',
		era: '2010',
		note: 'Green dome on a two-storey arcaded façade',
		build: lagosCentral
	},
	{
		key: 'bibi-khanym',
		name: 'Bibi-Khanym',
		city: 'Samarkand, Uzbekistan',
		era: '1404',
		note: 'Colossal Timurid portal, ribbed melon dome',
		build: bibiKhanym
	},
	{
		key: 'imam-reza',
		name: 'Imam Reza Shrine',
		city: 'Mashhad, Iran',
		era: '1418',
		note: 'Golden dome and the gilded Iwan of Gold',
		build: imamReza
	},
	{
		key: 'istiqlal',
		name: 'Istiqlal',
		city: 'Jakarta, Indonesia',
		era: '1978',
		note: 'One 45 m stainless dome on a slab hall',
		build: istiqlal
	},
	{
		key: 'zaytuna',
		name: 'Zaytuna',
		city: 'Tunis, Tunisia',
		era: '856',
		note: 'Aghlabid hypostyle under a tiered square tower',
		build: zaytuna
	},
	{
		key: 'jumeirah',
		name: 'Jumeirah',
		city: 'Dubai, UAE',
		era: '1979',
		note: 'Fatimid revival in deeply carved stone',
		build: jumeirah
	},
	{
		key: 'bamako',
		name: 'Bamako Grand Mosque',
		city: 'Bamako, Mali',
		era: '1977',
		note: 'Twin banded towers over a green hipped roof',
		build: bamako
	}
];

export type DesignMosqueKey = (typeof DESIGN_MOSQUES)[number]['key'];

const BUILDERS = new Map(DESIGN_MOSQUES.map(m => [m.key, m.build]));

export function buildDesignMosque(key: string): THREE.Group {
	const build = BUILDERS.get(key) ?? DESIGN_MOSQUES[0].build;
	const model = build();
	model.traverse(o => {
		if ((o as THREE.Mesh).isMesh) {
			o.castShadow = true;
			o.receiveShadow = true;
		}
	});
	return model;
}

/**
 * The model's ground extent in metres, measured rather than declared.
 *
 * The layer scales every building by this so a 40 m courtyard mosque and a 60 m
 * tent read at the same size on screen. Taking it from the geometry means a
 * model can be edited without a hand-kept constant silently going stale — and
 * with twenty-six of them, one that has to be maintained by hand certainly would.
 */
export function measureFootprint(model: THREE.Group): number {
	const b = new THREE.Box3().setFromObject(model);
	const size = b.getSize(new THREE.Vector3());
	return Math.max(size.x, size.z);
}
