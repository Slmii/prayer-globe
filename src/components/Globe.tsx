import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import * as maplibregl from 'maplibre-gl';
import type { Map as MLMap, Marker, LngLat } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CITIES } from '../lib/cities';
import type { City } from '../lib/cities';
// three.js and everything drawn with it — the mosque models, the starfield, the
// sun and moon bodies — is loaded on demand. It is 141 KB gzipped, a quarter of
// the bundle, and none of it is needed to draw the globe.
//
// The orbs and the cosmos are null-checked in the frame loop, so they simply
// start drawing when they arrive. The mosque layer is not in that loop and
// needs more care: a city with a mosque has its dot hidden, so it stays visible
// until the layer is actually added (see `mosquesReadyRef`).
import type { createCosmos } from './cosmos';
import type { Orb } from './orb';
import type { PlanetLabel } from './cosmos';
import { blendOf } from '../lib/phases';
import type { PhaseTable } from '../lib/phases';
import { MOSQUES } from '../lib/mosques';
import type { Mosque, MosqueModel } from '../lib/mosques';
import { AppIcon } from './AppIcon';
import type { AppIconName } from './AppIcon';
import {
	D,
	PHASES,
	skyState,
	bearing,
	terminatorArcs,
	nightPolygon,
	bodyPaths,
	phaseBand,
	phaseCap,
	phaseBlend,
	qiblaPath,
	splitAtAntimeridian
} from '../lib/astro';

/** Cities whose dot is replaced by a 3D mosque. */
const MOSQUE_CITIES = new Set(MOSQUES.map(m => m.city));
/** The mosque standing on a given city's dot, for the card a press puts up. */
const MOSQUE_AT_CITY = new Map(MOSQUES.filter(m => m.anchored === 'city').map(m => [m.city, m]));

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

const HEX = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const PHASE_RGB = PHASES.map(p => HEX(p.c));

/** Blend two phase colours, so a dot eases into its next prayer. */
function mixPhase(a: number, b: number, t: number): string {
	if (t <= 0 || a === b) return PHASES[a].c;
	const x = PHASE_RGB[a];
	const y = PHASE_RGB[b];
	const m = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t);
	return `rgb(${m(0)},${m(1)},${m(2)})`;
}

/**
 * Latitude/longitude grid, every 15°.
 *
 * Sampled every 5° along each line so the curves bend with the sphere instead
 * of cutting straight chords through it. Static, so it is built once.
 */
const GRATICULE: FeatureCollection = {
	type: 'FeatureCollection',
	features: (() => {
		const lines: [number, number][][] = [];
		for (let lat = -75; lat <= 75; lat += 15) {
			const line: [number, number][] = [];
			for (let lon = -180; lon <= 180; lon += 5) line.push([lon, lat]);
			lines.push(line);
		}
		for (let lon = -180; lon < 180; lon += 15) {
			const line: [number, number][] = [];
			for (let lat = -85; lat <= 85; lat += 5) line.push([lon, lat]);
			lines.push(line);
		}
		return [
			{
				type: 'Feature' as const,
				properties: {},
				geometry: { type: 'MultiLineString' as const, coordinates: lines }
			}
		];
	})()
};

/** How far outside the globe's rim the sun and moon ride, in pixels. */
const ORBIT_GAP = 46;

/** Qibla lines: off, the selected city only, or a sample of everything facing us. */
export type QiblaMode = 'off' | 'one' | 'many';

/** Which bodies' tracks to draw: none, the sun alone, or the sun and the moon. */
export type PathMode = 'off' | 'sun' | 'both';

/**
 * Most great circles drawn in `many` mode.
 *
 * The image is the convergence, not the individual lines, and past a couple of
 * hundred the extra ones land on top of each other while still costing geometry.
 */
const QIBLA_MAX = 220;

/** Pixels between the mosque and the card offering to open it, either side. */
const GAP = 14;

export interface GlobeHandle {
	flyTo(lng: number, lat: number, zoom: number, duration?: number): void;
}

interface GlobeProps {
	worldGeo?: FeatureCollection;
	/** Continuous scrubbed instant. Sampled per frame, not passed as a value. */
	getNowMs: () => number;
	/**
	 * The selected city, or null when nothing is selected.
	 *
	 * The whole record, not just the name: this used to be a name that the globe
	 * looked up in `CITIES`, which silently drew nothing for a city found by
	 * locating — it has coordinates and a timetable but no row in the bundle, so
	 * its qibla line simply never appeared.
	 */
	activeCity: { n: string; la: number; lo: number } | null;
	/**
	 * A city found by locating, which the bundle does not ship.
	 *
	 * It is drawn as a dot alongside the shipped ones, because everything the
	 * reader can do to a city goes through that dot: the hover ring, the name in
	 * the pointer line, the click that selects it. Without a feature in the source
	 * the one city they actually asked for was the only one on the globe that
	 * could not be pointed at — the "you are here" mark sat on top of nothing.
	 */
	guestCity: City | null;
	spin: boolean;
	/** Draw the tracks the sun and moon have taken over the scrubbed span. */
	pathMode: PathMode;
	/** Draw the planets on their orbits around the globe. */
	showOrrery: boolean;
	/** Pulse every city currently in this prayer phase, or null for none. */
	highlightPhase: number | null;
	/** Every city's Diyanet boundaries, for dot colour. Null until loaded. */
	phases: PhaseTable | null;
	/** Draw qibla great circles: none, the selected city's, or every visible one. */
	qiblaMode: QiblaMode;
	/** Shade the ground standing in this prayer, or null for none. */
	bandPhase: number | null;
	/**
	 * A point to mark on the surface while it lasts — where the reader is.
	 *
	 * A marker rather than a layer, so it hides itself when the earth turns it to
	 * the far side, exactly as the sun and moon pulses do.
	 */
	mark: { lat: number; lon: number } | null;
	/** Pulse the mark — true for its first seconds, then it settles and stays. */
	markPulsing: boolean;
	/** The chain's one-day sweep is running. */
	sweeping: boolean;
	onHover(p: { lat: number; lng: number } | null): void;
	onView(v: { lng: number; lat: number; zoom: number }): void;
	/** A city dot was clicked, by name. */
	onCitySelect(name: string): void;
	/** A city dot is under the pointer, by name (null when none). */
	onCityHover(name: string | null): void;
	/**
	 * A monument standing on no city is under the pointer, by name.
	 *
	 * Kept separate from `onCityHover` because the two mean different things to
	 * the reader: one is a place whose times you can go and read, the other is a
	 * building the app can only show you.
	 */
	onSiteHover(name: string | null): void;
	/** One was clicked. There is nothing to select, so this is "go and look". */
	onSiteSelect(name: string): void;
	/** The card's button was pressed: open this building in the 3D viewer. */
	onOpenViewer(model: MosqueModel): void;
	onNote(note: string): void;
	/** Copy a link to the current city and moment. */
	onShare(): void;
}

type GlyphKind = 'sun' | 'moon';

/**
 * Glyph box size in CSS pixels.
 *
 * The sun gets the larger frame because the design's model brings a corona out
 * to 1.26 radii and flares past that; crop it to the moon's size and it loses
 * the atmosphere that makes it a sun rather than a yellow ball.
 */
const ORB_PX: Record<GlyphKind, number> = { sun: 48, moon: 34 };

/** DOM node for one celestial marker. */
function glyph(kind: GlyphKind): HTMLDivElement {
	const n = document.createElement('div');
	// Must be absolute: as a flow-level block it would stretch to the overlay's
	// full width, and the translate(-50%) centring would then shift it by half
	// the viewport instead of half the glyph.
	n.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;will-change:transform';
	const b = document.createElement('div');
	const px = ORB_PX[kind];
	b.style.cssText = `position:relative;width:${px}px;height:${px}px`;

	// The body itself is the design's 3D model on its own canvas; `createOrb`
	// takes it from here. Both keep a halo behind them, for different reasons: it
	// is what makes the sun read as a light source rather than a yellow ball, and
	// it is what keeps the moon findable on the nights when its lit crescent is
	// only a couple of pixels wide.
	const halo = document.createElement('div');
	halo.style.cssText =
		kind === 'sun'
			? 'position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(255,214,120,.22) 0%,rgba(255,196,88,0) 66%);animation:pg-breathe 4.2s ease-in-out infinite'
			: 'position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(226,231,247,.3) 0%,rgba(198,205,232,0) 68%);animation:pg-breathe 6.5s ease-in-out infinite';
	b.append(halo);
	const cv = document.createElement('canvas');
	cv.className = 'pg-orb';
	cv.style.cssText = `position:absolute;inset:0;width:${px}px;height:${px}px;display:block`;
	b.append(cv);

	const name = kind === 'sun' ? 'SUN' : 'MOON';
	const l = document.createElement('div');
	l.textContent = name;
	l.style.cssText = `position:absolute;left:${
		px + 2
	}px;top:50%;transform:translateY(-50%);font:500 8.5px ui-monospace,Menlo,monospace;letter-spacing:.11em;color:rgba(233,233,237,.72);white-space:nowrap;text-shadow:0 1px 6px rgba(6,7,11,.95)`;
	n.dataset.kind = name;
	n.append(b, l);
	return n;
}

/**
 * The exact point the body stands over, marked on the globe itself. The big
 * glyph rides outside the rim, so this is what actually carries the position.
 */
function pulse(kind: GlyphKind): HTMLDivElement {
	const n = document.createElement('div');
	n.className = `pg-pulse pg-pulse-${kind}`;
	const ring = document.createElement('span');
	ring.className = 'pg-pulse-ring';
	const core = document.createElement('span');
	core.className = 'pg-pulse-core';
	n.append(ring, core);
	return n;
}

/** The canvas inside a glyph that `createOrb` draws the 3D body onto. */
function orbCanvas(el: HTMLElement): HTMLCanvasElement | null {
	return el.querySelector<HTMLCanvasElement>('canvas.pg-orb');
}

const Globe = forwardRef<GlobeHandle, GlobeProps>(function Globe(props, ref) {
	const hostRef = useRef<HTMLDivElement>(null);
	const overlayRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<MLMap | null>(null);
	const readyRef = useRef(false);
	/**
	 * Whether the 3D mosque layer is actually drawing yet.
	 *
	 * A city flagged `m` has its dot painted at zero opacity, because a mosque
	 * model stands there instead. That flag used to be set from the city list
	 * alone, but the layer is now loaded asynchronously — so between first paint
	 * and the chunk arriving, Makkah, Madinah, Istanbul, Cairo, Delhi and Jakarta
	 * had no marker at all, and if the chunk ever failed to load they never got
	 * one. The dot stays until its model can replace it.
	 */
	const mosquesReadyRef = useRef(false);
	const bodiesRef = useRef<Record<GlyphKind, HTMLDivElement> | null>(null);
	const orbsRef = useRef<Record<GlyphKind, Orb> | null>(null);
	const pulsesRef = useRef<Record<GlyphKind, Marker> | null>(null);
	const zoomReadoutRef = useRef<HTMLDivElement | null>(null);
	/** React roots mounted into MapLibre's DOM, so they can be torn down with it. */
	const iconRootsRef = useRef<Root[]>([]);
	/** The live "you are here" element, so the pulse can be toggled on it. */
	const hereRef = useRef<HTMLDivElement | null>(null);
	const qiblaEmptyRef = useRef(true);
	const bandEmptyRef = useRef(true);
	/** Camera longitude minus the sub-solar longitude, held for the sweep. */
	const sweepOffsetRef = useRef<number | null>(null);
	/** What `pushQibla` last drew, so it can skip an unchanged rebuild. */
	const qiblaKeyRef = useRef('');
	const hoveredRef = useRef<string | null>(null);
	/** The hovered monument, kept apart from the hovered city: they are different
	 *  kinds of mark and only one of them has a timetable behind it. */
	const hoveredSiteRef = useRef<string | null>(null);
	/** The "view in 3D" card, while one is up. At most one, ever. */
	const popRef = useRef<{ el: HTMLDivElement; site: Mosque } | null>(null);
	/** Its own layer, above the console strip — see `showPopover`. */
	const popLayerRef = useRef<HTMLDivElement>(null);
	const highlightRef = useRef<number | null>(null);
	/**
	 * The scrubbed instant `pushSky` last drew, and whether `pushPaths` last left
	 * the source empty.
	 *
	 * Both used to run every frame. That is two `setData` calls on `edges` and
	 * `night` plus one on `paths` — each serialising several hundred coordinates,
	 * posting them to the worker, and re-tiling — sixty times a second, forever,
	 * including with the clock frozen and nobody touching anything. `setData`
	 * also forces a repaint internally, so this was what kept the map from ever
	 * idling; removing the mosque layer's `triggerRepaint` alone did not.
	 *
	 * NaN forces the next push, which is how a style reload gets its data back.
	 */
	const skyDrawnAtRef = useRef(Number.NaN);
	const pathsEmptyRef = useRef(false);
	/**
	 * Camera signature and clock reading the celestial layer was last drawn for.
	 *
	 * The starfield, the orrery, the sun and moon glyphs and their pulses all
	 * depend on exactly two things: where the camera is, and what time it is.
	 * Neither changes between most frames, yet the block was redrawing a full
	 * three.js scene and running an 18-step project/unproject search sixty times
	 * a second regardless.
	 */
	const lastCamRef = useRef('');
	const lastCelestialAtRef = useRef(Number.NaN);
	const tipRef = useRef<HTMLDivElement | null>(null);
	const planetLabelsRef = useRef<Map<string, HTMLDivElement>>(new Map());
	const skyRef = useRef<HTMLCanvasElement>(null);
	const cosmosRef = useRef<ReturnType<typeof createCosmos> | null>(null);

	// The rAF loop and map callbacks need the latest props without re-subscribing.
	const propsRef = useRef(props);
	propsRef.current = props;

	useImperativeHandle(
		ref,
		() => ({
			flyTo(lng, lat, zoom, duration = 2600) {
				mapRef.current?.flyTo({ center: [lng, lat], zoom, duration, curve: 1.5, essential: true });
			}
		}),
		[]
	);

	/**
	 * Position the planet name tags the orrery layer hands us each frame.
	 *
	 * The planets live at 1.3–2.5 earth radii, so there is no lat/lon for
	 * map.project to work with — the layer projects them with the same matrix it
	 * renders through and passes the screen coordinates out.
	 */
	function placePlanetLabels(labels: PlanetLabel[]) {
		const overlay = overlayRef.current;
		if (!overlay) return;
		const tags = planetLabelsRef.current;
		// No labels means the sky is not being drawn at all — hide any left over,
		// or they hang in the view after the orrery has faded out.
		if (labels.length === 0) {
			for (const el of tags.values()) el.style.opacity = '0';
			return;
		}
		for (const l of labels) {
			let el = tags.get(l.name);
			if (!el) {
				el = document.createElement('div');
				el.className = 'pg-planet';
				el.textContent = l.name;
				overlay.appendChild(el);
				tags.set(l.name, el);
			}
			el.style.color = l.color;
			el.style.opacity = l.visible ? '1' : '0';
			el.style.transform = `translate(10px, -50%) translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px)`;
		}
	}

	/** Radius in px of the globe's silhouette, or null when it overflows the view. */
	function globeRadius(w: number, h: number): number | null {
		const map = mapRef.current;
		if (!map) return null;
		const cx = w / 2;
		const cy = h / 2;
		const onGlobe = (r: number) => {
			const px = { x: cx, y: cy - r };
			if (px.y < 0) return false;
			let ll;
			try {
				ll = map.unproject([px.x, px.y]);
			} catch {
				return false;
			}
			if (!ll || !isFinite(ll.lat) || !isFinite(ll.lng)) return false;
			const back = map.project(ll);
			return Math.hypot(back.x - px.x, back.y - px.y) < 2.5;
		};
		const limit = cy;
		if (onGlobe(limit)) return null; // zoomed in far enough that there is no rim
		let lo = 1;
		let hi = limit;
		for (let i = 0; i < 18; i++) {
			const mid = (lo + hi) / 2;
			if (onGlobe(mid)) lo = mid;
			else hi = mid;
		}
		return lo;
	}

	/**
	 * Place a celestial body in screen space, always clear of the globe.
	 *
	 * Drawing the glyph at its true projected position buried it in city labels,
	 * so the body now rides outside the silhouette in the direction of the point
	 * it stands over, and the exact spot is marked by a pulse on the globe itself.
	 * That split is also why these are positioned elements rather than MapLibre
	 * markers: a point behind the earth has no lng/lat that projects outside.
	 *
	 * The direction degenerates when the body is almost dead centre — there is no
	 * sensible 2D bearing for something directly in front of you — so the glyph
	 * fades out over that last stretch and the pulse carries the meaning alone.
	 */
	function positionBody(el: HTMLElement, lat: number, lon: number, cen: LngLat, rim: number | null) {
		const map = mapRef.current;
		if (!map) return;

		// No rim means the globe fills the view: we are zoomed into a city, where a
		// body parked in the corner of the screen means nothing. Hide it.
		if (rim == null) {
			el.style.opacity = '0';
			return;
		}
		el.style.opacity = '1';

		const box = map.getContainer();
		const w = box.clientWidth;
		const h = box.clientHeight;
		const cx = w / 2;
		const cy = h / 2;

		const cosA =
			Math.sin(lat * D) * Math.sin(cen.lat * D) +
			Math.cos(lat * D) * Math.cos(cen.lat * D) * Math.cos((lon - cen.lng) * D);
		const angDist = Math.acos(Math.max(-1, Math.min(1, cosA))) / D;
		const facing = cosA > 0;

		const b = (bearing(cen.lat, cen.lng, lat, lon) - (map.getBearing() || 0)) * D;
		const maxR = Math.min(w, h) / 2 - 30;
		const r = Math.min(rim + ORBIT_GAP, maxR);
		const x = cx + Math.sin(b) * r;
		const y = cy - Math.cos(b) * r;

		el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
		const body = el.firstChild as HTMLElement | null;
		if (body) {
			const fade = Math.max(0, Math.min(1, (angDist - 16) / 14));
			body.style.opacity = ((facing ? 1 : 0.55) * fade).toFixed(2);
		}
	}

	/**
	 * The geometry that actually moves: terminator limbs and the night cap.
	 *
	 * Runs every frame. While "Play day" is running the sub-solar point sweeps
	 * 24° of longitude per second, so anything throttled to even 120 ms lands in
	 * visible ~3° jumps. These are only a few hundred coordinates, so rebuilding
	 * them per frame is affordable — unlike the city dots below.
	 */
	/** Terminator, night side and sub-solar point, for the scrubbed instant. */
	function pushSky(force = false) {
		const map = mapRef.current;
		if (!map || !readyRef.current) return;

		const nowMs = propsRef.current.getNowMs();
		/*
		 * Redraw once the line has moved half a pixel — whatever that is here.
		 *
		 * The sub-solar point drifts 0.25° per minute, so this used to be a flat
		 * 30 seconds: 0.125°, about half a pixel at the zoom the globe opens at.
		 * That reasoning was sound and its constant was not, because it was tied to
		 * one zoom level. Fly in to a city — which "My location" now does, at 6.5 —
		 * and the same 0.125° is fourteen pixels, so the terminator sat still for
		 * thirty seconds and then jumped, over and over.
		 *
		 * Derived from the zoom instead, it is the same cheap redraw when the whole
		 * earth is in view and a smooth one when it is not. Scrubbing and playing
		 * cross any of these thresholds within a frame, so they were never the
		 * problem and still update continuously.
		 */
		const degPerPx = 360 / (512 * Math.pow(2, map.getZoom()));
		const msPerHalfPixel = (0.5 * degPerPx) / (0.25 / 60_000);
		if (!force && Math.abs(nowMs - skyDrawnAtRef.current) < Math.min(30_000, msPerHalfPixel)) return;
		skyDrawnAtRef.current = nowMs;

		const sky = skyState(new Date(nowMs));
		const { dec } = sky;
		const subLat = sky.sun.lat;
		const subLon = sky.sun.lon;

		const arcs = terminatorArcs(subLat, subLon);
		const edges = map.getSource('edges') as maplibregl.GeoJSONSource | undefined;
		edges?.setData({
			type: 'FeatureCollection',
			features: (
				[
					['sunrise', arcs.sunrise],
					['sunset', arcs.sunset]
				] as [string, [number, number][][]][]
			).map(([k, coordinates]) => ({
				type: 'Feature',
				properties: { k },
				geometry: { type: 'MultiLineString', coordinates }
			}))
		});

		const night = map.getSource('night') as maplibregl.GeoJSONSource | undefined;
		night?.setData({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: { type: 'Polygon', coordinates: [nightPolygon(dec, subLon)] }
				}
			]
		});
	}

	/** Sun and moon tracks from the present to wherever the clock has been moved. */
	function pushPaths() {
		const map = mapRef.current;
		if (!map || !readyRef.current) return;
		const src = map.getSource('paths') as maplibregl.GeoJSONSource | undefined;
		if (!src) return;

		const nowMs = propsRef.current.getNowMs();
		const realNow = Date.now();
		const mode = propsRef.current.pathMode;
		if (mode === 'off' || Math.abs(nowMs - realNow) < 60000) {
			// Clearing an already-clear source is still a worker round trip.
			if (!pathsEmptyRef.current) {
				src.setData(EMPTY);
				pathsEmptyRef.current = true;
			}
			return;
		}
		pathsEmptyRef.current = false;

		const paths = bodyPaths(realNow, nowMs);
		src.setData({
			type: 'FeatureCollection',
			features: (
				[
					// The moon's track is the one that goes when only the sun is asked for.
					...(mode === 'both' ? ([['moon', paths.moon]] as [string, [number, number][][]][]) : []),
					['sun', paths.sun]
				] as [string, [number, number][][]][]
			).map(([k, coordinates]) => ({
				type: 'Feature',
				properties: { k },
				geometry: { type: 'MultiLineString', coordinates }
			}))
		});
	}

	/**
	 * Qibla great circles: none, the selected city's, or every visible city's.
	 *
	 * Rebuilt only when the mode or the selection changes, never per frame — the
	 * lines are fixed to the ground, so unlike everything else here they do not
	 * move with the clock. The many-city set is capped and sampled coarsely:
	 * hundreds of 128-point arcs would be a lot of geometry for an image whose
	 * whole content is "they all meet in one place".
	 */
	/**
	 * Shade the ground in the followed prayer.
	 *
	 * Rebuilt on the same throttle as the dots rather than per frame: it is a few
	 * hundred quads and the band creeps westward at a quarter of a degree a
	 * minute, so nothing is gained by redrawing it sixty times a second.
	 */
	function pushBand() {
		const map = mapRef.current;
		if (!map || !readyRef.current) return;
		const src = map.getSource('band') as maplibregl.GeoJSONSource | undefined;
		if (!src) return;

		const cap = map.getSource('band-cap') as maplibregl.GeoJSONSource | undefined;

		const phase = propsRef.current.bandPhase;
		if (phase == null) {
			if (!bandEmptyRef.current) {
				src.setData(EMPTY);
				cap?.setData(EMPTY);
				bandEmptyRef.current = true;
			}
			return;
		}
		bandEmptyRef.current = false;

		const { dec, eot, utcH } = skyState(new Date(propsRef.current.getNowMs()));
		src.setData({
			type: 'FeatureCollection',
			features: phaseBand(phase, dec, utcH, eot).map(coords => ({
				type: 'Feature',
				properties: {},
				geometry: { type: 'Polygon', coordinates: [coords] }
			}))
		});

		// The polar cap, in the phase's own colour, where the hatch cannot reach.
		map.setPaintProperty('band-cap-fill', 'fill-color', PHASES[phase].c);
		cap?.setData({
			type: 'FeatureCollection',
			features: phaseCap(phase, dec).map(coords => ({
				type: 'Feature',
				properties: {},
				geometry: { type: 'Polygon', coordinates: [coords] }
			}))
		});
	}

	function pushQibla() {
		const map = mapRef.current;
		if (!map || !readyRef.current) return;
		const src = map.getSource('qibla') as maplibregl.GeoJSONSource | undefined;
		if (!src) return;

		const { qiblaMode, activeCity } = propsRef.current;

		// These lines are pinned to the ground: unlike the terminator or the paths
		// they do not move with the clock, only with the mode, the selection, or —
		// in `many` — which hemisphere faces us. Rebuild on those and nothing else.
		const c = map.getCenter();
		const key =
			qiblaMode === 'many'
				? `many:${activeCity?.n}:${c.lng.toFixed(0)}:${c.lat.toFixed(0)}`
				: `${qiblaMode}:${activeCity?.n}`;
		if (key === qiblaKeyRef.current) return;
		qiblaKeyRef.current = key;

		if (qiblaMode === 'off') {
			if (!qiblaEmptyRef.current) {
				src.setData(EMPTY);
				qiblaEmptyRef.current = true;
			}
			return;
		}
		qiblaEmptyRef.current = false;

		const line = (c: { la: number; lo: number }, k: string, steps: number) => ({
			type: 'Feature' as const,
			properties: { k },
			geometry: {
				type: 'MultiLineString' as const,
				coordinates: splitAtAntimeridian(qiblaPath(c.la, c.lo, steps))
			}
		});

		const features = [];
		if (qiblaMode === 'many') {
			const cen = map.getCenter();
			const facing = (la: number, lo: number) =>
				Math.sin(la * D) * Math.sin(cen.lat * D) +
				Math.cos(la * D) * Math.cos(cen.lat * D) * Math.cos((lo - cen.lng) * D);
			const near = allCitiesRef.current.filter(c => facing(c.la, c.lo) > 0.08);
			// Thin the set so the picture stays legible at any zoom.
			const step = Math.max(1, Math.ceil(near.length / QIBLA_MAX));
			for (let i = 0; i < near.length; i += step) features.push(line(near[i], 'many', 48));
		}

		// Straight from the selection, wherever it came from.
		if (activeCity) features.push(line(activeCity, 'one', 192));

		src.setData({ type: 'FeatureCollection', features });
	}

	/**
	 * Every city the globe draws: the shipped ones, plus the located city.
	 *
	 * Looking a name up in `CITIES` is the assumption that keeps breaking once a
	 * city can be found live. It has coordinates and a timetable but no row in the
	 * bundle, so every pass that resolved a name that way quietly drew nothing for
	 * it — the qibla line, then the dot, and last the hover label, which is the
	 * only place the globe names a city at all.
	 *
	 * Rebuilt when the guest changes rather than per pass: three throttled passes
	 * read this, and copying 891 rows four times a second to append one would be a
	 * waste.
	 */
	const allCitiesRef = useRef<City[]>(CITIES);
	useEffect(() => {
		const g = props.guestCity;
		// Unless locating landed on a city already in the list — two features under
		// one name would give the hover filter, which matches on the name, two dots
		// to light up.
		allCitiesRef.current = g && !CITIES.some(c => c.n === g.n) ? [...CITIES, g] : CITIES;
	}, [props.guestCity]);

	/** A city by the name a dot carries, wherever that city's record lives. */
	function cityNamed(name: string | null): City | undefined {
		return name ? allCitiesRef.current.find(c => c.n === name) : undefined;
	}

	/**
	 * What the floating label should name, and where to put it.
	 *
	 * The hovered city, or the hovered monument when the pointer is on one of
	 * those instead — the globe carries no labels of its own, so this is the only
	 * place anything on it is named.
	 */
	function labelTarget(): { n: string; la: number; lo: number } | undefined {
		const city = cityNamed(hoveredRef.current);
		if (city) return city;
		const site = MOSQUES.find(m => m.name === hoveredSiteRef.current);
		return site ? { n: site.name, la: site.lat, lo: site.lon } : undefined;
	}

	/**
	 * City dots and the active-city ring. Their colours only change at prayer
	 * boundaries, so this is throttled — 143 features per frame would not be.
	 */
	function pushCities() {
		const map = mapRef.current;
		if (!map || !readyRef.current) return;
		const { getNowMs, activeCity } = propsRef.current;
		const nowMs = getNowMs();
		const { dec, eot, utcH } = skyState(new Date(nowMs));

		const cen = map.getCenter();
		const zoom = map.getZoom();
		const visible = (la: number, lo: number) => {
			const a =
				Math.sin(la * D) * Math.sin(cen.lat * D) +
				Math.cos(la * D) * Math.cos(cen.lat * D) * Math.cos((lo - cen.lng) * D);
			return a > (zoom > 3 ? -0.2 : 0.12);
		};
		const cities = map.getSource('cities') as maplibregl.GeoJSONSource | undefined;
		cities?.setData({
			type: 'FeatureCollection',
			features: allCitiesRef.current
				.filter(c => visible(c.la, c.lo))
				.map(c => {
					// Diyanet's own boundaries where we have them; the solar model is the
					// fallback for a scrub past the published window.
					const table = propsRef.current.phases;
					const st = (((utcH + c.lo / 15 + eot / 60) % 24) + 24) % 24;
					const blend = (table && blendOf(table, c.ilceID, nowMs)) ?? phaseBlend(c.la, st, dec);
					return {
						type: 'Feature',
						// `m` marks a site drawn as a mosque; its dot is hidden but the
						// feature stays so clicking and the active ring still work. `p` is the
						// phase, so a whole prayer can be highlighted at once.
						properties: {
							n: c.n,
							c: mixPhase(blend.phase, blend.next, blend.t),
							p: blend.phase,
							m: mosquesReadyRef.current && MOSQUE_CITIES.has(c.n) ? 1 : 0
						},
						geometry: { type: 'Point', coordinates: [c.lo, c.la] }
					};
				})
		});
		if (map.getLayer('city-active')) {
			map.setFilter('city-active', ['==', ['get', 'n'], activeCity?.n ?? '']);
		}
	}

	// --- map lifecycle -------------------------------------------------------
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		// three.js arrives asynchronously now, and this effect can be torn down
		// before it lands — StrictMode double-invokes it on mount, and cleanup then
		// runs while the import is still in flight, so there is nothing assigned yet
		// for it to dispose. Without this flag both the discarded and the live
		// effect would construct a renderer and the first one's WebGL context would
		// leak; browsers only allow a handful of those.
		let torn = false;

		const map = new maplibregl.Map({
			container: host,
			style: {
				version: 8,
				sources: {},
				layers: [{ id: 'space', type: 'background', paint: { 'background-color': '#0b0d13' } }],
				projection: { type: 'globe' }
			},
			center: [39, 20],
			zoom: 1.4,
			minZoom: 0.6,
			maxZoom: 8,
			attributionControl: { compact: true },
			dragRotate: true,
			pitchWithRotate: false
		});
		mapRef.current = map;
		if (import.meta.env.DEV) (window as unknown as { __pgmap?: MLMap }).__pgmap = map;

		/*
		 * Put an app icon inside a node we did not build with JSX.
		 *
		 * MapLibre's controls are plain DOM — its own buttons carry their glyph as a
		 * CSS background image, and ours were built with `createElement`. Rather than
		 * keep two icon systems, the React icon is mounted into the existing node, so
		 * the map's chrome is drawn from the same set as the rest of the app.
		 */
		const mountIcon = (host: HTMLElement, name: AppIconName) => {
			host.textContent = '';
			host.classList.add('pg-ctrl-icon');
			const root = createRoot(host);
			root.render(<AppIcon name={name} />);
			iconRootsRef.current.push(root);
		};

		map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

		// MapLibre draws + and − as background images on these spans. Swap in ours.
		for (const [cls, name] of [
			['.maplibregl-ctrl-zoom-in', 'plus'],
			['.maplibregl-ctrl-zoom-out', 'minus']
		] as [string, AppIconName][]) {
			const icon = map.getContainer().querySelector<HTMLElement>(`${cls} .maplibregl-ctrl-icon`);
			if (icon) mountIcon(icon, name);
		}

		// The zoom level, directly under the buttons that change it. It was only
		// ever readable in the pointer note on the far side of the map, which is a
		// long way from the control it describes.
		map.addControl(
			{
				onAdd: () => {
					const wrap = document.createElement('div');
					wrap.className = 'maplibregl-ctrl maplibregl-ctrl-group pg-zoom-readout';
					wrap.setAttribute('aria-hidden', 'true');
					zoomReadoutRef.current = wrap;
					wrap.textContent = `Zoom ${map.getZoom().toFixed(1)}`;
					return wrap;
				},
				onRemove: () => {
					zoomReadoutRef.current = null;
				}
			},
			'top-right'
		);

		// Share sits with the zoom buttons rather than in the panel: it acts on the
		// view — this city, at this moment, from here — so it belongs with the other
		// controls that act on the view. Registered as a control so MapLibre stacks
		// and spaces it exactly like them instead of it floating nearby.
		map.addControl(
			{
				onAdd: () => {
					const wrap = document.createElement('div');
					wrap.className = 'maplibregl-ctrl maplibregl-ctrl-group';
					const b = document.createElement('button');
					b.type = 'button';
					b.className = 'pg-share-ctrl';
					b.setAttribute('aria-label', 'Copy a link to this city and moment');
					b.dataset.tip = 'Copy a link to this city and moment';
					b.dataset.tipEnd = '';
					b.addEventListener('click', () => propsRef.current.onShare());
					mountIcon(b, 'share');
					wrap.appendChild(b);
					return wrap;
				},
				onRemove: () => {}
			},
			'top-right'
		);
		// No GlobeControl: it toggles the projection to flat Mercator, and every
		// other layer here — the orrery camera, the night polygon's pole handling,
		// the buildings' depth remap — is built around the globe.

		/*
		 * Turning the earth by the space around it.
		 *
		 * Space is part of the map, and grabbing out there already moved the globe —
		 * but barely. MapLibre turns the sphere by the ground under the cursor, and
		 * off the sphere there is no ground: the same 112px drag moved the earth 125°
		 * from its middle and 1° from the black beside it. It looked like the drag
		 * had been ignored.
		 *
		 * A point is on the sphere if it survives a round trip — unproject it, project
		 * it back, and on the globe it lands where it started; off the sphere MapLibre
		 * answers with the nearest place there is and it comes back hundreds of pixels
		 * away. When the grab starts out there, the drag is run as `panBy`, which is
		 * MapLibre's own screen-pixel pan of the centre — the same motion as dragging
		 * the middle of the globe, so the two feel identical.
		 */
		const onSphere = (x: number, y: number) => {
			const back = map.project(map.unproject([x, y]));
			return Math.hypot(back.x - x, back.y - y) < 2;
		};

		const spaceDrag = { active: false, x: 0, y: 0 };

		const onSpaceDown = (e: MouseEvent) => {
			if (e.button !== 0) return;
			const box = map.getCanvas().getBoundingClientRect();
			if (onSphere(e.clientX - box.left, e.clientY - box.top)) return;
			// Keep MapLibre's own drag out of it, or both would move the camera.
			e.stopPropagation();
			spaceDrag.active = true;
			spaceDrag.x = e.clientX;
			spaceDrag.y = e.clientY;
			map.getCanvas().style.cursor = 'grabbing';
		};

		const onSpaceMove = (e: MouseEvent) => {
			if (!spaceDrag.active) return;
			const dx = e.clientX - spaceDrag.x;
			const dy = e.clientY - spaceDrag.y;
			spaceDrag.x = e.clientX;
			spaceDrag.y = e.clientY;
			map.panBy([-dx, -dy], { duration: 0 });
		};

		const onSpaceUp = () => {
			if (!spaceDrag.active) return;
			spaceDrag.active = false;
			map.getCanvas().style.cursor = '';
		};

		map.getContainer().addEventListener('mousedown', onSpaceDown, { capture: true });
		window.addEventListener('mousemove', onSpaceMove);
		window.addEventListener('mouseup', onSpaceUp);

		// MapLibre's controls ship native `title`s, which the browser renders in its
		// own style after a delay of its choosing. Move them onto the same tooltip
		// the rest of the app uses, keeping the accessible name that `title` was
		// also providing. Right-aligned because these sit against the viewport edge.
		for (const el of map.getContainer().querySelectorAll<HTMLElement>('[title]')) {
			const text = el.getAttribute('title');
			if (!text) continue;
			if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', text);
			el.dataset.tip = text;
			el.dataset.tipEnd = '';
			el.removeAttribute('title');
		}

		map.on('error', e => {
			const m = e?.error?.message ?? 'unknown';
			console.error('[map]', m);
			propsRef.current.onNote('map error · ' + m.slice(0, 60));
		});

		map.on('style.load', () => {
			try {
				map.setSky({
					'sky-color': '#0d1018',
					'horizon-color': '#232742',
					'fog-color': '#191c2e',
					'sky-horizon-blend': 0.6,
					'horizon-fog-blend': 0.6,
					'fog-ground-blend': 0.4,
					'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.3, 9, 0]
				});
			} catch {
				// sky unsupported on this renderer — harmless
			}

			// World outlines arrive from TanStack Query; start empty and fill in.
			map.addSource('world', { type: 'geojson', data: EMPTY, attribution: 'Natural Earth' });
			map.addLayer({
				id: 'land',
				type: 'fill',
				source: 'world',
				paint: { 'fill-color': '#3a4052', 'fill-opacity': 1 }
			});
			// Night sits between the land fill and the country outlines. Underneath
			// it, land at night falls to rgb(25,27,37) against ocean at rgb(7,8,13) —
			// technically distinct, but it reads as one black disc, and half the globe
			// is night at any moment. Drawing the outlines on top keeps the dark side
			// legible as a wireframe earth without making it look like daytime.
			// Grid first, so land and the night wash sit over it rather than under.
			map.addSource('graticule', { type: 'geojson', data: GRATICULE });
			map.addLayer({
				id: 'graticule',
				type: 'line',
				source: 'graticule',
				paint: {
					'line-color': '#cfd3e5',
					'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.13, 4, 0.09, 8, 0.05],
					'line-width': 0.5
				}
			});

			map.addSource('night', { type: 'geojson', data: EMPTY });
			map.addLayer({
				id: 'night',
				type: 'fill',
				source: 'night',
				paint: { 'fill-color': '#04050a', 'fill-opacity': 0.7 }
			});

			map.addLayer({
				id: 'borders',
				type: 'line',
				source: 'world',
				paint: {
					'line-color': '#cfd3e5',
					// Sitting above the night fill they keep the dark side readable, but at
					// full strength a long border chain (Russia–Mongolia–China–India) reads
					// as a single smooth line across the globe and looks like a stray
					// terminator. Fade them back when zoomed out; sharpen them close in.
					'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.4, 3, 0.6, 6, 0.9],
					'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 4, 1, 8, 1.5]
				}
			});

			// Traces of where the sun and moon have travelled over the scrubbed span.
			map.addSource('paths', { type: 'geojson', data: EMPTY });
			map.addLayer({
				id: 'path-moon',
				type: 'line',
				source: 'paths',
				filter: ['==', ['get', 'k'], 'moon'],
				paint: { 'line-color': '#cfd3e5', 'line-width': 1, 'line-opacity': 0.38 }
			});
			map.addLayer({
				id: 'path-sun',
				type: 'line',
				source: 'paths',
				filter: ['==', ['get', 'k'], 'sun'],
				paint: { 'line-color': '#ffc65c', 'line-width': 1.1, 'line-opacity': 0.5 }
			});

			// The design hatches the band rather than filling it. MapLibre has no
			// built-in pattern, so one is drawn here: diagonal strokes on a
			// transparent tile, added as an image the fill can reference.
			if (!map.hasImage('pg-hatch')) {
				const size = 8;
				const cv = document.createElement('canvas');
				cv.width = size;
				cv.height = size;
				const ctx = cv.getContext('2d');
				if (ctx) {
					ctx.strokeStyle = 'rgba(181,171,252,0.85)';
					ctx.lineWidth = 1.4;
					// Two strokes, offset by the tile, so the diagonal runs unbroken
					// across tile edges instead of stopping at every seam.
					for (const d of [-size, 0]) {
						ctx.beginPath();
						ctx.moveTo(d, size);
						ctx.lineTo(d + size, 0);
						ctx.stroke();
					}
					map.addImage('pg-hatch', {
						width: size,
						height: size,
						data: new Uint8Array(ctx.getImageData(0, 0, size, size).data)
					});
				}
			}

			// The chain band: the ground currently standing in one prayer. Hatched
			// rather than flat-filled, because it sits over the night shading and a
			// solid wash would bury the countries underneath it.
			map.addSource('band', { type: 'geojson', data: EMPTY });
			map.addLayer({
				id: 'band-fill',
				type: 'fill',
				source: 'band',
				paint: { 'fill-pattern': 'pg-hatch', 'fill-opacity': 0.55 }
			});

			/*
			 * The same band, over the poles, in flat colour.
			 *
			 * MapLibre will not draw a `fill-pattern` above the Mercator tile limit —
			 * the pattern has no tile-space texture coordinates up there — but it
			 * draws a `fill-color` perfectly well: measured on this map, a solid fill
			 * paints to about 88° where the hatched one paints nothing at all. That
			 * left every band with an empty cap over the pole whose edge is a circle
			 * of latitude, which is what the "circles and half circles" were.
			 *
			 * A second source rather than a filter, because the two need different
			 * paint and the geometry is generated separately anyway.
			 */
			map.addSource('band-cap', { type: 'geojson', data: EMPTY });
			map.addLayer({
				id: 'band-cap-fill',
				type: 'fill',
				source: 'band-cap',
				// 0.42 is measured, not guessed: at that value a strip of cap reads
				// (29.5, 30.3, 44.4) against the hatch's (30.5, 31.2, 45.7) just below
				// it, so the join is invisible. The hatch's apparent tone is its
				// average over the stripes, which is why a flat colour has to be much
				// more opaque than the pattern's own 0.55 to match it.
				paint: { 'fill-color': PHASES[0].c, 'fill-opacity': 0.42 }
			});

			// Qibla: the great circle from a city to the Kaaba. Drawn beneath the city
			// dots so a line never hides the place it starts from.
			map.addSource('qibla', { type: 'geojson', data: EMPTY });
			map.addLayer({
				id: 'qibla-many',
				type: 'line',
				source: 'qibla',
				filter: ['==', ['get', 'k'], 'many'],
				paint: {
					// Faint individually, because the subject is the convergence rather
					// than any one line; a few hundred at full strength is a scribble.
					'line-color': '#7ee0b8',
					'line-width': 0.6,
					'line-opacity': 0.16
				}
			});
			map.addLayer({
				id: 'qibla-one',
				type: 'line',
				source: 'qibla',
				filter: ['==', ['get', 'k'], 'one'],
				paint: {
					'line-color': '#7ee0b8',
					'line-width': 1.6,
					'line-opacity': 0.85
				}
			});

			map.addSource('edges', { type: 'geojson', data: EMPTY });
			// Two limbs of a single circle, told apart by colour rather than by dash:
			// gold where the sun is coming up, lavender where it is going down. The
			// gold matches the sun glyph, so the lit limb reads as the sun's own edge.
			map.addLayer({
				id: 'edge-sunset',
				type: 'line',
				source: 'edges',
				filter: ['==', ['get', 'k'], 'sunset'],
				paint: { 'line-color': '#b5abfc', 'line-width': 1.5, 'line-opacity': 0.85 }
			});
			map.addLayer({
				id: 'edge-sunrise',
				type: 'line',
				source: 'edges',
				filter: ['==', ['get', 'k'], 'sunrise'],
				paint: { 'line-color': '#ffc65c', 'line-width': 1.5, 'line-opacity': 0.9 }
			});

			map.addSource('cities', { type: 'geojson', data: EMPTY });
			map.addLayer({
				id: 'cities',
				type: 'circle',
				source: 'cities',
				paint: {
					'circle-color': ['get', 'c'],
					'circle-opacity': ['case', ['==', ['get', 'm'], 1], 0, 0.9],
					'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2.4, 3, 4, 8, 7],
					'circle-stroke-color': 'rgba(12,14,20,.8)',
					'circle-stroke-width': ['case', ['==', ['get', 'm'], 1], 0, 1]
				}
			});
			map.addLayer({
				id: 'city-highlight',
				type: 'circle',
				source: 'cities',
				filter: ['==', ['get', 'p'], -1],
				paint: {
					'circle-color': ['get', 'c'],
					'circle-opacity': 0.18,
					'circle-radius': 12,
					'circle-stroke-color': ['get', 'c'],
					'circle-stroke-width': 1.4,
					'circle-stroke-opacity': 0.9
				}
			});
			map.addLayer({
				id: 'city-hover',
				type: 'circle',
				source: 'cities',
				filter: ['==', ['get', 'n'], ''],
				paint: {
					'circle-color': 'rgba(181,171,252,.10)',
					'circle-radius': 10,
					'circle-stroke-color': 'rgba(210,206,253,.75)',
					'circle-stroke-width': 1
				}
			});
			map.addLayer({
				id: 'city-active',
				type: 'circle',
				source: 'cities',
				filter: ['==', ['get', 'n'], ''],
				paint: {
					'circle-color': 'rgba(181,171,252,.18)',
					'circle-radius': 13,
					'circle-stroke-color': '#f5f4ff',
					'circle-stroke-width': 1.6
				}
			});

			/*
			 * The mosques that stand on no city.
			 *
			 * Djenné and Aya Sofya carry their own coordinates because the app ships
			 * no city there — Diyanet publishes four districts in all of Mali, none
			 * within 190 km of Djenné, and Aya Sofya shares Istanbul's one district
			 * with the Blue Mosque, which already holds that dot. So they had no
			 * feature of any kind: a building on the earth with nothing beneath it,
			 * while every other mosque sat on a city dot that was merely hidden.
			 *
			 * They get a mark of their own instead, and deliberately not a city dot:
			 * hollow, and in the models' own brass rather than a prayer colour, so it
			 * cannot be read as a place with a timetable. Nothing on this globe is
			 * allowed to imply times it does not have.
			 */
			map.addSource('sites', {
				type: 'geojson',
				data: {
					type: 'FeatureCollection',
					features: MOSQUES.filter(m => m.anchored === 'point').map(m => ({
						type: 'Feature' as const,
						properties: { n: m.name },
						geometry: { type: 'Point' as const, coordinates: [m.lon, m.lat] }
					}))
				}
			});
			map.addLayer({
				id: 'sites',
				type: 'circle',
				source: 'sites',
				paint: {
					'circle-color': 'rgba(216,176,74,.14)',
					'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2.6, 3, 4.2, 8, 7],
					'circle-stroke-color': 'rgba(216,176,74,.85)',
					'circle-stroke-width': 1.2
				}
			});
			map.addLayer({
				id: 'site-hover',
				type: 'circle',
				source: 'sites',
				filter: ['==', ['get', 'n'], ''],
				paint: {
					'circle-color': 'rgba(216,176,74,.12)',
					'circle-radius': 10,
					'circle-stroke-color': 'rgba(233,197,110,.8)',
					'circle-stroke-width': 1
				}
			});

			// Sun and moon live in their own overlay so they can orbit outside the
			// globe; city labels stay as map markers since they are always on it.
			const overlay = overlayRef.current;
			if (overlay && !bodiesRef.current) {
				const sun = glyph('sun');
				const moon = glyph('moon');
				const tip = document.createElement('div');
				tip.className = 'pg-tip';
				tip.style.opacity = '0';
				overlay.append(sun, moon, tip);
				bodiesRef.current = { sun, moon };
				tipRef.current = tip;

				const sunCv = orbCanvas(sun);
				const moonCv = orbCanvas(moon);
				const pair = bodiesRef.current;
				if (sunCv && moonCv) {
					void import('./orb')
						.then(({ createOrb }) => {
							// Identity, not truthiness. Unmounting to #/solar and back before
							// the chunk lands leaves two `.then`s pending on the same import;
							// a `bodiesRef.current` truthiness check passes in both, so the
							// first would build two renderers on the now-detached canvases
							// and the second would overwrite them without disposing —
							// leaking two WebGL contexts per cycle, against a browser limit
							// of about sixteen.
							if (torn || bodiesRef.current !== pair) return;
							// Until this lands the glyphs are just a soft halo and a label.
							orbsRef.current = {
								sun: createOrb(sunCv, 'sun', ORB_PX.sun),
								moon: createOrb(moonCv, 'moon', ORB_PX.moon)
							};
							// Constant appearance, so once is enough — the frame loop only
							// redraws the moon, whose phase and tilt actually change.
							orbsRef.current.sun.render(1, 0);
						})
						.catch(err => console.error('[orbs]', err));
				}
			}
			// Pulses stay map markers: they belong to a real point on the surface and
			// should disappear with it when it rotates behind the earth.
			if (!pulsesRef.current) {
				const sky = skyState(new Date(propsRef.current.getNowMs()));
				pulsesRef.current = {
					sun: new maplibregl.Marker({ element: pulse('sun'), opacityWhenCovered: '0' })
						.setLngLat([sky.sun.lon, sky.sun.lat])
						.addTo(map),
					moon: new maplibregl.Marker({ element: pulse('moon'), opacityWhenCovered: '0' })
						.setLngLat([sky.moon.lon, sky.moon.lat])
						.addTo(map)
				};
			}

			// The mosque sites are drawn as buildings instead of dots.
			void import('./mosqueLayer')
				.then(({ createMosqueLayer }) => {
					// The map can be torn down while this is in flight.
					if (torn || !map.getStyle()) return;
					map.addLayer(createMosqueLayer());
					// Only now is it safe to hide those cities' dots.
					mosquesReadyRef.current = true;
					pushCities();
				})
				.catch(err => console.error('[mosques]', err));

			readyRef.current = true;
			propsRef.current.onNote('Natural Earth outlines · globe');
			const tip = tipRef.current;
			if (tip) {
				// The globe carries no labels at all, so this is the only place a city
				// is named on the map.
				const city = labelTarget();
				if (city) {
					const p = map.project([city.lo, city.la]);
					tip.textContent = city.n;
					tip.style.transform = `translate(-50%, -100%) translate(${p.x.toFixed(1)}px, ${(p.y - 14).toFixed(
						1
					)}px)`;
					tip.style.opacity = '1';
				} else {
					tip.style.opacity = '0';
				}
			}

			// Forced: the sources are brand new after a style load, so there is
			// nothing to compare the clock against yet.
			pushSky(true);
			pushCities();
		});

		// Off the globe, `lngLat` still resolves to a point on the rim, which would
		// otherwise keep switching cities while the pointer is out in empty space.
		// Projecting it back and checking it lands under the cursor tells us whether
		// the pointer is really on the earth.
		/** Name of the nearest point in `layer` under a screen point, with a
		 *  forgiving hit box. */
		const nearestIn = (layer: string, pt: { x: number; y: number }): string | null => {
			if (!map.getLayer(layer)) return null;
			const box: [maplibregl.PointLike, maplibregl.PointLike] = [
				[pt.x - 7, pt.y - 7],
				[pt.x + 7, pt.y + 7]
			];
			// Several dots can fall inside the box at low zoom, and the first match is
			// not necessarily the one under the cursor — pick the closest.
			let best: string | null = null;
			let bestDist = Infinity;
			for (const f of map.queryRenderedFeatures(box, { layers: [layer] })) {
				const name = f.properties?.n;
				if (typeof name !== 'string' || f.geometry.type !== 'Point') continue;
				const [lon, lat] = f.geometry.coordinates as [number, number];
				const p = map.project([lon, lat]);
				const d = Math.hypot(p.x - pt.x, p.y - pt.y);
				if (d < bestDist) {
					bestDist = d;
					best = name;
				}
			}
			return best;
		};
		const cityAt = (pt: { x: number; y: number }) => nearestIn('cities', pt);
		/** A monument standing on no city. Only consulted where no city dot is
		 *  under the pointer, so a place with a timetable always wins the hit. */
		const siteAt = (pt: { x: number; y: number }) => nearestIn('sites', pt);

		/**
		 * The card that offers to open a mosque in the 3D viewer.
		 *
		 * In its own layer above the console strip, not on a MapLibre marker.
		 * A marker was the obvious choice — `opacityWhenCovered` would hide it
		 * when the earth turned its mosque away, for free — but every marker
		 * lives inside the map host, and the map host has no `z-index` while the
		 * console strip has `2`. Nothing inside the map can paint above the
		 * strip, whatever z-index it is given, because its own ancestor is the
		 * ceiling. A mosque near the top of the view put the card under the
		 * toolbar, half of it and its button unreachable.
		 *
		 * So it is positioned by hand in `placePopover` below, which costs one
		 * projection per frame and a facing test the marker used to do for us.
		 *
		 * Plain DOM rather than React: it is three nodes and a button, and
		 * mounting a root per press to draw them would cost more than it saves.
		 */
		const showPopover = (site: Mosque | null) => {
			popRef.current?.el.remove();
			popRef.current = null;
			if (!site) return;
			const layer = popLayerRef.current;
			if (!layer) return;

			const el = document.createElement('div');
			el.className = 'mv-pop';

			const name = document.createElement('div');
			name.className = 'mv-pop-name';
			name.textContent = site.name;
			el.append(name);

			// The city, for a mosque that stands on one. A placed mosque's `city` is
			// its own name, which would just say the title twice.
			if (site.anchored === 'city') {
				const where = document.createElement('div');
				where.className = 'mv-pop-where';
				where.textContent = site.city;
				el.append(where);
			}

			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'mv-pop-btn';
			btn.textContent = 'View in 3D';
			btn.addEventListener('click', () => {
				showPopover(null);
				propsRef.current.onOpenViewer(site.model);
			});
			el.append(btn);

			// The card is a control, not part of the map: without this, a press meant
			// to reach the button panned the earth out from under it.
			el.addEventListener('pointerdown', ev => ev.stopPropagation());
			el.addEventListener('click', ev => ev.stopPropagation());

			layer.append(el);
			popRef.current = { el, site };
			placePopover();
		};

		/**
		 * Put the card over its mosque, and take it away when the earth does.
		 *
		 * `project` answers for a point on the far side of the globe as readily as
		 * for one in front of it, so the facing test is the same dot product the
		 * dots are culled by — without it the card floats over the wrong ocean
		 * while its mosque is round the back.
		 *
		 * It sits above the point, unless there is no room above, in which case it
		 * drops below rather than climbing off the top of the window.
		 */
		function placePopover() {
			const pop = popRef.current;
			if (!pop) return;
			const cen = map.getCenter();
			const facing =
				Math.sin(pop.site.lat * D) * Math.sin(cen.lat * D) +
				Math.cos(pop.site.lat * D) * Math.cos(cen.lat * D) * Math.cos((pop.site.lon - cen.lng) * D);
			if (facing <= 0.05) {
				pop.el.style.opacity = '0';
				pop.el.style.pointerEvents = 'none';
				return;
			}
			const p = map.project([pop.site.lon, pop.site.lat]);
			/*
			 * A projection that is not a number would be written into the transform
			 * as the literal `NaNpx`, which the browser rejects — and rejecting a
			 * transform does not mean keeping the last good one, it means having
			 * none. The card would drop to the layer's top-left corner and sit
			 * there, nowhere near the mosque it names. Hide it instead.
			 */
			if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
				pop.el.style.opacity = '0';
				pop.el.style.pointerEvents = 'none';
				return;
			}
			const below = p.y - pop.el.offsetHeight - GAP < 0;
			pop.el.classList.toggle('mv-pop-below', below);
			const y = below ? p.y + GAP : p.y - GAP;
			pop.el.style.transform = `translate(-50%, ${below ? '0' : '-100%'}) translate(${p.x.toFixed(
				1
			)}px, ${y.toFixed(1)}px)`;
			pop.el.style.opacity = '1';
			pop.el.style.pointerEvents = 'auto';
		}
		/*
		 * Placed by the map's own render pass, not by this component's frame loop.
		 *
		 * Both run on requestAnimationFrame and neither waits for the other, so
		 * whichever went second read a camera the other had already moved. Flying
		 * to a city, the building is drawn by MapLibre and the card was placed
		 * from the frame before it — one frame of lag, which at flight speed is
		 * the card visibly trailing the mosque it belongs to. Hooking `render`
		 * means the card is positioned from exactly the camera that was just
		 * drawn, so the two cannot come apart.
		 */
		map.on('render', placePopover);
		// `render` covers every frame the map draws, which is every frame the
		// camera moves. `move` is the belt to that pair of braces: it fires on a
		// camera change even where a draw is somehow skipped, and it costs one
		// projection.
		map.on('move', placePopover);

		/*
		 * Anything left in the layer that this effect did not put there.
		 *
		 * A card is a plain DOM node held by a ref, not by React, so a hot reload
		 * during development can leave one behind: the module is replaced, the new
		 * `placePopover` knows nothing about the old node, and it sits wherever it
		 * last was — a card naming a mosque, stranded somewhere the mosque is not.
		 * Clearing on setup means at most one card exists, and it is always the
		 * live one.
		 */
		popLayerRef.current?.replaceChildren();

		// Escape dismisses it, as it does the viewer it opens — the card is a
		// small thing on top of the earth and should go away the same way.
		const onPopKey = (ev: KeyboardEvent) => {
			if (ev.key === 'Escape' && popRef.current) showPopover(null);
		};
		window.addEventListener('keydown', onPopKey);

		map.on('mousemove', e => {
			const back = map.project(e.lngLat);
			const onGlobe = Math.hypot(back.x - e.point.x, back.y - e.point.y) < 2.5;
			propsRef.current.onHover(onGlobe ? { lat: e.lngLat.lat, lng: e.lngLat.lng } : null);

			// Hovering only previews a city; the panel still waits for a click.
			const name = onGlobe ? cityAt(e.point) : null;
			const site = onGlobe && !name ? siteAt(e.point) : null;
			if (name !== hoveredRef.current) {
				hoveredRef.current = name;
				if (map.getLayer('city-hover')) map.setFilter('city-hover', ['==', ['get', 'n'], name ?? '']);
				propsRef.current.onCityHover(name);
			}
			if (site !== hoveredSiteRef.current) {
				hoveredSiteRef.current = site;
				if (map.getLayer('site-hover')) map.setFilter('site-hover', ['==', ['get', 'n'], site ?? '']);
				propsRef.current.onSiteHover(site);
			}
			// Set once for both: a monument is worth pointing at too, and doing this
			// inside either branch left the cursor stuck when the pointer crossed
			// straight from one kind of mark to the other.
			map.getCanvas().style.cursor = name || site ? 'pointer' : '';
		});
		map.on('mouseout', () => {
			propsRef.current.onHover(null);
			if (hoveredRef.current !== null) {
				hoveredRef.current = null;
				if (map.getLayer('city-hover')) map.setFilter('city-hover', ['==', ['get', 'n'], '']);
				propsRef.current.onCityHover(null);
			}
			if (hoveredSiteRef.current !== null) {
				hoveredSiteRef.current = null;
				if (map.getLayer('site-hover')) map.setFilter('site-hover', ['==', ['get', 'n'], '']);
				propsRef.current.onSiteHover(null);
			}
			map.getCanvas().style.cursor = '';
		});
		// Selection is explicit: only an actual city dot picks a city. A small box
		// around the pointer makes the small dots comfortably clickable.
		map.on('click', e => {
			const name = cityAt(e.point);
			if (name) {
				propsRef.current.onCitySelect(name);
				// Pressing a mosque still selects its city exactly as before. The
				// card is additive — the model is a thing you can go and look at, and
				// that was not discoverable from a building you could only fly over.
				showPopover(MOSQUE_AT_CITY.get(name) ?? null);
				return;
			}
			// A monument has no timetable to select, so clicking it goes to look at
			// it rather than changing what the panel is reading.
			const site = siteAt(e.point);
			if (site) {
				propsRef.current.onSiteSelect(site);
				showPopover(MOSQUES.find(m => m.name === site) ?? null);
				return;
			}
			// Anywhere else on the earth dismisses it.
			showPopover(null);
		});
		const emitView = () => {
			const c = map.getCenter();
			const zoom = map.getZoom();
			// Written straight to the node rather than through React: this fires on
			// every frame of a pinch, and a re-render per frame for two characters is
			// not a trade worth making.
			if (zoomReadoutRef.current) zoomReadoutRef.current.textContent = `Zoom ${zoom.toFixed(1)}`;
			propsRef.current.onView({ lng: c.lng, lat: c.lat, zoom });
		};
		map.on('move', emitView);

		const skyCanvas = skyRef.current;
		if (skyCanvas) {
			void import('./cosmos')
				.then(({ createCosmos }) => {
					if (torn || skyRef.current !== skyCanvas) return;
					cosmosRef.current = createCosmos(skyCanvas);
					// Size it here, not only in the ResizeObserver. The observer delivers
					// its first callback before the next paint, long before a 140 KB
					// chunk can arrive, and it bails when cosmosRef is still null — so
					// this used to be the one sizing call and it never happened. The
					// canvas stayed at the HTML default 300×150 with camera.aspect 1
					// while CSS stretched it across the stage, which threw the orbit
					// rings off-centre from the globe on every single load.
					skyCanvas.width = host.clientWidth;
					skyCanvas.height = host.clientHeight;
					cosmosRef.current.resize(host.clientWidth, host.clientHeight);
				})
				.catch(err => console.error('[cosmos]', err));
		}

		const ro = new ResizeObserver(() => {
			map.resize();
			const sky = skyRef.current;
			if (sky && cosmosRef.current) {
				sky.width = host.clientWidth;
				sky.height = host.clientHeight;
				cosmosRef.current.resize(host.clientWidth, host.clientHeight);
			}
		});
		ro.observe(host);

		// Everything time-driven runs here, sampling the clock directly rather than
		// reading a value off props — props only change on React's ~5 Hz tick, which
		// is what made the bodies move in visible steps.
		//
		// Markers are cheap DOM transforms, so they update every frame. Rebuilding
		// the GeoJSON sources is not, so those are throttled; at 120 ms they still
		// keep up with the fastest the terminator ever sweeps.
		let raf = 0;
		let lastLayers = 0;
		let lastPulse = 0;
		const frame = (t: number) => {
			raf = requestAnimationFrame(frame);
			if (!mapRef.current) return;

			if (propsRef.current.spin && map.getZoom() < 3.2 && !map.isMoving()) {
				const c = map.getCenter();
				map.jumpTo({ center: [c.lng + 0.05, c.lat] });
			}

			// The sky shares the globe's frame but not its canvas, so it needs the
			// measured silhouette radius to line its camera up. One measurement per
			// frame: it is an 18-step project/unproject search, and both blocks below
			// want the same number.
			const frameBox = map.getContainer();

			// Everything below moves only with the camera or the clock. A second of
			// scrubbed time is 0.004° of celestial motion — far below a pixel — so a
			// resting globe redraws once a second instead of sixty times, while
			// scrubbing and spinning still cross the threshold every frame and update
			// continuously. The container size is in the signature because the rim
			// measurement depends on it.
			const cam =
				`${map.getCenter().lng.toFixed(4)}|${map.getCenter().lat.toFixed(4)}` +
				`|${map.getZoom().toFixed(3)}|${map.getBearing().toFixed(2)}|${map.getPitch().toFixed(2)}` +
				`|${frameBox.clientWidth}x${frameBox.clientHeight}`;
			const celestialNow = propsRef.current.getNowMs();
			const celestialDirty =
				cam !== lastCamRef.current || !(Math.abs(celestialNow - lastCelestialAtRef.current) < 1000);

			if (celestialDirty) {
				lastCamRef.current = cam;
				lastCelestialAtRef.current = celestialNow;
				const frameRim = globeRadius(frameBox.clientWidth, frameBox.clientHeight);

				const cosmos = cosmosRef.current;
				if (cosmos) {
					placePlanetLabels(
						cosmos.render({
							map,
							nowMs: propsRef.current.getNowMs(),
							show: propsRef.current.showOrrery,
							rimPx: frameRim
						})
					);
				}

				const bodies = bodiesRef.current;
				if (bodies && readyRef.current) {
					const cen = map.getCenter();
					const sky = skyState(new Date(propsRef.current.getNowMs()));
					const rim = frameRim;
					positionBody(bodies.sun, sky.sun.lat, sky.sun.lon, cen, rim);
					positionBody(bodies.moon, sky.moon.lat, sky.moon.lon, cen, rim);

					// Redraw the 3D bodies, but not while they are hidden — zoomed into a
					// city both glyphs are switched off, and there is no sense running two
					// WebGL contexts to fill invisible pixels.
					const orbs = orbsRef.current;
					if (orbs && rim != null) {
						// The sun is not redrawn here. Its arguments are constant, so every
						// frame produced identical pixels through a WebGL context of its own;
						// it is rendered once when the orbs are created.
						// The moon's lit limb faces the sun, so the terminator's tilt on
						// screen is the bearing from the sub-lunar point to the sub-solar one,
						// turned from compass degrees (clockwise from up) into an angle from
						// the +x axis, and corrected for however the map itself is rotated.
						const toSun =
							bearing(sky.moon.lat, sky.moon.lon, sky.sun.lat, sky.sun.lon) - (map.getBearing() || 0);
						orbs.moon.render(sky.moon.illum, (90 - toSun) * D);
					}
					const pulses = pulsesRef.current;
					if (pulses) {
						pulses.sun.setLngLat([sky.sun.lon, sky.sun.lat]);
						pulses.moon.setLngLat([sky.moon.lon, sky.moon.lat]);
					}
				}
			}

			const tip = tipRef.current;
			if (tip) {
				// The globe carries no labels at all, so this is the only place a city
				// is named on the map.
				const city = labelTarget();
				if (city) {
					const p = map.project([city.lo, city.la]);
					tip.textContent = city.n;
					tip.style.transform = `translate(-50%, -100%) translate(${p.x.toFixed(1)}px, ${(p.y - 14).toFixed(
						1
					)}px)`;
					tip.style.opacity = '1';
				} else {
					tip.style.opacity = '0';
				}
			}

			// Pulse the highlighted set. Paint properties are set here rather than
			// animated declaratively because MapLibre has no keyframes of its own.
			if (map.getLayer('city-highlight')) {
				const phase = propsRef.current.highlightPhase;
				if (phase !== highlightRef.current) {
					highlightRef.current = phase;
					map.setFilter('city-highlight', ['==', ['get', 'p'], phase ?? -1]);
				}
				if (phase !== null && t - lastPulse > 33) {
					lastPulse = t;
					const beat = 0.5 + 0.5 * Math.sin(t / 190);
					map.setPaintProperty('city-highlight', 'circle-radius', 9 + beat * 9);
					map.setPaintProperty('city-highlight', 'circle-opacity', 0.1 + beat * 0.16);
					map.setPaintProperty('city-highlight', 'circle-stroke-opacity', 0.35 + beat * 0.55);
				}
			}

			// While the sweep runs, hold the band still and turn the earth under it.
			//
			// The band is anchored to solar time, so it slides west at exactly the
			// rate the sub-solar point does. Matching the camera to that rate parks it
			// on screen — which is the only way to actually watch one prayer travel,
			// rather than watching it leave the frame. The offset is captured when the
			// sweep starts so the view does not jump at the moment you press it.
			if (propsRef.current.sweeping) {
				// Yield while the camera is being animated or dragged, and re-anchor to
				// wherever it settles. Without this the per-frame centring fought every
				// `flyTo` — picking a different prayer mid-sweep snapped straight back,
				// because tracking overwrote the fly on the very next frame. `isMoving`
				// covers a fly and a drag alike, so this also stops the sweep wrestling
				// the pointer away from you.
				if (map.isMoving()) {
					sweepOffsetRef.current = null;
				}
				const sunLon = skyState(new Date(propsRef.current.getNowMs())).sun.lon;
				if (sweepOffsetRef.current == null) {
					sweepOffsetRef.current = map.getCenter().lng - sunLon;
				}
				const want = sunLon + sweepOffsetRef.current;
				const c = map.getCenter();
				if (Math.abs(((want - c.lng + 540) % 360) - 180) > 0.01) {
					map.setCenter([want, c.lat]);
				}
			} else if (sweepOffsetRef.current != null) {
				sweepOffsetRef.current = null;
			}

			pushSky();
			if (t - lastLayers > 250) {
				lastLayers = t;
				pushCities();
				pushQibla();
			}
			// Both per frame, for the same reason: their geometry moves continuously
			// with the clock, so anything less often reads as stepping.
			pushPaths();
			pushBand();
		};
		raf = requestAnimationFrame(frame);

		/**
		 * A hidden tab has no reason to run any of this.
		 *
		 * Browsers throttle requestAnimationFrame in background tabs but do not
		 * stop it, and the globe kept spinning, rendering three WebGL contexts and
		 * driving MapLibre's projection-error readback the whole time a user had it
		 * open behind something else. Stopping outright costs nothing: on return,
		 * the camera signature and clock have both moved, so the first frame
		 * redraws everything anyway.
		 */
		const onVisibility = () => {
			cancelAnimationFrame(raf);
			if (!document.hidden) raf = requestAnimationFrame(frame);
		};
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			torn = true;
			cancelAnimationFrame(raf);
			document.removeEventListener('visibilitychange', onVisibility);
			// Unmounting a root synchronously from inside another root's cleanup is
			// what React warns about, so let the current commit finish first.
			const roots = iconRootsRef.current;
			iconRootsRef.current = [];
			queueMicrotask(() => roots.forEach(r => r.unmount()));
			map.getContainer().removeEventListener('mousedown', onSpaceDown, { capture: true });
			window.removeEventListener('mousemove', onSpaceMove);
			window.removeEventListener('mouseup', onSpaceUp);
			window.removeEventListener('keydown', onPopKey);
			map.off('render', placePopover);
			map.off('move', placePopover);
			popRef.current?.el.remove();
			popRef.current = null;
			popLayerRef.current?.replaceChildren();
			ro.disconnect();
			readyRef.current = false;
			if (overlayRef.current) overlayRef.current.replaceChildren();
			orbsRef.current?.sun.dispose();
			orbsRef.current?.moon.dispose();
			orbsRef.current = null;
			bodiesRef.current = null;
			pulsesRef.current = null;
			tipRef.current = null;
			planetLabelsRef.current.clear();
			mapRef.current = null;
			cosmosRef.current?.dispose();
			cosmosRef.current = null;
			map.remove();
		};
	}, []);

	// World outlines, once TanStack Query has them.
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !props.worldGeo) return;
		const apply = () => {
			const src = map.getSource('world') as maplibregl.GeoJSONSource | undefined;
			if (src) src.setData(props.worldGeo!);
		};
		if (readyRef.current) apply();
		else map.once('style.load', apply);
	}, [props.worldGeo]);

	/**
	 * The "you are here" mark, for as long as App keeps it set — which is now the
	 * rest of the session.
	 *
	 * Created and destroyed with the position, not with the pulse: the pulse is a
	 * class toggled on the live element below, so the ten seconds of movement
	 * ending does not tear the marker down and put an identical one back.
	 */
	useEffect(() => {
		const map = mapRef.current;
		const at = props.mark;
		if (!map || !at) return;
		const el = document.createElement('div');
		el.className = 'pg-here';
		hereRef.current = el;
		const ring = document.createElement('span');
		ring.className = 'pg-here-ring';
		const core = document.createElement('span');
		core.className = 'pg-here-core';
		el.append(ring, core);
		const marker = new maplibregl.Marker({ element: el, opacityWhenCovered: '0' })
			.setLngLat([at.lon, at.lat])
			.addTo(map);
		return () => {
			marker.remove();
			hereRef.current = null;
		};
	}, [props.mark]);

	// The pulse, on the element that is already there.
	useEffect(() => {
		hereRef.current?.classList.toggle('pg-here-pulsing', props.markPulsing);
	}, [props.markPulsing, props.mark]);

	return (
		<>
			<div ref={hostRef} className='globe-host' />
			<canvas ref={skyRef} className='sky-canvas' />
			<div ref={overlayRef} className='bodies-layer' />
			{/* Above the console strip, which the map's own subtree can never be. */}
			<div ref={popLayerRef} className='mv-pop-layer' />
		</>
	);
});

export default Globe;
