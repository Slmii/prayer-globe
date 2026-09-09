import type { Map as GlobeMap, FilterSpecification } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { City } from './cities';
import type { PhaseTable } from './phases';
import { CONTINENTS, CONTINENT_CENTERS } from './continents';
import type { Continent } from './continents';
import { createContinentGpu } from './continent-gpu';

interface State {
	world: FeatureCollection | undefined;
	cities: City[];
	phases: PhaseTable | null;
	activeCity: string | null;
	hoveredCity: string | null;
	hoveredContinent: Continent | null;
	highlightPhase: number | null;
	now: number;
}
interface Options {
	state(): State;
	onError(error: Error): void;
}
const LAYERS = [
	'land',
	'borders',
	'cities',
	'city-highlight',
	'city-hover',
	'city-active',
	'continent-hover',
	'continent-selected',
	'sites',
	'site-hover'
];

/** Keep the existing globe camera while the GPU moves flat continent pieces. */
export function createContinentExplosion(map: GlobeMap, options: Options) {
	let progress = 0,
		lastTime: number | null = null,
		lastSelected: Continent | null = null;
	let hasHiddenLayers = false,
		hasMovingPieces = false;
	/** Pending one-frame handover back to the ordinary map layers. */
	let clearHandle = 0;
	let lastFrame = '';
	let lastWorld: FeatureCollection | undefined,
		lastCities: City[] | null = null,
		lastPhases: PhaseTable | null = null;
	const visibility = new Map<string, 'visible' | 'none'>();
	const pieces = new Float32Array(CONTINENTS.length * 3);
	CONTINENTS.forEach((_, index) => (pieces[index * 3 + 2] = 1));
	let center: [number, number] = [0, 0];
	const setVisibility = (isHidden: boolean) => {
		if (isHidden === hasHiddenLayers) return;
		hasHiddenLayers = isHidden;
		for (const id of LAYERS) {
			if (!map.getLayer(id)) continue;
			if (isHidden) {
				visibility.set(id, map.getLayoutProperty(id, 'visibility') === 'none' ? 'none' : 'visible');
				map.setLayoutProperty(id, 'visibility', 'none');
			} else if (visibility.has(id)) {
				map.setLayoutProperty(id, 'visibility', visibility.get(id));
				visibility.delete(id);
			}
		}
	};
	const gpu = createContinentGpu(map, error => {
		setVisibility(false);
		options.onError(error);
	});
	const project = (location: [number, number], continent: Continent) => {
		const point = map.project(location),
			index = CONTINENTS.indexOf(continent) * 3;
		return {
			x: center[0] + (point.x - center[0]) * pieces[index + 2] + pieces[index],
			y: center[1] + (point.y - center[1]) * pieces[index + 2] + pieces[index + 1]
		};
	};
	return {
		layers(base: string) {
			return [base];
		},
		setFilter(base: string, filter: FilterSpecification) {
			map.setFilter(base, filter);
		},
		setPaint(
			base: string,
			property: Parameters<GlobeMap['setPaintProperty']>[1],
			value: Parameters<GlobeMap['setPaintProperty']>[2]
		) {
			map.setPaintProperty(base, property, value);
		},
		project,
		get isSeparated() {
			return progress > 0 && !gpu.hasFailed;
		},
		pick(point: { x: number; y: number }) {
			return gpu.pick(point);
		},
		dispose() {
			if (clearHandle) {
				cancelAnimationFrame(clearHandle);
				clearHandle = 0;
			}
			setVisibility(false);
			gpu.dispose();
		},
		update(now: number, selected: Continent | null, isReducedMotion: boolean) {
			if (gpu.hasFailed) return;
			const delta = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.1);
			lastTime = now;
			const target = selected ? 1 : 0;
			progress = isReducedMotion ? target : progress + (target - progress) * (1 - Math.exp(-delta * 9));
			if (Math.abs(progress - target) < 0.001) progress = target;
			if (clearHandle) {
				cancelAnimationFrame(clearHandle);
				clearHandle = 0;
			}
			if (progress === 0) {
				if (hasHiddenLayers) {
					/*
					 * Hand back in the order that overlaps rather than the one that
					 * leaves a hole.
					 *
					 * The pieces are drawn by the custom GPU layer; the land, borders
					 * and city dots underneath it are ordinary MapLibre layers that
					 * were switched off while it had the floor. Clearing the GPU frame
					 * first meant a paint where the pieces had gone and MapLibre had
					 * not yet re-evaluated the layers coming back — one frame of empty
					 * globe, read as a flicker at the end of every reassembly.
					 *
					 * At this point both are drawing the same earth in the same place,
					 * so a frame of both is invisible while a frame of neither is not.
					 * Visibility goes back first and the pieces are dropped on the
					 * next frame, once the real layers have had one to paint in.
					 */
					setVisibility(false);
					pieces.fill(0);
					CONTINENTS.forEach((_, index) => (pieces[index * 3 + 2] = 1));
					lastFrame = '';
					clearHandle = requestAnimationFrame(() => {
						clearHandle = 0;
						// Unless a continent was picked again in the meantime, in which
						// case the pieces are wanted and the next update redraws them.
						if (progress === 0) gpu.update(null);
					});
				}
				return;
			}
			const state = options.state();
			if (!state.world) return;
			const camera = map.getCenter(),
				container = map.getContainer();
			const signature = [
				camera.lng,
				camera.lat,
				map.getZoom(),
				map.getBearing(),
				map.getPitch(),
				container.clientWidth,
				container.clientHeight,
				progress,
				selected,
				state.activeCity,
				state.hoveredCity,
				state.hoveredContinent,
				state.highlightPhase,
				Math.floor(state.now / 120)
			].join('|');
			if (
				signature === lastFrame &&
				!hasMovingPieces &&
				state.world === lastWorld &&
				state.cities === lastCities &&
				state.phases === lastPhases
			)
				return;
			lastFrame = signature;
			lastWorld = state.world;
			lastCities = state.cities;
			lastPhases = state.phases;
			if (selected) lastSelected = selected;
			const emphasized = selected ?? lastSelected;
			const origin = map.project(camera);
			center = [origin.x, origin.y];
			const radians = Math.PI / 180;
			const sinLat = Math.sin(camera.lat * radians),
				cosLat = Math.cos(camera.lat * radians);
			hasMovingPieces = false;
			CONTINENTS.forEach((continent, index) => {
				const [lon, lat] = CONTINENT_CENTERS[continent],
					point = map.project([lon, lat]);
				const depth =
					Math.sin(lat * radians) * sinLat +
					Math.cos(lat * radians) * cosLat * Math.cos((lon - camera.lng) * radians);
				const strength = continent === emphasized ? 0.72 : 0.46;
				const desired = [
					(point.x - center[0]) * strength * progress,
					(point.y - center[1]) * strength * progress,
					1 + Math.max(0, depth) * progress * (continent === emphasized ? 0.24 : 0.08)
				];
				const offset = index * 3;
				const distance =
					Math.abs(pieces[offset] - desired[0]) +
					Math.abs(pieces[offset + 1] - desired[1]) +
					Math.abs(pieces[offset + 2] - desired[2]) * Math.max(container.clientWidth, container.clientHeight);
				const isSettled = distance < 0.05;
				hasMovingPieces ||= !isReducedMotion && !isSettled;
				const blend = isReducedMotion || isSettled ? 1 : 1 - Math.exp(-delta * 16);
				for (let component = 0; component < 3; component++)
					pieces[offset + component] += (desired[component] - pieces[offset + component]) * blend;
			});
			gpu.update({ ...state, world: state.world, progress, selected: emphasized, pieces, center });
			setVisibility(true);
		}
	};
}
