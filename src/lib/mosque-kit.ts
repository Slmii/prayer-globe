// The design's `mosque-kit.js`, ported.
//
// A construction set the thirteen mosque models are assembled from: arches,
// domes, minarets, iwans, hypostyle halls, arcades. Geometry, proportions and
// material names are unchanged from the design; the only edits are TypeScript
// types and the removal of the viewer shell.
//
// Everything is built to rest directly on y = 0 — no plinths, podiums or terrace
// slabs — so a model can sit straight on the globe's surface.

import * as THREE from 'three';

export type Mat = THREE.MeshStandardMaterial;

export interface Palette {
	stone: Mat;
	stoneDark: Mat;
	dome: Mat;
	trim: Mat;
	tile: Mat;
	void_: Mat;
	wood: Mat;
}

export const mat = (name: string, color: number, roughness = 0.8, metalness = 0.03): Mat =>
	new THREE.MeshStandardMaterial({ name, color, roughness, metalness });

export function palette(over: Partial<Palette> = {}): Palette {
	const p: Palette = {
		stone: mat('stone', 0xe6dcc6, 0.85),
		stoneDark: mat('stone_shadow', 0xc2b295, 0.9),
		dome: mat('dome', 0x2f8f88, 0.45, 0.3),
		trim: mat('brass', 0xd8b04a, 0.35, 0.4),
		tile: mat('tile', 0x24406e, 0.4, 0.1),
		void_: mat('interior_void', 0x1a1c22, 1, 0),
		wood: mat('timber', 0x6d4a30, 0.8)
	};
	return Object.assign(p, over);
}

export const named = <T extends THREE.Object3D>(o: T, name: string): T => {
	o.name = name;
	return o;
};

export function group(name: string): THREE.Group {
	const g = new THREE.Group();
	g.name = name;
	return g;
}

export function box(w: number, h: number, d: number, m: Mat, name: string): THREE.Mesh {
	return named(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), name);
}

export function cyl(rt: number, rb: number, h: number, m: Mat, name: string, seg = 28): THREE.Mesh {
	return named(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m), name);
}

export type ArchShape = (w: number, h: number, spring: number) => THREE.Shape;

/* ---------- pointed arch ---------- */
export const archShape: ArchShape = (w, h, spring, pointed = 0.94 as number) => {
	const s = new THREE.Shape();
	const hw = w / 2;
	s.moveTo(-hw, 0);
	s.lineTo(-hw, spring);
	s.quadraticCurveTo(-hw, h * pointed, 0, h);
	s.quadraticCurveTo(hw, h * pointed, hw, spring);
	s.lineTo(hw, 0);
	s.lineTo(-hw, 0);
	return s;
};

/** Horseshoe arch (Maghrebi / Andalusian): the curve overshoots the spring line. */
export const horseshoeShape: ArchShape = (w, h, spring) => {
	const s = new THREE.Shape();
	const hw = w / 2;
	s.moveTo(-hw * 0.82, 0);
	s.lineTo(-hw * 0.82, spring);
	s.quadraticCurveTo(-hw * 1.12, spring + (h - spring) * 0.42, -hw * 0.72, h * 0.93);
	s.quadraticCurveTo(0, h * 1.08, hw * 0.72, h * 0.93);
	s.quadraticCurveTo(hw * 1.12, spring + (h - spring) * 0.42, hw * 0.82, spring);
	s.lineTo(hw * 0.82, 0);
	s.lineTo(-hw * 0.82, 0);
	return s;
};

/** Wall panel with a row of arched openings punched through it. */
export function archWall({
	width,
	height,
	depth,
	count,
	archW,
	archH,
	spring,
	material,
	shape = archShape,
	name = 'arch_wall'
}: {
	width: number;
	height: number;
	depth: number;
	count: number;
	archW: number;
	archH: number;
	spring: number;
	material: Mat;
	shape?: ArchShape;
	name?: string;
}): THREE.Mesh {
	const outer = new THREE.Shape();
	outer.moveTo(-width / 2, 0);
	outer.lineTo(width / 2, 0);
	outer.lineTo(width / 2, height);
	outer.lineTo(-width / 2, height);
	outer.lineTo(-width / 2, 0);
	const step = width / count;
	for (let i = 0; i < count; i++) {
		const cx = -width / 2 + step * (i + 0.5);
		const hole = shape(archW, archH, spring);
		const pts = hole.extractPoints(24).shape.map(p => new THREE.Vector2(p.x + cx, p.y));
		outer.holes.push(new THREE.Path(pts));
	}
	const g = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: false, curveSegments: 24 });
	g.translate(0, 0, -depth / 2);
	return named(new THREE.Mesh(g, material), name);
}

/** Four arched walls forming a closed riwaq / courtyard arcade ring. */
export function arcadeRing({
	w,
	d,
	height,
	depth,
	step,
	archW,
	archH,
	spring,
	material,
	shape,
	tag
}: {
	w: number;
	d: number;
	height: number;
	depth: number;
	step: number;
	archW: number;
	archH: number;
	spring: number;
	material: Mat;
	shape?: ArchShape;
	tag: string;
}): THREE.Group {
	const g = group('arcade_' + tag);
	const make = (len: number, nm: string) =>
		archWall({
			width: len,
			height,
			depth,
			count: Math.max(2, Math.round(len / step)),
			archW,
			archH,
			spring,
			material,
			shape,
			name: nm
		});
	const n = make(w, 'arcade_' + tag + '_north');
	n.position.set(0, 0, -d / 2);
	g.add(n);
	const s = make(w, 'arcade_' + tag + '_south');
	s.position.set(0, 0, d / 2);
	g.add(s);
	const e = make(d, 'arcade_' + tag + '_east');
	e.rotation.y = Math.PI / 2;
	e.position.set(w / 2, 0, 0);
	g.add(e);
	const wl = make(d, 'arcade_' + tag + '_west');
	wl.rotation.y = Math.PI / 2;
	wl.position.set(-w / 2, 0, 0);
	g.add(wl);
	return g;
}

/* ---------- domes ---------- */
export type DomeKind = 'hemi' | 'ogee' | 'pointed' | 'shallow';

export function domeProfile(R: number, kind: DomeKind = 'hemi', segs = 44): THREE.Vector2[] {
	const pts: THREE.Vector2[] = [];
	for (let i = 0; i <= segs; i++) {
		const t = i / segs;
		const a = t * (Math.PI / 2);
		let r = R * Math.cos(a);
		let y = R * Math.sin(a);
		if (kind === 'ogee') {
			r = R * Math.cos(a) * (1 + 0.3 * Math.sin(a * 2));
			y = R * Math.sin(a) * 1.22;
		} else if (kind === 'pointed') {
			r = R * Math.cos(a) * (1 + 0.16 * Math.sin(a * 2));
			y = R * Math.pow(Math.sin(a), 0.82) * 1.34;
		} else if (kind === 'shallow') {
			y = R * Math.sin(a) * 0.62;
		} else {
			r = R * Math.cos(a) * (1 + 0.05 * Math.sin(a * 2));
			y = R * Math.sin(a) * 1.05;
		}
		pts.push(new THREE.Vector2(Math.max(r, 0.001), y));
	}
	return pts;
}

export function finial(scale: number, tag: string, m: Mat, crescent = true): THREE.Group {
	const g = group('finial_' + tag);
	const stem = cyl(0.12 * scale, 0.17 * scale, 1.4 * scale, m, 'finial_stem_' + tag, 14);
	stem.position.y = 0.7 * scale;
	g.add(stem);
	const bulb = named(new THREE.Mesh(new THREE.SphereGeometry(0.32 * scale, 20, 14), m), 'finial_bulb_' + tag);
	bulb.position.y = 1.5 * scale;
	g.add(bulb);
	if (crescent) {
		const c = named(
			new THREE.Mesh(new THREE.TorusGeometry(0.5 * scale, 0.07 * scale, 10, 36, Math.PI * 1.45), m),
			'crescent_' + tag
		);
		c.position.y = 2.3 * scale;
		c.rotation.z = -Math.PI * 0.28;
		g.add(c);
	}
	return g;
}

export function dome({
	radius,
	kind = 'hemi',
	drumH = 0,
	drumR,
	windows = 0,
	ribs = 0,
	tag,
	P,
	shell,
	crescent = true,
	finialScale = 0.42
}: {
	radius: number;
	kind?: DomeKind;
	drumH?: number;
	drumR?: number;
	windows?: number;
	ribs?: number;
	tag: string;
	P: Palette;
	shell?: Mat;
	crescent?: boolean;
	finialScale?: number;
}): THREE.Group {
	const g = group('dome_' + tag);
	const R = drumR ?? radius * 0.95;
	if (drumH > 0) {
		const drum = cyl(R, R, drumH, P.stone, 'drum_' + tag, 40);
		drum.position.y = drumH / 2;
		g.add(drum);
		for (let i = 0; i < windows; i++) {
			const a = (i / windows) * Math.PI * 2;
			const w = box(0.7, 1.9, 0.22, P.tile, `drum_window_${tag}_${i}`);
			w.position.set(Math.sin(a) * (R + 0.02), drumH * 0.55, Math.cos(a) * (R + 0.02));
			w.rotation.y = a;
			g.add(w);
		}
	}
	const prof = domeProfile(radius, kind);
	const sh = named(new THREE.Mesh(new THREE.LatheGeometry(prof, 52), shell ?? P.dome), 'dome_shell_' + tag);
	sh.position.y = drumH;
	g.add(sh);
	const top = prof[prof.length - 1].y;
	for (let i = 0; i < ribs; i++) {
		const a = (i / ribs) * Math.PI * 2;
		const rib = named(
			new THREE.Mesh(new THREE.TorusGeometry(radius * 0.995, 0.1, 6, 30, Math.PI / 2), P.stoneDark),
			`dome_rib_${tag}_${i}`
		);
		rib.position.y = drumH;
		rib.rotation.set(0, a, 0);
		rib.scale.y = top / radius;
		g.add(rib);
	}
	const ring = named(new THREE.Mesh(new THREE.TorusGeometry(R + 0.1, 0.2, 10, 44), P.stoneDark), 'dome_ring_' + tag);
	ring.rotation.x = Math.PI / 2;
	ring.position.y = drumH + 0.04;
	g.add(ring);
	const f = finial(radius * finialScale, tag, P.trim, crescent);
	f.position.y = drumH + top;
	g.add(f);
	g.userData.top = drumH + top + radius * finialScale * 2.6;
	return g;
}

/** Small domed kiosk (chhatri) — Mughal roofline punctuation. */
export function chhatri({ r = 1.5, h = 3.2, tag, P }: { r?: number; h?: number; tag: string; P: Palette }): THREE.Group {
	const g = group('chhatri_' + tag);
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * Math.PI * 2;
		const c = cyl(0.14, 0.16, h, P.stone, `chhatri_col_${tag}_${i}`, 10);
		c.position.set(Math.sin(a) * r, h / 2, Math.cos(a) * r);
		g.add(c);
	}
	const slab = cyl(r + 0.35, r + 0.35, 0.3, P.stoneDark, 'chhatri_slab_' + tag, 24);
	slab.position.y = h + 0.15;
	g.add(slab);
	const d = dome({ radius: r + 0.15, kind: 'ogee', tag: 'chh_' + tag, P, finialScale: 0.3, crescent: false });
	d.position.y = h + 0.3;
	g.add(d);
	return g;
}

/* ---------- minarets ---------- */
export type MinaretKind = 'ottoman' | 'persian' | 'mughal' | 'square' | 'mudbrick' | 'needle' | 'spiral' | 'pagoda';

export function minaret({
	kind = 'ottoman',
	h = 40,
	tag,
	P
}: {
	kind?: MinaretKind;
	h?: number;
	tag: string;
	P: Palette;
}): THREE.Group {
	const g = group('minaret_' + tag);
	const stone = P.stone;
	const dark = P.stoneDark;

	if (kind === 'square') {
		const w = h * 0.16;
		const shaft = box(w, h * 0.78, w, stone, 'minaret_shaft_' + tag);
		shaft.position.y = h * 0.39;
		g.add(shaft);
		for (const s of [1, -1]) {
			for (let i = 0; i < 3; i++) {
				const p = archWall({
					width: w * 0.62,
					height: h * 0.13,
					depth: 0.25,
					count: 1,
					archW: w * 0.34,
					archH: h * 0.1,
					spring: h * 0.05,
					material: P.tile,
					shape: horseshoeShape,
					name: `minaret_panel_${tag}_${i}_${s}`
				});
				p.position.set(s * (w / 2 + 0.06), h * (0.24 + i * 0.17), 0);
				p.rotation.y = Math.PI / 2;
				g.add(p);
			}
		}
		const cor = box(w * 1.2, h * 0.035, w * 1.2, dark, 'minaret_cornice_' + tag);
		cor.position.y = h * 0.79;
		g.add(cor);
		const lant = box(w * 0.62, h * 0.14, w * 0.62, stone, 'minaret_lantern_' + tag);
		lant.position.y = h * 0.87;
		g.add(lant);
		const cap = named(new THREE.Mesh(new THREE.ConeGeometry(w * 0.5, h * 0.1, 4), P.dome), 'minaret_cap_' + tag);
		cap.position.y = h * 0.99;
		cap.rotation.y = Math.PI / 4;
		g.add(cap);
		const f = finial(h * 0.02, 'min_' + tag, P.trim);
		f.position.y = h * 1.04;
		g.add(f);
		return g;
	}

	if (kind === 'mudbrick') {
		const r = h * 0.19;
		const shaft = cyl(r * 0.62, r, h * 0.86, stone, 'minaret_shaft_' + tag, 4);
		shaft.position.y = h * 0.43;
		shaft.rotation.y = Math.PI / 4;
		g.add(shaft);
		for (let ring = 0; ring < 5; ring++) {
			for (let i = 0; i < 4; i++) {
				const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
				const t = named(
					new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.5, 6), P.wood),
					`toron_${tag}_${ring}_${i}`
				);
				const rr = r * (1 - ring * 0.07);
				t.position.set(Math.sin(a) * rr, h * (0.2 + ring * 0.16), Math.cos(a) * rr);
				t.rotation.set(Math.PI / 2, a, 0);
				g.add(t);
			}
		}
		const cone = named(new THREE.Mesh(new THREE.ConeGeometry(r * 0.55, h * 0.2, 5), stone), 'minaret_cap_' + tag);
		cone.position.y = h * 0.94;
		g.add(cone);
		const egg = named(new THREE.Mesh(new THREE.SphereGeometry(h * 0.026, 12, 10), P.trim), 'ostrich_egg_' + tag);
		egg.position.y = h * 1.06;
		g.add(egg);
		return g;
	}

	if (kind === 'spiral') {
		const turns = 5;
		const R0 = h * 0.42;
		const R1 = h * 0.1;
		for (let i = 0; i < 150; i++) {
			const t = i / 150;
			const a = t * turns * Math.PI * 2;
			const r = R0 + (R1 - R0) * t;
			const seg = box(r * 0.34, h * 0.03, 1.2, stone, `ramp_${tag}_${i}`);
			seg.position.set(Math.sin(a) * r * 0.82, h * 0.06 + t * h * 0.8, Math.cos(a) * r * 0.82);
			seg.rotation.y = a;
			g.add(seg);
		}
		const core = cyl(R1 * 0.8, R0 * 0.52, h * 0.88, dark, 'minaret_core_' + tag, 24);
		core.position.y = h * 0.44;
		g.add(core);
		const top = cyl(R1 * 0.72, R1 * 0.84, h * 0.12, stone, 'minaret_lantern_' + tag, 20);
		top.position.y = h * 0.93;
		g.add(top);
		return g;
	}

	if (kind === 'pagoda') {
		// Octagonal brick tower, three storeys divided by flared glazed eaves and
		// wrapped in wooden balconies (Xi'an's Pavilion for Introspection).
		const r = h * 0.17;
		for (let i = 0; i < 3; i++) {
			const s = 1 - i * 0.13;
			const y0 = h * (0.04 + i * 0.3);
			const body = cyl(r * s * 0.94, r * s, h * 0.22, i === 0 ? stone : P.wood, `storey_${tag}_${i}`, 8);
			body.position.y = y0 + h * 0.11;
			g.add(body);
			const bal = cyl(r * s * 1.34, r * s * 1.34, h * 0.014, P.wood, `balcony_${tag}_${i}`, 8);
			bal.position.y = y0 + h * 0.22;
			g.add(bal);
			const rail = named(
				new THREE.Mesh(new THREE.CylinderGeometry(r * s * 1.3, r * s * 1.3, h * 0.03, 8, 1, true), P.wood),
				`balcony_rail_${tag}_${i}`
			);
			rail.position.y = y0 + h * 0.235;
			g.add(rail);
			const eave = named(
				new THREE.Mesh(new THREE.ConeGeometry(r * s * 1.5, h * 0.1, 8), P.tile),
				`flared_eave_${tag}_${i}`
			);
			eave.position.y = y0 + h * 0.29;
			g.add(eave);
		}
		const cap = named(new THREE.Mesh(new THREE.ConeGeometry(r * 0.9, h * 0.16, 8), P.tile), 'pagoda_cap_' + tag);
		cap.position.y = h * 0.96;
		g.add(cap);
		const f = finial(h * 0.03, 'min_' + tag, P.trim, false);
		f.position.y = h * 1.03;
		g.add(f);
		return g;
	}

	if (kind === 'needle') {
		// Faisal's minarets: a slender square-section shaft from two intersecting
		// planes, rising to a sharp point. No balcony, no cap dome.
		const w = h * 0.055;
		const shaftH = h * 0.9;
		const shaft = cyl(w * 0.62, w, shaftH, stone, 'minaret_shaft_' + tag, 4);
		shaft.rotation.y = Math.PI / 4;
		shaft.position.y = shaftH / 2;
		g.add(shaft);
		for (let i = 0; i < 4; i++) {
			const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
			const edge = box(0.16, shaftH * 0.99, 0.16, dark, `minaret_edge_${tag}_${i}`);
			edge.position.set(Math.sin(a) * w * 0.78, shaftH / 2, Math.cos(a) * w * 0.78);
			g.add(edge);
		}
		const slit = box(w * 0.22, shaftH * 0.86, w * 0.22, P.tile, 'minaret_slit_' + tag);
		slit.position.y = shaftH * 0.5;
		g.add(slit);
		const tip = named(new THREE.Mesh(new THREE.ConeGeometry(w * 0.88, h * 0.12, 4), stone), 'minaret_tip_' + tag);
		tip.rotation.y = Math.PI / 4;
		tip.position.y = shaftH + h * 0.06;
		g.add(tip);
		const f = finial(h * 0.014, 'min_' + tag, P.trim);
		f.position.y = h * 0.99;
		g.add(f);
		return g;
	}

	// round shafts: ottoman / persian / mughal
	const rTop = kind === 'mughal' ? h * 0.05 : h * 0.032;
	const rBot = kind === 'mughal' ? h * 0.075 : h * 0.055;
	const base = box(rBot * 3.0, h * 0.09, rBot * 3.0, dark, 'minaret_base_' + tag);
	base.position.y = h * 0.045;
	g.add(base);
	const trans = cyl(rBot * 1.05, rBot * 1.5, h * 0.06, stone, 'minaret_transition_' + tag, 16);
	trans.position.y = h * 0.12;
	g.add(trans);
	const shaftH = h * 0.62;
	const shaftY = h * 0.15 + shaftH / 2;
	const shaft = cyl(rTop, rBot, shaftH, kind === 'persian' ? P.tile : stone, 'minaret_shaft_' + tag, 24);
	shaft.position.y = shaftY;
	g.add(shaft);
	if (kind === 'ottoman') {
		for (let i = 0; i < 12; i++) {
			const a = (i / 12) * Math.PI * 2;
			const fl = box(rBot * 0.16, shaftH * 0.96, rBot * 0.16, dark, `minaret_flute_${tag}_${i}`);
			fl.position.set(Math.sin(a) * rBot * 0.85, shaftY, Math.cos(a) * rBot * 0.85);
			fl.rotation.y = a;
			g.add(fl);
		}
	}
	if (kind === 'persian') {
		for (let i = 0; i < 3; i++) {
			const band = named(
				new THREE.Mesh(new THREE.TorusGeometry(rBot * 0.9 - i * 0.05, 0.14, 8, 32), P.trim),
				`minaret_band_${tag}_${i}`
			);
			band.rotation.x = Math.PI / 2;
			band.position.y = h * (0.28 + i * 0.16);
			g.add(band);
		}
	}
	const balY = shaftY + shaftH / 2;
	const bal = cyl(rBot * 1.7, rBot * 1.3, h * 0.014, dark, 'balcony_floor_' + tag, 30);
	bal.position.y = balY;
	g.add(bal);
	const rail = named(
		new THREE.Mesh(new THREE.CylinderGeometry(rBot * 1.62, rBot * 1.62, h * 0.032, 30, 1, true), P.tile),
		'balcony_rail_' + tag
	);
	rail.position.y = balY + h * 0.023;
	g.add(rail);
	const cap = named(new THREE.Mesh(new THREE.TorusGeometry(rBot * 1.62, 0.08, 8, 34), P.trim), 'balcony_cap_' + tag);
	cap.rotation.x = Math.PI / 2;
	cap.position.y = balY + h * 0.04;
	g.add(cap);
	const up = cyl(rTop * 0.8, rTop, h * 0.12, kind === 'persian' ? P.tile : stone, 'minaret_upper_' + tag, 18);
	up.position.y = balY + h * 0.1;
	g.add(up);
	if (kind === 'mughal') {
		const c = chhatri({ r: rBot * 1.5, h: h * 0.06, tag: 'min_' + tag, P });
		c.position.y = balY + h * 0.16;
		g.add(c);
	} else if (kind === 'persian') {
		const d = dome({ radius: rBot * 1.5, kind: 'pointed', tag: 'min_' + tag, P, finialScale: 0.3 });
		d.position.y = balY + h * 0.16;
		g.add(d);
	} else {
		const cone = named(new THREE.Mesh(new THREE.ConeGeometry(rTop * 1.9, h * 0.11, 22), P.dome), 'minaret_cap_' + tag);
		cone.position.y = balY + h * 0.22;
		g.add(cone);
		const f = finial(h * 0.018, 'min_' + tag, P.trim);
		f.position.y = balY + h * 0.28;
		g.add(f);
	}
	return g;
}

/* ---------- portals & halls ---------- */
/** Monumental iwan: tiled rectangular screen with a deep arched recess. */
export function iwan({
	w,
	h,
	depth = 2.2,
	P,
	tag,
	shape = archShape
}: {
	w: number;
	h: number;
	depth?: number;
	P: Palette;
	tag: string;
	shape?: ArchShape;
}): THREE.Group {
	const g = group('iwan_' + tag);
	const frame = archWall({
		width: w,
		height: h,
		depth,
		count: 1,
		archW: w * 0.58,
		archH: h * 0.82,
		spring: h * 0.46,
		material: P.tile,
		shape,
		name: 'iwan_frame_' + tag
	});
	g.add(frame);
	const back = named(
		new THREE.Mesh(
			new THREE.ExtrudeGeometry(shape(w * 0.58, h * 0.82, h * 0.46), {
				depth: 0.4,
				bevelEnabled: false,
				curveSegments: 24
			}),
			P.void_
		),
		'iwan_void_' + tag
	);
	back.position.z = -depth * 0.8;
	g.add(back);
	for (const s of [1, -1]) {
		const pil = box(w * 0.07, h * 1.02, depth * 1.05, P.stone, `iwan_pier_${tag}_${s > 0 ? 'e' : 'w'}`);
		pil.position.set(s * (w / 2 - w * 0.035), h * 0.51, 0);
		g.add(pil);
	}
	const crest = box(w * 1.04, h * 0.05, depth * 1.1, P.stoneDark, 'iwan_crest_' + tag);
	crest.position.y = h * 1.02;
	g.add(crest);
	return g;
}

/** Hypostyle prayer hall: forest of columns under a flat roof, open sides. */
export function hypostyle({
	w,
	d,
	colH,
	cols,
	rows,
	P,
	tag,
	shape = horseshoeShape
}: {
	w: number;
	d: number;
	colH: number;
	cols: number;
	rows: number;
	P: Palette;
	tag: string;
	shape?: ArchShape;
}): THREE.Group {
	const g = group('hypostyle_' + tag);
	const sx = w / cols;
	const sz = d / rows;
	for (let i = 0; i <= cols; i++) {
		for (let j = 0; j <= rows; j++) {
			const c = cyl(0.34, 0.4, colH, P.stone, `column_${tag}_${i}_${j}`, 12);
			c.position.set(-w / 2 + i * sx, colH / 2, -d / 2 + j * sz);
			g.add(c);
			const cap = box(0.9, 0.36, 0.9, P.stoneDark, `capital_${tag}_${i}_${j}`);
			cap.position.set(c.position.x, colH + 0.18, c.position.z);
			g.add(cap);
		}
	}
	for (let j = 0; j <= rows; j++) {
		const arc = archWall({
			width: w,
			height: colH * 0.5,
			depth: 0.5,
			count: cols,
			archW: sx * 0.8,
			archH: colH * 0.44,
			spring: colH * 0.16,
			material: P.stone,
			shape,
			name: `hypostyle_arcade_${tag}_${j}`
		});
		arc.position.set(0, colH + 0.36, -d / 2 + j * sz);
		g.add(arc);
	}
	const roof = box(w + 1.6, 0.7, d + 1.6, P.stoneDark, 'hypostyle_roof_' + tag);
	roof.position.y = colH + 0.36 + colH * 0.5 + 0.35;
	g.add(roof);
	g.userData.roofY = roof.position.y + 0.35;
	return g;
}

/** Plain rectangular prayer hall block with a cornice. */
export function hall({
	w,
	h,
	d,
	P,
	tag,
	m
}: {
	w: number;
	h: number;
	d: number;
	P: Palette;
	tag: string;
	m?: Mat;
}): THREE.Group {
	const g = group('hall_' + tag);
	const b = box(w, h, d, m ?? P.stone, 'prayer_hall_' + tag);
	b.position.y = h / 2;
	g.add(b);
	const cor = box(w + 0.9, 0.7, d + 0.9, P.stoneDark, 'cornice_' + tag);
	cor.position.y = h - 0.35;
	g.add(cor);
	g.userData.top = h;
	return g;
}

/** Merlon / crenellation crest along a wall run. */
export function merlons({
	len,
	y,
	z = 0,
	axis = 'x',
	count,
	P,
	tag,
	h = 0.9
}: {
	len: number;
	y: number;
	z?: number;
	axis?: 'x' | 'z';
	count: number;
	P: Palette;
	tag: string;
	h?: number;
}): THREE.Group {
	const g = group('merlons_' + tag);
	for (let i = 0; i < count; i++) {
		const t = -len / 2 + (len / count) * (i + 0.5);
		const m = box(0.55, h, 0.55, P.stoneDark, `merlon_${tag}_${i}`);
		if (axis === 'x') m.position.set(t, y + h / 2, z);
		else m.position.set(z, y + h / 2, t);
		g.add(m);
	}
	return g;
}
