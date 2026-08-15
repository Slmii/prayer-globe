// The sky around the globe: stars, orbits and planets, on their own canvas.
//
// This started life as a MapLibre custom layer, which does not work: MapLibre's
// projection frustum is sized for the globe's surface, so anything out at one
// and a half earth radii is clipped away — the orbits simply stopped where they
// met the planet, whether or not depth testing was on.
//
// So the sky gets its own transparent canvas over the map, with a camera we
// control. To keep it welded to the globe, that camera is placed along the
// map's centre direction at a distance chosen so the unit sphere projects to
// exactly the globe's on-screen radius. An invisible sphere writes depth
// without colour, which is what hides the half of each orbit that really is
// behind the earth while leaving the near half drawn across it.

import * as THREE from 'three'
import type { Map as MLMap } from 'maplibre-gl'
import { planetStates, eclipticPole, gmstDeg, PLANETS } from '../lib/planets'

const D = Math.PI / 180

/** Orbit radii in earth radii — schematic spacing, real angles. */
const RING_RADII = [1.45, 1.78, 2.12, 2.5, 2.92]
const BODY_RADIUS = 0.045
const RING_SEGMENTS = 256
const STAR_COUNT = 3200
const STAR_SHELL = 40
const FOV = 45

/** Fully drawn at or below the first zoom, gone by the second. */
const FADE_FROM = 1.9
const FADE_TO = 2.6

export interface PlanetLabel {
  name: string
  color: string
  x: number
  y: number
  visible: boolean
}

/** Unit vector for a lat/lon, matching MapLibre's globe space (polar axis +Y). */
function direction(lat: number, lon: number, out = new THREE.Vector3()) {
  const phi = lat * D
  const lam = lon * D
  return out.set(Math.cos(phi) * Math.sin(lam), Math.sin(phi), Math.cos(phi) * Math.cos(lam))
}

/**
 * A star field on the celestial sphere.
 *
 * Positions are drawn uniformly over the sphere (via an even distribution in
 * cos(dec), so they do not bunch at the poles), then thickened along the
 * galactic plane so the Milky Way reads as a band rather than an even dusting.
 */
function buildStars(): THREE.Points {
  const pos = new Float32Array(STAR_COUNT * 3)
  const col = new Float32Array(STAR_COUNT * 3)
  const sizes = new Float32Array(STAR_COUNT)
  const v = new THREE.Vector3()
  // Galactic pole, roughly — used only to bias where stars cluster.
  const galacticPole = direction(27.1, 192.9).normalize()

  let i = 0
  let guard = 0
  while (i < STAR_COUNT && guard < STAR_COUNT * 40) {
    guard++
    const dec = Math.asin(2 * Math.random() - 1) / D
    const ra = Math.random() * 360
    direction(dec, ra, v)
    // Reject a share of stars far from the galactic plane.
    const offPlane = Math.abs(v.dot(galacticPole))
    if (Math.random() > 0.35 + 0.65 * (1 - offPlane) ** 6) continue

    v.multiplyScalar(STAR_SHELL)
    pos[i * 3] = v.x
    pos[i * 3 + 1] = v.y
    pos[i * 3 + 2] = v.z

    // Mostly white, a few warm and a few blue — enough to feel observed.
    const t = Math.random()
    const warm = t > 0.86
    const blue = t < 0.12
    const b = 0.6 + Math.random() * 0.4
    col[i * 3] = b * (warm ? 1 : blue ? 0.82 : 0.96)
    col[i * 3 + 1] = b * (warm ? 0.88 : 0.95)
    col[i * 3 + 2] = b * (warm ? 0.72 : blue ? 1 : 0.98)
    sizes[i] = Math.random() < 0.05 ? 3.2 : 1.1 + Math.random() * 1.2
    i++
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, i * 3), 3))
  g.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, i * 3), 3))
  g.setAttribute('size', new THREE.BufferAttribute(sizes.subarray(0, i), 1))

  // A tiny custom shader keeps stars a constant pixel size rather than scaling
  // with distance, which is what they do in life.
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float a = smoothstep(0.5, 0.1, length(d));
        gl_FragColor = vec4(vColor, a);
      }
    `,
    vertexColors: true,
  })

  return new THREE.Points(g, material)
}

export interface CosmosFrame {
  map: MLMap
  nowMs: number
  show: boolean
  /** Globe silhouette radius in CSS pixels, or null when it fills the view. */
  rimPx: number | null
}

export function createCosmos(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400)

  // Stars sit in the celestial frame; the group is spun by GMST each frame so
  // they stay fixed in the sky while the earth turns beneath them.
  const sky = new THREE.Group()
  const stars = buildStars()
  sky.add(stars)
  scene.add(sky)

  // Writes depth but no colour: the stand-in for the earth, so the far half of
  // each orbit is hidden and the near half is not.
  const occluder = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshBasicMaterial({ colorWrite: false }),
  )
  occluder.renderOrder = -1
  scene.add(occluder)

  const orbits = new THREE.Group()
  scene.add(orbits)

  const rings: THREE.LineLoop[] = []
  const bodies: THREE.Mesh[] = []
  for (let i = 0; i < PLANETS.length; i++) {
    const colour = new THREE.Color(PLANETS[i].color)
    const pts: THREE.Vector3[] = []
    for (let k = 0; k < RING_SEGMENTS; k++) {
      const t = (k / RING_SEGMENTS) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(t), 0, Math.sin(t)))
    }
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.3 }),
    )
    ring.scale.setScalar(RING_RADII[i])
    orbits.add(ring)
    rings.push(ring)

    const body = new THREE.Mesh(
      new THREE.SphereGeometry(BODY_RADIUS, 20, 14),
      new THREE.MeshBasicMaterial({ color: colour }),
    )
    body.matrixAutoUpdate = false
    scene.add(body)
    bodies.push(body)
  }

  const tmp = new THREE.Vector3()
  const viewDir = new THREE.Vector3()

  return {
    resize(w: number, h: number) {
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    },

    dispose() {
      renderer.dispose()
    },

    /** Draw one frame; returns where to put the planet name tags. */
    render({ map, nowMs, show, rimPx }: CosmosFrame): PlanetLabel[] {
      const w = canvas.clientWidth
      const h = canvas.clientHeight

      // Without a measurable rim the camera cannot be matched to the globe, so
      // the depth sphere lands at the wrong size and orbits show straight
      // through the earth. That only happens once the globe overflows the
      // viewport — by which point an orrery is meaningless anyway, so it is
      // faded out before then rather than propped up with a guess.
      const zoom = map.getZoom()
      const fade =
        zoom <= FADE_FROM ? 1 : zoom >= FADE_TO ? 0 : 1 - (zoom - FADE_FROM) / (FADE_TO - FADE_FROM)
      const live = show && fade > 0.01 && rimPx != null && w > 0 && h > 0
      canvas.style.opacity = live ? String(fade) : '0'
      if (!live) {
        renderer.clear()
        return []
      }

      const date = new Date(nowMs)
      const centre = map.getCenter()

      // Match MapLibre's globe: pick the camera distance that projects the unit
      // sphere to the silhouette radius the map is actually drawing. Without a
      // rim (zoomed right in) fall back to something sane.
      const px = rimPx as number
      const tanHalf = Math.tan((FOV / 2) * D)
      const theta = Math.atan(((px / (h / 2)) * tanHalf) / 1)
      const dist = Math.max(1.05, 1 / Math.max(Math.sin(theta), 1e-3))

      direction(centre.lat, centre.lng, viewDir)
      camera.position.copy(viewDir).multiplyScalar(dist)
      camera.up.set(0, 1, 0)
      camera.lookAt(0, 0, 0)
      if (map.getBearing()) camera.rotateZ(map.getBearing() * D)
      camera.updateMatrixWorld()

      // Stars are inertial: undo the earth's rotation for this instant.
      sky.rotation.y = -gmstDeg(date) * D

      // Tilt the orbit plane to the ecliptic.
      const pole = eclipticPole(date)
      orbits.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction(pole.lat, pole.lon))
      orbits.updateMatrixWorld(true)

      const states = planetStates(date)
      const labels: PlanetLabel[] = []
      for (let i = 0; i < states.length; i++) {
        const p = states[i]
        const at = direction(p.lat, p.lon).multiplyScalar(RING_RADII[i])
        bodies[i].matrix.makeTranslation(at.x, at.y, at.z)
        bodies[i].matrixWorldNeedsUpdate = true

        tmp.copy(at).project(camera)
        // Behind the earth's centre along the view axis and inside its
        // silhouette: the same test the occluder applies to the pixels.
        const along = at.dot(viewDir)
        const perp = tmp.set(at.x, at.y, at.z).addScaledVector(viewDir, -along).length()
        const ndc = at.clone().project(camera)
        labels.push({
          name: p.name,
          color: p.color,
          x: (ndc.x * 0.5 + 0.5) * w,
          y: (1 - (ndc.y * 0.5 + 0.5)) * h,
          visible: ndc.z > -1 && ndc.z < 1 && !(along < 0 && perp < 1),
        })
      }

      renderer.render(scene, camera)
      return labels
    },
  }
}
