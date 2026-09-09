import { ShaderMaterial } from 'three';

/** Screen-sized circles with the globe's dark stroke and selection rings. */
export function createPrayerDotMaterial(pixelRatio: number) {
	return new ShaderMaterial({
		transparent: true,
		depthWrite: false,
		uniforms: { pixelRatio: { value: pixelRatio } },
		vertexShader: `
			attribute vec3 color;
			attribute float state;
			uniform float pixelRatio;
			varying vec3 dotColor;
			varying float dotState;
			varying float radius;
			void main() {
				dotColor = color;
				dotState = state;
				radius = state > 0.5 ? (state < 1.5 ? 13.0 : (state < 2.5 ? 12.0 : 10.0)) : 4.4;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				gl_PointSize = radius * 2.0 * pixelRatio;
			}
		`,
		fragmentShader: `
			varying vec3 dotColor;
			varying float dotState;
			varying float radius;
			void main() {
				float distance = length(gl_PointCoord - 0.5) * radius * 2.0;
				if (distance > radius) discard;
				vec3 ink = vec3(0.0037, 0.0044, 0.0070);
				float alpha = 0.0;
				if (dotState > 0.5) {
					ink = dotState < 1.5 ? vec3(0.913, 0.904, 1.0) : (dotState < 2.5 ? dotColor : vec3(0.645, 0.617, 0.982));
					alpha = distance > radius - 1.4 ? 0.85 : 0.15;
				}
				if (distance < 4.4) { ink = vec3(0.0037, 0.0044, 0.0070); alpha = 0.8; }
				if (distance < 3.4) { ink = dotColor; alpha = 0.9; }
				gl_FragColor = vec4(ink, alpha);
				#include <colorspace_fragment>
			}
		`
	});
}
