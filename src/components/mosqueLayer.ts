// Renders the design's 3D mosque at major mosque sites, drawn straight onto the
// globe through MapLibre's CustomLayerInterface with a shared WebGL context.
//
// Follows MapLibre's "add a 3D model to globe using three.js" example: the layer
// borrows the map's canvas and gl context, and each frame builds a model matrix
// that rotates the model onto the sphere, then multiplies MapLibre's own
// projection matrix by it.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CustomLayerInterface, Map as MLMap } from 'maplibre-gl'
import { buildMosque, MOSQUE_FOOTPRINT } from '../lib/mosque-model'
import { buildKaaba, KAABA_FOOTPRINT } from '../lib/kaaba-model'
import { buildNabawi, NABAWI_FOOTPRINT } from '../lib/nabawi-model'
import { MOSQUES } from '../lib/mosques'
import type { MosqueModel } from '../lib/mosques'

/** MapLibre's internal earth radius, in metres. */
const EARTH_RADIUS = 6371008.8

/**
 * How many screen pixels the mosque's footprint should span, by zoom.
 *
 * A single size cannot work across this range: at globe zoom anything big
 * enough to admire overlaps its neighbours and swamps the map, while at close
 * zoom a dot-sized model is pointless. So it stays roughly dot-scale when the
 * whole earth is in view and grows into a building as you come down.
 */
const SIZE_BY_ZOOM: [number, number][] = [
  [0.6, 11],
  [2, 15],
  [3.5, 24],
  [5, 44],
  [8, 90],
]

function targetPx(zoom: number): number {
  const stops = SIZE_BY_ZOOM
  if (zoom <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    const [z1, p1] = stops[i]
    if (zoom <= z1) {
      const [z0, p0] = stops[i - 1]
      return p0 + ((p1 - p0) * (zoom - z0)) / (z1 - z0)
    }
  }
  return stops[stops.length - 1][1]
}

/** Metres per degree of latitude — near enough anywhere for a marker scale. */
const METRES_PER_DEGREE = 111320

/** Clip-space depth and w of a globe-space point under a projection matrix. */
function clipDepth(m: THREE.Matrix4, p: THREE.Vector3): { z: number; w: number } {
  const e = m.elements
  return {
    z: e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14],
    w: e[3] * p.x + e[7] * p.y + e[11] * p.z + e[15],
  }
}

const ORIGIN = new THREE.Vector3(0, 0, 0)

/**
 * Rebuild the projection so depth stops at the globe instead of at infinity.
 *
 * MapLibre's frustum runs from a near plane of 0.5 out to a far plane tens of
 * thousands of units away — a range of about 1e5 to 1, nearly all of it empty.
 * What is left for a building standing on the surface is a handful of
 * distinguishable depth steps across its entire thickness, so its plaza, its
 * skirt and the cube itself all land on one value and the winner is whichever
 * drew last. That is what shredded the Kaaba.
 *
 * The fix leaves x and y strictly alone — they are what pins each building to
 * its city — and rewrites only the depth row. It also leaves the *near* plane
 * exactly where MapLibre put it, which matters more than it looks: zoomed in,
 * the camera hovers a few thousandths of a radius above the ground, so any
 * near reference chosen in earth radii ends up behind it and everything
 * vanishes. Only the far plane moves, in to the centre of the globe. Nothing we
 * draw is further than that, because far-side sites are culled before this.
 *
 * Since these depths no longer mean what MapLibre's do, the buffer is cleared
 * before the models are drawn.
 */
function remapDepth(main: THREE.Matrix4): THREE.Matrix4 {
  const far = clipDepth(main, ORIGIN)
  const dFar = far.z / far.w
  // Hold d = -1 fixed and send dFar to +1: k·(-1) + shift = -1 gives shift = k-1,
  // and k·dFar + shift = 1 then gives k = 2/(dFar + 1).
  if (!isFinite(dFar) || dFar <= -1 + 1e-9) return main
  const k = 2 / (dFar + 1)
  const shift = k - 1
  // Row-major here; only the z row changes, so x/y projection is untouched.
  const depth = new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, k, shift, 0, 0, 0, 1)
  return depth.multiply(main)
}

/**
 * Metres per screen pixel, measured from the projection rather than predicted.
 *
 * The Web Mercator formula (`78271 · cos(lat) / 2^zoom`) does not describe a
 * globe, and feeding it the *site's* latitude made equatorial mosques scale up
 * relative to polar ones. Measuring a short north-south step at the map centre
 * instead is exact for whatever projection and camera are actually in force,
 * and taking it at the centre avoids the foreshortening near the limb that
 * would otherwise send the scale to infinity.
 */
function metresPerPixel(map: MLMap): number {
  const c = map.getCenter()
  const step = 0.05
  const a = map.project([c.lng, c.lat])
  const b = map.project([c.lng, c.lat + step])
  const px = Math.hypot(b.x - a.x, b.y - a.y)
  if (!isFinite(px) || px < 1e-3) return 0
  return (step * METRES_PER_DEGREE) / px
}

/**
 * The three buildings, each with the ground extent it should be scaled by.
 *
 * Sizing every model by its own full extent is what keeps them comparable: the
 * Kaaba is a 13 m cube and Masjid an-Nabawi is 110 m across its cornice, so
 * scaling by a shared constant would leave one invisible and the other covering
 * half a continent. Normalising by extent instead gives each site the same
 * screen footprint, whatever it actually is on the ground.
 */
const MODELS: Record<MosqueModel, { build: () => THREE.Group; footprint: number }> = {
  mosque: { build: buildMosque, footprint: MOSQUE_FOOTPRINT },
  kaaba: { build: buildKaaba, footprint: KAABA_FOOTPRINT },
  nabawi: { build: buildNabawi, footprint: NABAWI_FOOTPRINT },
}

/**
 * Collapse a model to one mesh per material.
 *
 * The design builds each of these from ~100 small meshes, which is fine for a
 * single-object viewer but not when twenty of them redraw every frame. Merging
 * by material takes it to a handful of draw calls each.
 */
function buildMerged(build: () => THREE.Group, name: string): THREE.Group {
  const source = build()
  source.updateMatrixWorld(true)

  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>()
  source.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mat = mesh.material as THREE.Material
    let g = mesh.geometry.clone()
    g.applyMatrix4(mesh.matrixWorld)
    // The model mixes indexed primitives with non-indexed extrusions, and
    // mergeGeometries rejects a batch unless every member matches. Flattening
    // to non-indexed makes them uniform.
    if (g.index) {
      const flat = g.toNonIndexed()
      g.dispose()
      g = flat
    }
    // It also needs identical attribute sets across the batch.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
    }
    if (!g.getAttribute('uv')) {
      const count = g.getAttribute('position').count
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
    }
    const list = byMaterial.get(mat)
    if (list) list.push(g)
    else byMaterial.set(mat, [g])
  })

  const merged = new THREE.Group()
  merged.name = name
  for (const [mat, geoms] of byMaterial) {
    const g = mergeGeometries(geoms, false)
    if (!g) continue
    g.computeBoundingSphere()
    const mesh = new THREE.Mesh(g, mat)
    mesh.name = mat.name || 'part'
    merged.add(mesh)
    for (const old of geoms) old.dispose()
  }
  return merged
}

export interface MosqueLayerOptions {
  /** Called every frame with how many mosques were drawn — for diagnostics. */
  onCount?(n: number): void
}

export function createMosqueLayer(opts: MosqueLayerOptions = {}): CustomLayerInterface {
  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let camera: THREE.Camera | null = null
  let map: MLMap | null = null
  const instances: THREE.Object3D[] = []

  return {
    id: 'mosques-3d',
    type: 'custom',
    // Required so the models depth-test correctly against the globe.
    renderingMode: '3d',

    onAdd(m: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      map = m
      camera = new THREE.Camera()
      scene = new THREE.Scene()

      // No environment map here, so keep it lit from two sides plus a wash;
      // otherwise the metallic brass reads as black.
      scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4636, 1.6))
      const key = new THREE.DirectionalLight(0xfff6e2, 2.4)
      key.position.set(4, 7, 5)
      scene.add(key)
      const fill = new THREE.DirectionalLight(0xbfd0ff, 0.8)
      fill.position.set(-5, 3, -4)
      scene.add(fill)

      // One merged prototype per building, cloned per site.
      const prototypes = new Map<MosqueModel, THREE.Group>()
      for (const kind of Object.keys(MODELS) as MosqueModel[]) {
        prototypes.set(kind, buildMerged(MODELS[kind].build, `${kind}_merged`))
      }
      for (const site of MOSQUES) {
        // clone() shares geometry and material, so this costs almost nothing.
        const inst = (prototypes.get(site.model) as THREE.Group).clone()
        inst.matrixAutoUpdate = false
        inst.visible = false
        scene.add(inst)
        instances.push(inst)
      }

      renderer = new THREE.WebGLRenderer({
        canvas: m.getCanvas(),
        context: gl,
        antialias: true,
      })
      // MapLibre has already drawn the globe; do not wipe it.
      renderer.autoClear = false
    },

    onRemove() {
      renderer?.dispose()
      renderer = null
      scene = null
      camera = null
      map = null
      instances.length = 0
    },

    render(_gl, args) {
      if (!renderer || !scene || !camera || !map) return

      // `mainMatrix` already carries the globe transform for the current frame.
      const projection = (args as { defaultProjectionData?: { mainMatrix?: number[] } })
        .defaultProjectionData
      const main = projection?.mainMatrix
      if (!main) return

      const centre = map.getCenter()
      const zoom = map.getZoom()
      const rad = Math.PI / 180
      let drawn = 0

      // One target size for the whole frame, so every site is the same size on
      // screen wherever it sits on the globe; each model then divides by its own
      // footprint to reach it.
      const mpp = metresPerPixel(map)
      const spanMetres = targetPx(zoom) * mpp
      if (!isFinite(spanMetres) || spanMetres <= 0) return


      for (let i = 0; i < MOSQUES.length; i++) {
        const site = MOSQUES[i]
        const inst = instances[i]

        // Skip anything on the far side of the earth.
        const facing =
          Math.sin(site.lat * rad) * Math.sin(centre.lat * rad) +
          Math.cos(site.lat * rad) * Math.cos(centre.lat * rad) * Math.cos((site.lon - centre.lng) * rad)
        if (facing <= 0.05) {
          inst.visible = false
          continue
        }
        inst.visible = true
        drawn++

        const s = spanMetres / MODELS[site.model].footprint / EARTH_RADIUS
        inst.matrix
          .makeRotationY(site.lon * rad)
          .multiply(new THREE.Matrix4().makeRotationX(-site.lat * rad))
          .multiply(new THREE.Matrix4().makeTranslation(0, 0, 1))
          .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
          .multiply(new THREE.Matrix4().makeScale(s, s, s))
        inst.matrixWorldNeedsUpdate = true
      }

      opts.onCount?.(drawn)

      camera.projectionMatrix = remapDepth(new THREE.Matrix4().fromArray(main))

      scene.updateMatrixWorld()
      renderer.resetState()
      // Our depths are on a different scale from the globe's, so start clean.
      renderer.clearDepth()
      renderer.render(scene, camera)

      // No triggerRepaint here. These models are static geometry with no
      // self-animation, and asking for another frame from inside the render
      // meant the map never stopped drawing — a permanent 60 Hz GPU load on
      // battery even with the globe motionless. MapLibre already repaints on
      // any camera change, which is the only thing that moves them.
    },
  }
}
