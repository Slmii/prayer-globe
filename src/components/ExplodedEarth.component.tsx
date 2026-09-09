import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	AmbientLight,
	Color,
	DirectionalLight,
	BufferGeometry,
	Float32BufferAttribute,
	Points,
	LineSegments,
	LineBasicMaterial,
	Mesh,
	MeshStandardMaterial,
	PerspectiveCamera,
	Raycaster,
	Scene,
	SphereGeometry,
	Vector2,
	Vector3,
	WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { FeatureCollection } from 'geojson';
import { CITIES } from '../lib/cities';
import type { City } from '../lib/cities';
import { CONTINENTS, CONTINENT_CENTERS, cityContinent } from '../lib/continents';
import type { Continent } from '../lib/continents';
import { buildContinents } from '../lib/continent-model';
import { skyDirection } from '../lib/analemma-sky';
import { phaseBlend, skyState } from '../lib/astro';
import { blendOf } from '../lib/phases';
import { mixPhase } from '../lib/prayer-colors';
import type { PhaseTable } from '../lib/phases';
import { continentOutlines } from '../lib/continent-layout';
import { createPrayerDotMaterial } from '../lib/prayer-dot-material';

interface Props {
	initialContinent: Continent;
	world: FeatureCollection;
	phases: PhaseTable | null;
	guestCity: City | null;
	activeCity: { n: string } | null;
	highlightPhase: number | null;
	getNowMs(): number;
	onCitySelect(name: string): void;
	onCityHover(name: string | null): void;
	onClose(): void;
}

export function ExplodedEarth(props: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const propsRef = useRef(props);
	const [selected, setSelected] = useState(props.initialContinent);
	const [hovered, setHovered] = useState<Continent | null>(null);
	const hoveredRef = useRef<Continent | null>(null);
	const hoveredCityRef = useRef<string | null>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);
	const navigateRef = useRef<(name: Continent) => void>(() => {});
	const [isClosing, setIsClosing] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [hasError, setHasError] = useState(false);
	const selectedRef = useRef(selected);
	const closingRef = useRef(false);
	const cities = useMemo(
		() =>
			props.guestCity && !CITIES.some(city => city.n === props.guestCity!.n)
				? [...CITIES, props.guestCity]
				: CITIES,
		[props.guestCity]
	);
	const selectedCities = useMemo(() => cities.filter(city => cityContinent(city) === selected), [cities, selected]);

	useEffect(() => {
		propsRef.current = props;
	}, [props]);
	useEffect(() => {
		selectedRef.current = selected;
	}, [selected]);
	const close = useCallback(() => {
		if (hasError) {
			propsRef.current.onClose();
			return;
		}
		closingRef.current = true;
		setIsClosing(true);
	}, [hasError]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		let renderer: WebGLRenderer;
		try {
			renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
		} catch {
			setHasError(true);
			setIsLoading(false);
			return;
		}
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		const scene = new Scene();
		const camera = new PerspectiveCamera(42, 1, 0.1, 100);
		const controls = new OrbitControls(camera, canvas);
		controls.enablePan = false;
		controls.minDistance = 5;
		controls.maxDistance = 20;
		const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
		const { groups, materials } = buildContinents(props.world);
		for (const group of groups.values()) scene.add(group);
		scene.add(new AmbientLight('#b7cae0', 1.4));
		const key = new DirectionalLight('#fff3dd', 3);
		key.position.set(-4, 6, 8);
		scene.add(key);
		const rim = new DirectionalLight('#a0bbff', 2);
		rim.position.set(5, -1, -5);
		scene.add(rim);
		const core = new Mesh(
			new SphereGeometry(1.82, 64, 48),
			new MeshStandardMaterial({ color: '#121d2b', metalness: 0.4, roughness: 0.6 })
		);
		scene.add(core);
		const dotMaterial = createPrayerDotMaterial(renderer.getPixelRatio());
		const dots = CONTINENTS.map(continent => {
			const members = cities.filter(city => cityContinent(city) === continent);
			const geometry = new BufferGeometry();
			geometry.setAttribute(
				'position',
				new Float32BufferAttribute(
					members.flatMap(city => skyDirection(city.lo, city.la).multiplyScalar(2.035).toArray()),
					3
				)
			);
			geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(members.length * 3), 3));
			geometry.setAttribute('state', new Float32BufferAttribute(new Float32Array(members.length), 1));
			const mesh = new Points(geometry, dotMaterial);
			mesh.userData.cities = members;
			groups.get(continent)!.add(mesh);
			return { mesh, members };
		});
		const borders = new Map<Continent, LineSegments>();
		for (const feature of continentOutlines(props.world).features) {
			const name = feature.properties!.continent as Continent;
			const vertices: number[] = [];
			for (const segment of feature.geometry.coordinates) {
				const [a, b] = segment;
				const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
				for (let step = 0; step < steps; step++)
					for (const fraction of [step / steps, (step + 1) / steps]) {
						vertices.push(
							...skyDirection(a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction)
								.multiplyScalar(2.012)
								.toArray()
						);
					}
			}
			const line = new LineSegments(
				new BufferGeometry().setAttribute('position', new Float32BufferAttribute(vertices, 3)),
				new LineBasicMaterial({ color: '#f4c56a', transparent: true, opacity: 0.95 })
			);
			line.visible = false;
			groups.get(name)!.add(line);
			borders.set(name, line);
		}
		const color = new Color();
		const ray = new Raycaster();
		const pointer = new Vector2();
		let start = new Vector2();
		const down = (event: PointerEvent) => {
			start = new Vector2(event.clientX, event.clientY);
		};
		const pickables = [
			core,
			...[...groups.values()].flatMap(group =>
				group.children.filter(child => child instanceof Mesh || child instanceof Points)
			)
		];
		const hitAt = (event: MouseEvent) => {
			const bounds = canvas.getBoundingClientRect();
			pointer.set(
				((event.clientX - bounds.left) / bounds.width) * 2 - 1,
				(-(event.clientY - bounds.top) / bounds.height) * 2 + 1
			);
			ray.params.Points.threshold =
				(camera.position.length() * 2 * Math.tan((camera.fov * Math.PI) / 360) * 7) / bounds.height;
			ray.setFromCamera(pointer, camera);
			return ray.intersectObjects(pickables, false)[0];
		};
		const click = (event: MouseEvent) => {
			if (closingRef.current || start.distanceTo(new Vector2(event.clientX, event.clientY)) > 6) return;
			const hit = hitAt(event);
			if (!hit) return;
			if (hit.object instanceof Points && hit.index !== undefined)
				propsRef.current.onCitySelect((hit.object.userData.cities as City[])[hit.index].n);
			else if (hit.object.userData.continent) {
				setSelected(hit.object.userData.continent as Continent);
				navigateRef.current(hit.object.userData.continent as Continent);
			}
		};
		const move = (event: MouseEvent) => {
			const hit = hitAt(event);
			const city =
				hit?.object instanceof Points && hit.index !== undefined
					? (hit.object.userData.cities as City[])[hit.index]
					: null;
			const continent = city
				? cityContinent(city)
				: (hit?.object.userData.continent as Continent | undefined) ?? null;
			hoveredRef.current = continent;
			setHovered(continent);
			if (hoveredCityRef.current !== (city?.n ?? null)) {
				hoveredCityRef.current = city?.n ?? null;
				propsRef.current.onCityHover(city?.n ?? null);
			}
			canvas.style.cursor = city || continent ? 'pointer' : 'grab';
			const tip = tooltipRef.current;
			if (tip) {
				const box = canvas.getBoundingClientRect();
				tip.textContent = city?.n ?? '';
				tip.style.opacity = city ? '1' : '0';
				tip.style.transform =
					'translate(-50%, -100%) translate(' +
					(event.clientX - box.left) +
					'px, ' +
					(event.clientY - box.top - 14) +
					'px)';
			}
		};
		const leave = () => {
			hoveredRef.current = null;
			hoveredCityRef.current = null;
			setHovered(null);
			propsRef.current.onCityHover(null);
			if (tooltipRef.current) tooltipRef.current.style.opacity = '0';
		};
		canvas.addEventListener('mousemove', move);
		canvas.addEventListener('mouseleave', leave);
		canvas.addEventListener('pointerdown', down);
		canvas.addEventListener('click', click);
		const resize = () => {
			const bounds = canvas.getBoundingClientRect();
			if (!bounds.width || !bounds.height) return;
			renderer.setSize(bounds.width, bounds.height, false);
			camera.aspect = bounds.width / bounds.height;
			camera.updateProjectionMatrix();
		};
		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		resize();
		const [initialLon, initialLat] = CONTINENT_CENTERS[props.initialContinent];
		camera.position.copy(skyDirection(initialLon, initialLat)).multiplyScalar(10 / Math.min(camera.aspect, 1));
		controls.update();
		let previous = performance.now();
		let progress = 0;
		let lastDots = -Infinity;
		let lastSelected = props.initialContinent;
		let isFlying = false;
		const stopFlight = () => {
			isFlying = false;
		};
		controls.addEventListener('start', stopFlight);
		const cameraTarget = new Vector3();
		navigateRef.current = name => {
			const [lon, lat] = CONTINENT_CENTERS[name];
			cameraTarget.copy(skyDirection(lon, lat)).multiplyScalar(10 / Math.min(camera.aspect, 1));
			isFlying = true;
		};
		const onLost = (event: Event) => {
			event.preventDefault();
			setHasError(true);
		};
		canvas.addEventListener('webglcontextlost', onLost);
		const normalColor = new Color('#687788');
		const selectedColor = new Color('#c3b488');
		setIsLoading(false);
		renderer.setAnimationLoop(now => {
			const elapsed = Math.min((now - previous) / 1000, 0.05);
			previous = now;
			if (document.hidden) return;
			controls.enableDamping = !motion.matches;
			progress = motion.matches
				? closingRef.current
					? 0
					: 1
				: Math.max(0, Math.min(1, progress + elapsed * (closingRef.current ? -1.6 : 1.1)));
			const ease = progress * progress * (3 - 2 * progress);
			if (lastSelected !== selectedRef.current) {
				lastSelected = selectedRef.current;
				const [lon, lat] = CONTINENT_CENTERS[lastSelected];
				cameraTarget.copy(skyDirection(lon, lat)).multiplyScalar(10 / Math.min(camera.aspect, 1));
				isFlying = true;
			}
			if (isFlying && !closingRef.current) {
				camera.position.lerp(cameraTarget, motion.matches ? 1 : 1 - Math.exp(-elapsed * 4));
				if (camera.position.distanceTo(cameraTarget) < 0.01) isFlying = false;
			}
			for (const [name, group] of groups) {
				const [lon, lat] = CONTINENT_CENTERS[name];
				const isSelected = name === selectedRef.current;
				const border = borders.get(name)!;
				border.visible = hoveredRef.current === name;
				const target = skyDirection(lon, lat).multiplyScalar(ease * (isSelected ? 1.45 : 0.7));
				group.position.lerp(target, motion.matches || closingRef.current ? 1 : 1 - Math.exp(-elapsed * 8));
				materials
					.get(name)!
					.color.lerp(
						isSelected ? selectedColor : normalColor,
						motion.matches ? 1 : 1 - Math.exp(-elapsed * 8)
					);
			}
			if (now - lastDots > 120) {
				lastDots = now;
				const current = propsRef.current;
				const ms = current.getNowMs();
				const { dec, eot, utcH } = skyState(new Date(ms));
				for (const { mesh, members } of dots) {
					members.forEach((city, index) => {
						const hour = (((utcH + city.lo / 15 + eot / 60) % 24) + 24) % 24;
						const blend =
							(current.phases && blendOf(current.phases, city.ilceID, ms)) ??
							phaseBlend(city.la, hour, dec);
						color.set(mixPhase(blend.phase, blend.next, blend.t));
						const colors = mesh.geometry.getAttribute('color');
						colors.setXYZ(index, color.r, color.g, color.b);
						const states = mesh.geometry.getAttribute('state');
						states.setX(
							index,
							city.n === current.activeCity?.n
								? 1
								: current.highlightPhase === blend.phase
									? 2
									: city.n === hoveredCityRef.current
										? 3
										: 0
						);
					});
					mesh.geometry.getAttribute('color').needsUpdate = true;
					mesh.geometry.getAttribute('state').needsUpdate = true;
				}
			}
			controls.update();
			renderer.render(scene, camera);
			if (closingRef.current && progress === 0) {
				renderer.setAnimationLoop(null);
				propsRef.current.onClose();
			}
		});
		return () => {
			renderer.setAnimationLoop(null);
			observer.disconnect();
			controls.removeEventListener('start', stopFlight);
			controls.dispose();
			canvas.removeEventListener('pointerdown', down);
			canvas.removeEventListener('click', click);
			canvas.removeEventListener('mousemove', move);
			canvas.removeEventListener('mouseleave', leave);
			canvas.removeEventListener('webglcontextlost', onLost);
			for (const group of groups.values())
				group.traverse(child => {
					if (child instanceof Mesh) child.geometry.dispose();
				});
			materials.forEach(material => material.dispose());
			dots.forEach(({ mesh }) => mesh.geometry.dispose());
			borders.forEach(line => {
				line.geometry.dispose();
				(line.material as LineBasicMaterial).dispose();
			});
			navigateRef.current = () => {};
			dotMaterial.dispose();
			core.geometry.dispose();
			core.material.dispose();
			renderer.dispose();
		};
	}, [props.world, cities, props.initialContinent]);

	return (
		<section className='inline-earth' aria-label='Exploded globe'>
			<canvas
				ref={canvasRef}
				aria-label='Spherical continent pieces. Drag to rotate; click a city dot for prayer times.'
			/>
			<div ref={tooltipRef} className='pg-tip inline-earth-tip' />
			{isLoading && (
				<p className='earth-status' role='status'>
					Building continent pieces…
				</p>
			)}
			{hasError && (
				<p className='earth-status' role='alert'>
					The globe view could not load. Return to the globe to retry.
				</p>
			)}
			<nav className='continent-navigation' aria-label='Explore continents'>
				<span className='continent-navigation-label'>
					{hovered ?? selected} · {selectedCities.length} city dots · Click a dot for prayer times
				</span>
				<div>
					{CONTINENTS.map(name => (
						<button
							type='button'
							key={name}
							aria-pressed={selected === name}
							disabled={isClosing}
							onClick={() => {
								setSelected(name);
								navigateRef.current(name);
							}}
						>
							{name}
						</button>
					))}
					<button type='button' onClick={close} disabled={isClosing}>
						{isClosing ? 'Reassembling…' : 'Return to globe'}
					</button>
				</div>
			</nav>
		</section>
	);
}
