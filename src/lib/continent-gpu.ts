import type { Map as GlobeMap, CustomLayerInterface, CustomRenderMethodInput } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { City } from './cities';
import type { Continent } from './continents';
import { CONTINENTS, cityContinent } from './continents';
import type { PhaseTable } from './phases';
import { blendOf } from './phases';
import { phaseBlend, skyState } from './astro';
import { mixPhase } from './prayer-colors';
import { createContinentSurfaces } from './continent-surface';
import { continentOutlines } from './continent-layout';
import { CONTINENT_VERTEX, CONTINENT_FRAGMENT } from './continent-shaders';

export interface ContinentFrame {
	world: FeatureCollection;
	cities: City[];
	phases: PhaseTable | null;
	now: number;
	progress: number;
	selected: Continent | null;
	hoveredContinent: Continent | null;
	activeCity: string | null;
	hoveredCity: string | null;
	highlightPhase: number | null;
	pieces: Float32Array;
	center: [number, number];
}
interface BufferSet {
	vao: WebGLVertexArrayObject;
	buffer: WebGLBuffer;
	count: number;
}
interface Program {
	program: WebGLProgram;
	uniforms: Map<string, WebGLUniformLocation | null>;
}
const STRIDE = 11;
const ID = 'continent-pieces';
const radians = Math.PI / 180;

function vertex(lon: number, lat: number, continent: number, id: number): number[] {
	const latitude = lat * radians,
		longitude = lon * radians;
	const mercatorY =
		(1 - Math.log(Math.tan(Math.PI / 4 + (Math.max(-89.999, Math.min(89.999, lat)) * radians) / 2)) / Math.PI) / 2;
	return [
		(lon + 180) / 360,
		mercatorY,
		Math.sin(longitude) * Math.cos(latitude),
		Math.sin(latitude),
		Math.cos(longitude) * Math.cos(latitude),
		continent,
		id,
		1,
		1,
		1,
		-1
	];
}

function compile(gl: WebGL2RenderingContext, input: CustomRenderMethodInput): Program {
	const shaders = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].map((kind, index) => {
		const shader = gl.createShader(kind)!;
		const source =
			index === 0
				? '#version 300 es\nprecision highp float;\nprecision highp int;\n' +
					input.shaderData.vertexShaderPrelude +
					'\n' +
					input.shaderData.define +
					'\n' +
					CONTINENT_VERTEX
				: CONTINENT_FRAGMENT;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			const error = gl.getShaderInfoLog(shader);
			gl.deleteShader(shader);
			throw new Error(error ?? 'Continent shader failed');
		}
		return shader;
	});
	const program = gl.createProgram()!;
	shaders.forEach(shader => gl.attachShader(program, shader));
	gl.linkProgram(program);
	shaders.forEach(shader => gl.deleteShader(shader));
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const error = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw new Error(error ?? 'Continent program failed');
	}
	return { program, uniforms: new Map() };
}

function buffer(gl: WebGL2RenderingContext, data: Float32Array): BufferSet {
	const vao = gl.createVertexArray()!,
		buffer = gl.createBuffer()!;
	gl.bindVertexArray(vao);
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
	for (const [index, size, offset] of [
		[0, 2, 0],
		[1, 3, 2],
		[2, 1, 5],
		[3, 1, 6],
		[4, 3, 7],
		[5, 1, 10]
	]) {
		gl.enableVertexAttribArray(index);
		gl.vertexAttribPointer(index, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
	}
	gl.bindVertexArray(null);
	return { vao, buffer, count: data.length / STRIDE };
}

/** Static geometry stays on the GPU; camera frames only update uniforms. */
export function createContinentGpu(map: GlobeMap, onError: (error: Error) => void) {
	let gl: WebGL2RenderingContext | null = null;
	let frame: ContinentFrame | null = null;
	let lastInput: CustomRenderMethodInput | null = null;
	let world: FeatureCollection | null = null,
		cities: City[] | null = null;
	let land: BufferSet | null = null,
		coast: BufferSet | null = null,
		dots: BufferSet | null = null;
	let dotData = new Float32Array();
	let colorsAt = -Infinity;
	let phases: PhaseTable | null = null;
	const cityIds = new Map<string, number>();
	const programs = new Map<string, Program>();
	let framebuffer: WebGLFramebuffer | null = null,
		texture: WebGLTexture | null = null;
	let pickWidth = 0,
		pickHeight = 0;
	let isContextLost = false;
	let isPickDirty = true,
		hasFailed = false;
	let lastPick = { x: -1, y: -1, id: 0 };
	const pixel = new Uint8Array(4);
	const deleteBuffer = (value: BufferSet | null) => {
		if (value && gl) {
			gl.deleteVertexArray(value.vao);
			gl.deleteBuffer(value.buffer);
		}
	};
	const prepare = () => {
		if (!gl || !frame) return;
		if (world !== frame.world) {
			world = frame.world;
			const fill: number[] = [],
				lines: number[] = [];
			for (const surface of createContinentSurfaces(world)) {
				const continent = CONTINENTS.indexOf(surface.continent);
				for (const triangle of surface.triangles)
					for (const [lon, lat] of triangle) fill.push(...vertex(lon, lat, continent, continent + 1));
			}
			for (const feature of continentOutlines(world).features) {
				const continent = CONTINENTS.indexOf(feature.properties!.continent as Continent);
				for (const segment of feature.geometry.coordinates)
					for (const [lon, lat] of segment) lines.push(...vertex(lon, lat, continent, continent + 1));
			}
			deleteBuffer(land);
			deleteBuffer(coast);
			land = buffer(gl, new Float32Array(fill));
			coast = buffer(gl, new Float32Array(lines));
		}
		if (cities !== frame.cities) {
			cities = frame.cities;
			cityIds.clear();
			dotData = new Float32Array(cities.length * STRIDE);
			cities.forEach((city, index) => {
				const id = index + 8;
				cityIds.set(city.n, id);
				dotData.set(vertex(city.lo, city.la, CONTINENTS.indexOf(cityContinent(city)), id), index * STRIDE);
			});
			deleteBuffer(dots);
			dots = buffer(gl, dotData);
			colorsAt = -Infinity;
		}
		if (Math.abs(frame.now - colorsAt) >= 120 || phases !== frame.phases) {
			phases = frame.phases;
			colorsAt = frame.now;
			const { dec, eot, utcH } = skyState(new Date(frame.now));
			cities!.forEach((city, index) => {
				const hour = (((utcH + city.lo / 15 + eot / 60) % 24) + 24) % 24;
				const phase =
					(frame!.phases && blendOf(frame!.phases, city.ilceID, frame!.now)) ??
					phaseBlend(city.la, hour, dec);
				const color = mixPhase(phase.phase, phase.next, phase.t);
				const channels = color.startsWith('#')
					? [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16))
					: (color.match(/[\d.]+/g) ?? []).map(Number);
				for (let channel = 0; channel < 3; channel++)
					dotData[index * STRIDE + 7 + channel] = (channels[channel] ?? 0) / 255;
				dotData[index * STRIDE + 10] = phase.phase;
			});
			gl.bindBuffer(gl.ARRAY_BUFFER, dots!.buffer);
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, dotData);
		}
	};
	const draw = (input: CustomRenderMethodInput, isPick: boolean) => {
		if (!gl || !frame || !land || !coast || !dots) return;
		let program = programs.get(input.shaderData.variantName);
		if (!program) {
			program = compile(gl, input);
			programs.set(input.shaderData.variantName, program);
		}
		gl.useProgram(program.program);
		const uniform = (name: string) => {
			if (!program!.uniforms.has(name))
				program!.uniforms.set(name, gl!.getUniformLocation(program!.program, name));
			return program!.uniforms.get(name)!;
		};
		const projection = input.defaultProjectionData;
		gl.uniformMatrix4fv(uniform('u_projection_matrix'), false, new Float32Array(projection.mainMatrix));
		gl.uniformMatrix4fv(
			uniform('u_projection_fallback_matrix'),
			false,
			new Float32Array(projection.fallbackMatrix)
		);
		gl.uniform4fv(uniform('u_projection_tile_mercator_coords'), projection.tileMercatorCoords);
		gl.uniform4fv(uniform('u_projection_clipping_plane'), projection.clippingPlane);
		gl.uniform1f(uniform('u_projection_transition'), projection.projectionTransition);
		const width = map.getContainer().clientWidth,
			height = map.getContainer().clientHeight;
		gl.uniform2f(uniform('u_viewport'), width, height);
		gl.uniform2fv(uniform('u_center'), frame.center);
		gl.uniform3fv(uniform('u_pieces[0]'), frame.pieces);
		gl.uniform1f(uniform('u_pixel_ratio'), gl.drawingBufferWidth / width);
		const zoom = map.getZoom(),
			radius = zoom < 3 ? 2.4 + (Math.max(0, zoom) / 3) * 1.6 : 4 + (Math.min(5, zoom - 3) / 5) * 3;
		gl.uniform1f(uniform('u_highlight'), frame.highlightPhase ?? -1);
		gl.uniform1f(uniform('u_radius'), radius);
		gl.uniform1f(uniform('u_progress'), frame.progress);
		gl.uniform1f(uniform('u_selected'), frame.selected ? CONTINENTS.indexOf(frame.selected) : -1);
		gl.uniform1f(
			uniform('u_hover_continent'),
			frame.hoveredContinent ? CONTINENTS.indexOf(frame.hoveredContinent) : -1
		);
		gl.uniform1f(uniform('u_active'), frame.activeCity ? cityIds.get(frame.activeCity) ?? -1 : -1);
		gl.uniform1f(uniform('u_hover'), frame.hoveredCity ? cityIds.get(frame.hoveredCity) ?? -1 : -1);
		const sun = skyState(new Date(frame.now)).sun;
		const latitude = sun.lat * radians,
			longitude = sun.lon * radians;
		gl.uniform3f(
			uniform('u_sun'),
			Math.sin(longitude) * Math.cos(latitude),
			Math.sin(latitude),
			Math.cos(longitude) * Math.cos(latitude)
		);
		gl.uniform1i(uniform('u_pick'), isPick ? 1 : 0);
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.SCISSOR_TEST);
		if (isPick) gl.disable(gl.BLEND);
		else {
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		}
		gl.uniform1i(uniform('u_kind'), 0);
		gl.bindVertexArray(land.vao);
		gl.drawArrays(gl.TRIANGLES, 0, land.count);
		if (!isPick) {
			gl.uniform1i(uniform('u_kind'), 1);
			gl.bindVertexArray(coast.vao);
			gl.lineWidth(1);
			gl.drawArrays(gl.LINES, 0, coast.count);
		}
		gl.uniform1i(uniform('u_kind'), 2);
		gl.bindVertexArray(dots.vao);
		gl.drawArrays(gl.POINTS, 0, dots.count);
		gl.bindVertexArray(null);
	};
	const onContextLost = () => {
		isContextLost = true;
	};
	const onContextRestored = () => {
		isContextLost = false;
		world = null;
		cities = null;
		land = null;
		coast = null;
		dots = null;
		framebuffer = null;
		texture = null;
		pickWidth = 0;
		pickHeight = 0;
		programs.clear();
		hasFailed = false;
		isPickDirty = true;
		map.triggerRepaint();
	};
	const layer: CustomLayerInterface = {
		id: ID,
		type: 'custom',
		renderingMode: '2d',
		onAdd(_map, context) {
			gl = context;
			map.on('webglcontextlost', onContextLost);
			map.on('webglcontextrestored', onContextRestored);
		},
		render(context, input) {
			if (!frame || frame.progress === 0 || hasFailed || isContextLost) return;
			gl = context;
			lastInput = input;
			try {
				prepare();
				draw(input, false);
				isPickDirty = true;
			} catch (error) {
				hasFailed = true;
				onError(error instanceof Error ? error : new Error(String(error)));
			}
		},
		onRemove() {
			map.off('webglcontextlost', onContextLost);
			map.off('webglcontextrestored', onContextRestored);
			if (!gl) return;
			deleteBuffer(land);
			deleteBuffer(coast);
			deleteBuffer(dots);
			programs.forEach(program => gl!.deleteProgram(program.program));
			programs.clear();
			gl.deleteFramebuffer(framebuffer);
			gl.deleteTexture(texture);
			gl = null;
		}
	};
	map.addLayer(layer);
	return {
		get hasFailed() {
			return hasFailed;
		},
		update(next: ContinentFrame | null) {
			frame = next;
			isPickDirty = true;
			map.triggerRepaint();
		},
		pick(point: { x: number; y: number }) {
			if (!gl || !frame || !lastInput || hasFailed || isContextLost) return null;
			const width = gl.drawingBufferWidth,
				height = gl.drawingBufferHeight;
			const x = Math.floor((point.x * width) / map.getContainer().clientWidth),
				y = height - 1 - Math.floor((point.y * height) / map.getContainer().clientHeight);
			if (x < 0 || y < 0 || x >= width || y >= height) return null;
			if (isPickDirty || x !== lastPick.x || y !== lastPick.y) {
				const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
				const previousProgram = gl.getParameter(gl.CURRENT_PROGRAM);
				const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
				const previousBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
				const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
				const viewport = gl.getParameter(gl.VIEWPORT);
				const blend = [
					gl.getParameter(gl.BLEND_SRC_RGB),
					gl.getParameter(gl.BLEND_DST_RGB),
					gl.getParameter(gl.BLEND_SRC_ALPHA),
					gl.getParameter(gl.BLEND_DST_ALPHA)
				];
				const lineWidth = gl.getParameter(gl.LINE_WIDTH);
				const flags = [gl.BLEND, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.DITHER].map(
					flag => [flag, gl!.isEnabled(flag)] as const
				);
				try {
					if (!framebuffer) {
						framebuffer = gl.createFramebuffer();
						texture = gl.createTexture();
					}
					gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
					if (width !== pickWidth || height !== pickHeight) {
						pickWidth = width;
						pickHeight = height;
						isPickDirty = true;
						gl.bindTexture(gl.TEXTURE_2D, texture);
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
						gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
						gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
					}
					if (isPickDirty) {
						gl.viewport(0, 0, width, height);
						gl.disable(gl.SCISSOR_TEST);
						gl.disable(gl.DITHER);
						gl.clearBufferfv(gl.COLOR, 0, new Float32Array(4));
						draw(lastInput, true);
						isPickDirty = false;
					}
					gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
					lastPick = { x, y, id: pixel[0] + pixel[1] * 256 + pixel[2] * 65536 };
				} finally {
					gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
					gl.useProgram(previousProgram);
					gl.bindVertexArray(previousVao);
					gl.bindBuffer(gl.ARRAY_BUFFER, previousBuffer);
					gl.bindTexture(gl.TEXTURE_2D, previousTexture);
					gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
					gl.blendFuncSeparate(blend[0], blend[1], blend[2], blend[3]);
					gl.lineWidth(lineWidth);
					flags.forEach(([flag, isEnabled]) => (isEnabled ? gl!.enable(flag) : gl!.disable(flag)));
				}
			}
			const id = lastPick.id;
			if (id >= 8) {
				const city = cities?.[id - 8];
				return city ? { city: city.n, continent: cityContinent(city) } : null;
			}
			return id > 0 && id <= 7 ? { city: null, continent: CONTINENTS[id - 1] } : null;
		},
		dispose() {
			if (map.getLayer(ID)) map.removeLayer(ID);
		}
	};
}
