// The design's `<three-d-stage>` viewer, as a plain module.
//
// Ported off the custom element: same studio lighting, same ground shadow, same
// orbit controls and camera framing, same OBJ/GLB export. What is dropped is the
// shell around it — the shadow DOM, the `ready` promise that existed so a module
// script could wait on the library load, and the `omelette:notify-3d-export`
// postMessage back to the design host, none of which mean anything here.
//
// Models arrive in metres, y-up, centred on the origin, exactly as the stage's
// own usage notes require, so exports inherit the scene's units and orientation.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface Stage {
	/** Show an object, framing the camera to it and resting it on the ground. */
	setObject(object: THREE.Object3D): void;
	resize(): void;
	/** Turntable until the viewer touches it, as the design's `autorotate`. */
	setAutoRotate(on: boolean): void;
	exportObj(basename: string): Promise<void>;
	exportGlb(basename: string): Promise<void>;
	dispose(): void;
}

function download(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function createStage(canvas: HTMLCanvasElement): Stage {
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		alpha: true,
		// Keeps the last frame readable after compositing, which is what lets a
		// screenshot capture the scene rather than a blank canvas.
		preserveDrawingBuffer: true
	});
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
	camera.position.set(3, 2.2, 4);

	const controls = new OrbitControls(camera, canvas);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.autoRotateSpeed = 1.2;
	controls.addEventListener('start', () => {
		controls.autoRotate = false;
	});

	// Neutral studio: a soft sky/ground wash, a shadow-casting key, and a dim
	// fill from behind so silhouettes never go black. No environment map, so
	// high metalness has nothing to reflect — which is why the design caps it.
	scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.0));
	const key = new THREE.DirectionalLight(0xffffff, 2.2);
	key.position.set(4, 7, 5);
	key.castShadow = true;
	key.shadow.mapSize.set(2048, 2048);
	key.shadow.bias = -0.0002;
	scene.add(key);
	const fill = new THREE.DirectionalLight(0xfff4e6, 0.5);
	fill.position.set(-5, 3, -4);
	scene.add(fill);

	const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.18 }));
	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = true;
	scene.add(ground);

	let object: THREE.Object3D | null = null;

	const resize = () => {
		const box = canvas.parentElement;
		const w = box?.clientWidth || canvas.clientWidth || 1;
		const h = box?.clientHeight || canvas.clientHeight || 1;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	};
	resize();

	renderer.setAnimationLoop(() => {
		controls.update();
		renderer.render(scene, camera);
	});

	/** Free a subtree's geometries and materials — models are rebuilt per body. */
	function release(root: THREE.Object3D) {
		root.traverse(o => {
			const mesh = o as THREE.Mesh;
			if (!mesh.isMesh) return;
			mesh.geometry.dispose();
			for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
				const std = m as THREE.MeshStandardMaterial;
				std.map?.dispose();
				std.bumpMap?.dispose();
				std.emissiveMap?.dispose();
				std.dispose();
			}
		});
	}

	/** Unique names for every mesh and material — they become the o/usemtl lines. */
	function nameParts(): THREE.Material[] {
		const mats: THREE.Material[] = [];
		const seen = new Set<string>();
		let meshI = 0;
		let matI = 0;
		object?.traverse(o => {
			const mesh = o as THREE.Mesh;
			if (!mesh.isMesh) return;
			if (!mesh.name) mesh.name = 'part_' + meshI;
			meshI += 1;
			for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
				if (!m || mats.includes(m)) continue;
				if (!m.name) {
					m.name = 'mat_' + matI;
					matI += 1;
				}
				while (seen.has(m.name)) {
					m.name = m.name + '_' + matI;
					matI += 1;
				}
				seen.add(m.name);
				mats.push(m);
			}
		});
		return mats;
	}

	return {
		setObject(next) {
			if (object) {
				scene.remove(object);
				release(object);
			}
			object = next;
			next.traverse(o => {
				const mesh = o as THREE.Mesh;
				if (!mesh.isMesh) return;
				mesh.castShadow = true;
				mesh.receiveShadow = true;
			});

			const box = new THREE.Box3().setFromObject(next);
			if (!box.isEmpty()) {
				// Rest the object on the ground without moving its origin.
				ground.position.y = box.min.y;
				const sphere = box.getBoundingSphere(new THREE.Sphere());
				const dist = (sphere.radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.35;
				const dir = new THREE.Vector3(1, 0.55, 1.25).normalize();
				camera.position.copy(sphere.center).add(dir.multiplyScalar(dist));
				camera.near = Math.max(dist / 100, 0.01);
				camera.far = dist * 100;
				camera.updateProjectionMatrix();
				controls.target.copy(sphere.center);
				controls.update();
				const span = sphere.radius * 3;
				const shadow = key.shadow.camera;
				shadow.left = -span;
				shadow.right = span;
				shadow.top = span;
				shadow.bottom = -span;
				shadow.updateProjectionMatrix();
			}
			scene.add(next);
		},

		resize,

		setAutoRotate(on) {
			controls.autoRotate = on;
		},

		async exportObj(basename) {
			if (!object) return;
			const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
			const mats = nameParts();
			const obj = `mtllib ${basename}.mtl\n` + new OBJExporter().parse(object);
			let mtl = '# Exported by the solar system stage\n';
			for (const m of mats) {
				const std = m as THREE.MeshStandardMaterial;
				const c = std.color ?? new THREE.Color(0.8, 0.8, 0.8);
				const rough = typeof std.roughness === 'number' ? std.roughness : 0.5;
				const opacity = typeof std.opacity === 'number' ? std.opacity : 1;
				mtl += `newmtl ${m.name}\n`;
				mtl += `Kd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}\n`;
				mtl += 'Ks 0.2000 0.2000 0.2000\n';
				mtl += `Ns ${Math.round((1 - rough) * 200)}\n`;
				mtl += `d ${opacity.toFixed(4)}\n\n`;
			}
			download(new Blob([obj], { type: 'text/plain' }), `${basename}.obj`);
			download(new Blob([mtl], { type: 'text/plain' }), `${basename}.mtl`);
		},

		async exportGlb(basename) {
			if (!object) return;
			const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
			nameParts();
			const buf = (await new GLTFExporter().parseAsync(object, { binary: true })) as ArrayBuffer;
			download(new Blob([buf], { type: 'model/gltf-binary' }), `${basename}.glb`);
		},

		dispose() {
			renderer.setAnimationLoop(null);
			controls.dispose();
			if (object) release(object);
			renderer.dispose();
		}
	};
}
