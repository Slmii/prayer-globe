import { useEffect, useRef, useState } from 'react';
import {
	AmbientLight,
	BufferGeometry,
	CatmullRomCurve3,
	Color,
	DirectionalLight,
	Group,
	Line,
	LineBasicMaterial,
	Mesh,
	MeshStandardMaterial,
	PerspectiveCamera,
	Scene,
	SphereGeometry,
	TubeGeometry,
	Vector3,
	WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Analemma } from '../lib/analemma';
import { fitSky, sampleSky, skyDirection } from '../lib/analemma-sky';

interface Props {
	figure: Analemma;
	day: number;
	isPlaying: boolean;
	isReducedMotion: boolean;
}

const COLORS = { sun: '#f4c56a', light: '#fff4da', path: '#b5abfc', grid: '#566178', night: '#6f63ad' };

export function AnalemmaSky({ figure, day, isPlaying, isReducedMotion }: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const viewRef = useRef<{ renderer: WebGLRenderer; camera: PerspectiveCamera; controls: OrbitControls } | null>(
		null
	);
	const stateRef = useRef({ day, isPlaying, isReducedMotion });
	const resetRef = useRef<() => void>(() => {});
	const [hasError, setHasError] = useState(false);
	useEffect(() => {
		stateRef.current = { day, isPlaying, isReducedMotion };
	}, [day, isPlaying, isReducedMotion]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		let renderer: WebGLRenderer;
		try {
			renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
		} catch {
			setHasError(true);
			return;
		}
		setHasError(false);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		const camera = new PerspectiveCamera(40, 1, 0.01, 100);
		const controls = new OrbitControls(camera, canvas);
		controls.enablePan = false;
		controls.minDistance = 4;
		controls.maxDistance = 16;
		viewRef.current = { renderer, camera, controls };
		return () => {
			renderer.setAnimationLoop(null);
			controls.dispose();
			renderer.dispose();
			viewRef.current = null;
		};
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		const view = viewRef.current;
		if (!canvas || !view) return;
		const { renderer, camera, controls } = view;
		const scene = new Scene();
		const { positions, project } = fitSky(figure.points);
		const geometry = new SphereGeometry(1, 20, 12);
		const object = new Group();
		scene.add(object, new AmbientLight(COLORS.path, 1.6));
		const key = new DirectionalLight(COLORS.light, 4);
		key.position.set(-3, 5, 6);
		scene.add(key);
		const rim = new DirectionalLight(COLORS.path, 3);
		rim.position.set(4, 1, -4);
		scene.add(rim);

		const path = new CatmullRomCurve3(positions, true, 'centripetal');
		const tube = new Mesh(
			new TubeGeometry(path, positions.length * 2, 0.018, 8, true),
			new MeshStandardMaterial({ color: COLORS.path, metalness: 0.55, roughness: 0.3 })
		);
		object.add(tube);
		const bead = (position: Vector3, size: number, color: string) => {
			const mesh = new Mesh(
				geometry,
				new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, roughness: 0.3 })
			);
			mesh.position.copy(position);
			mesh.scale.setScalar(size);
			object.add(mesh);
			return mesh;
		};
		figure.points.forEach((point, index) => {
			if (new Date(point.dateMs).getUTCDate() === 1) bead(positions[index], 0.038, COLORS.light);
		});
		const crossings = figure.crossings.map(crossing => ({
			day: crossing.at,
			mesh: bead(sampleSky(positions, crossing.at), 0.052, crossing.color)
		}));
		const sun = bead(positions[0], 0.085, COLORS.sun);
		const trail = Array.from({ length: 24 }, (_, index) => {
			const mesh = bead(positions[0], 0.012 + (1 - index / 24) * 0.02, COLORS.sun);
			mesh.material.transparent = true;
			mesh.material.opacity = (1 - index / 24) * 0.65;
			return mesh;
		});

		// Crop the sky graticule to the same local patch as the year of positions.
		const addGrid = (points: Vector3[], isHorizon = false) => {
			let segment: Vector3[] = [];
			const flush = () => {
				if (segment.length > 1)
					object.add(
						new Line(
							new BufferGeometry().setFromPoints(segment),
							new LineBasicMaterial({
								color: isHorizon ? COLORS.sun : COLORS.grid,
								transparent: true,
								opacity: isHorizon ? 0.45 : 0.22
							})
						)
					);
				segment = [];
			};
			for (const point of points) {
				if (point.length() <= 2.7) segment.push(point);
				else flush();
			}
			flush();
		};
		for (let alt = -90; alt <= 90; alt += 10) {
			addGrid(
				Array.from({ length: 361 }, (_, az) => project(az, alt)),
				alt === 0
			);
		}
		for (let az = 0; az < 360; az += 15) {
			addGrid(Array.from({ length: 181 }, (_, index) => project(az, index - 90)));
		}

		const home = skyDirection(figure.azRef + 18, 12);
		const reset = () => {
			camera.position.copy(home).multiplyScalar(7 / Math.min(camera.aspect, 1));
			camera.lookAt(0, 0, 0);
			controls.target.set(0, 0, 0);
			controls.update();
		};
		resetRef.current = reset;
		const resize = () => {
			const { width, height } = canvas.getBoundingClientRect();
			if (!width || !height) return;
			renderer.setSize(width, height, false);
			const previousAspect = camera.aspect;
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
			if (camera.position.length() === 0) reset();
			else camera.position.multiplyScalar(Math.min(previousAspect, 1) / Math.min(camera.aspect, 1));
			controls.update();
		};
		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		resize();
		const onLost = (event: Event) => {
			event.preventDefault();
			setHasError(true);
		};
		canvas.addEventListener('webglcontextlost', onLost);
		const sunColor = new Color(COLORS.sun);
		const nightColor = new Color(COLORS.night);
		renderer.setAnimationLoop(() => {
			if (document.hidden) return;
			const current = stateRef.current;
			controls.enableDamping = !current.isReducedMotion;
			controls.update();
			sampleSky(positions, current.day, sun.position);
			const point = figure.points[Math.round(current.day) % positions.length];
			sun.material.color.copy(point.alt >= 0 ? sunColor : nightColor);
			sun.material.emissive.copy(sun.material.color);
			trail.forEach((mesh, index) => {
				mesh.visible = current.isPlaying && !current.isReducedMotion;
				sampleSky(positions, current.day - (index + 1) * 0.6, mesh.position);
			});
			crossings.forEach(crossing => {
				const distance = Math.abs(current.day - crossing.day) % positions.length;
				const near = Math.max(0, 1 - Math.min(distance, positions.length - distance) / 6);
				crossing.mesh.material.emissiveIntensity = 0.3 + near * 2;
			});
			renderer.render(scene, camera);
		});
		return () => {
			renderer.setAnimationLoop(null);
			observer.disconnect();
			canvas.removeEventListener('webglcontextlost', onLost);
			geometry.dispose();
			object.traverse(child => {
				if (child instanceof Mesh || child instanceof Line) {
					if (child.geometry !== geometry) child.geometry.dispose();
					const materials = Array.isArray(child.material) ? child.material : [child.material];
					materials.forEach(material => material.dispose());
				}
			});
			resetRef.current = () => {};
		};
	}, [figure]);

	return (
		<div className='ana-sky'>
			<canvas
				ref={canvasRef}
				aria-label='Three-dimensional analemma: drag to orbit; use Chart for labelled measurements.'
			/>
			{hasError ? (
				<p className='ana-sky-status' role='status'>
					3D is unavailable. Select Chart to explore the year.
				</p>
			) : (
				<div className='ana-sky-caption'>
					<span>
						Drag to orbit · Scroll to zoom
						<br />
						True sky positions · Gold grid line marks the horizon
					</span>
					<button type='button' className='ana-play' onClick={() => resetRef.current()}>
						Reset view
					</button>
				</div>
			)}
		</div>
	);
}
