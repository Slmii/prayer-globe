// The solar bodies from the design's `planets-model.js`, ported off the
// <three-d-stage> viewer shell so they can be dropped into any scene.
//
// Drawing recipes — colour stops, seeds, counts, alphas, ellipse coordinates,
// band counts, wobble values — are unchanged from the design; every surface
// is a procedural texture painted onto a 1024x512 canvas at build time. Earth
// is deliberately omitted: the app's globe already *is* the earth, so its
// continent atlas and cloud shell have no user here. Materials and textures
// are built fresh on every `buildBody()` call, never cached at module scope.

import * as THREE from 'three'

/** Radius every body is modelled at. Callers scale from this. */
export const PLANET_RADIUS = 2

export type BodyId =
  | 'sun'
  | 'mercury'
  | 'venus'
  | 'moon'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'

/** Ids above, in the order they're drawn. */
export const BODY_IDS: BodyId[] = [
  'sun',
  'mercury',
  'venus',
  'moon',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
]

/* ---------- procedural surface textures ---------- */

const TW = 1024
const TH = 512

function canvas2d(w = TW, h = TH): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return [c, ctx]
}

function rnd(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/** latitude colour ramp */
function ramp(ctx: CanvasRenderingContext2D, stops: [number, string][]) {
  const g = ctx.createLinearGradient(0, 0, 0, TH)
  for (const [t, c] of stops) g.addColorStop(t, c)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, TW, TH)
}

/** horizontal turbulent bands (gas giants) */
function bands(
  ctx: CanvasRenderingContext2D,
  count: number,
  colors: string[],
  seed: number,
  wobble = 14,
  alpha = 0.9,
) {
  const r = rnd(seed)
  for (let i = 0; i < count; i++) {
    const y = (i / count) * TH
    const h = (TH / count) * (0.6 + r() * 0.9)
    ctx.globalAlpha = alpha * (0.4 + r() * 0.6)
    ctx.fillStyle = colors[Math.floor(r() * colors.length)]
    ctx.beginPath()
    ctx.moveTo(0, y)
    for (let x = 0; x <= TW; x += 32)
      ctx.lineTo(x, y + Math.sin((x / TW) * Math.PI * (2 + r() * 5) + i) * wobble)
    for (let x = TW; x >= 0; x -= 32)
      ctx.lineTo(x, y + h + Math.sin((x / TW) * Math.PI * (2 + r() * 5) + i * 2) * wobble)
    ctx.closePath()
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** speckled craters / mottling */
function speckle(
  ctx: CanvasRenderingContext2D,
  n: number,
  seed: number,
  minR: number,
  maxR: number,
  light: string,
  dark: string,
) {
  const r = rnd(seed)
  for (let i = 0; i < n; i++) {
    const x = r() * TW
    const y = r() * TH
    const rad = minR + r() * (maxR - minR)
    const shade = r() > 0.5 ? light : dark
    ctx.globalAlpha = 0.1 + r() * 0.4
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
    g.addColorStop(0, shade)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, rad, 0, 7)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** irregular blobs (continents, storms) */
function blobs(
  ctx: CanvasRenderingContext2D,
  n: number,
  seed: number,
  color: string,
  scale = 1,
) {
  const r = rnd(seed)
  ctx.fillStyle = color
  for (let i = 0; i < n; i++) {
    const cx = r() * TW
    const cy = 60 + r() * (TH - 120)
    const rad = (26 + r() * 78) * scale
    ctx.globalAlpha = 0.55 + r() * 0.45
    ctx.beginPath()
    for (let a = 0; a <= 24; a++) {
      const th = (a / 24) * Math.PI * 2
      const rr = rad * (0.55 + r() * 0.75)
      const x = cx + Math.cos(th) * rr * 1.6
      const y = cy + Math.sin(th) * rr * 0.8
      if (a) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** wobbly ellipse in geographic degrees on an equirectangular map */
function landmass(
  ctx: CanvasRenderingContext2D,
  list: [number, number, number, number][],
  color: string,
  seed: number,
  alpha = 1,
  grow = 1,
) {
  const r = rnd(seed)
  ctx.fillStyle = color
  ctx.globalAlpha = alpha
  for (const [lon, lat, wDeg, hDeg] of list) {
    const cx = ((lon + 180) / 360) * TW
    const cy = ((90 - lat) / 180) * TH
    const rx = ((wDeg / 360) * TW / 2) * grow
    const ry = ((hDeg / 180) * TH / 2) * grow
    ctx.beginPath()
    const n = 34
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * Math.PI * 2
      const k = 0.78 + r() * 0.42
      const x = cx + Math.cos(th) * rx * k
      const y = cy + Math.sin(th) * ry * k
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function tex(draw: (ctx: CanvasRenderingContext2D) => void) {
  const [c, ctx] = canvas2d()
  draw(ctx)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** greyscale height map from the same recipe, for bump */
function bumpFrom(draw: (ctx: CanvasRenderingContext2D) => void) {
  const [c, ctx] = canvas2d()
  draw(ctx)
  ctx.globalCompositeOperation = 'saturation'
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, TW, TH)
  return new THREE.CanvasTexture(c)
}

/* ---------- bodies ---------- */

interface Body {
  id: BodyId
  name: string
  tilt: number
  emissive?: number
  emissiveIntensity?: number
  corona?: boolean
  rough?: number
  bump?: number
  oblate?: number
  rings?: { inner: number; outer: number; thin?: boolean }
  draw: (ctx: CanvasRenderingContext2D) => void
}

const BODIES: Body[] = [
  {
    id: 'sun',
    name: 'Sun',
    tilt: 7.25,
    emissive: 0xff9c2a,
    emissiveIntensity: 0.85,
    corona: true,
    rough: 0.95,
    draw: (ctx) => {
      ramp(ctx, [
        [0, '#ffb52e'],
        [0.5, '#ffd873'],
        [1, '#ff9b1e'],
      ])
      speckle(ctx, 2600, 7, 3, 16, '#fff3c4', '#d9600e')
      blobs(ctx, 26, 11, 'rgba(196,74,10,.5)', 0.5)
      blobs(ctx, 40, 3, 'rgba(255,246,214,.45)', 0.3)
    },
  },
  {
    id: 'mercury',
    name: 'Mercury',
    tilt: 0.03,
    rough: 0.95,
    bump: 0.055,
    draw: (ctx) => {
      ramp(ctx, [
        [0, '#7d746d'],
        [0.5, '#a4988e'],
        [1, '#6f6862'],
      ])
      speckle(ctx, 3400, 21, 4, 30, '#cbbfb4', '#4a443f')
      speckle(ctx, 400, 5, 20, 62, '#d6cbc0', '#3f3a36')
    },
  },
  {
    id: 'venus',
    name: 'Venus',
    tilt: 177.4,
    rough: 0.68,
    draw: (ctx) => {
      ramp(ctx, [
        [0, '#d9b072'],
        [0.45, '#f1dfae'],
        [1, '#cfa465'],
      ])
      bands(ctx, 22, ['#e8cf95', '#f6ecc8', '#c8994f'], 33, 30, 0.55)
      blobs(ctx, 34, 9, 'rgba(255,246,219,.4)', 1.1)
    },
  },
  {
    id: 'moon',
    name: 'Moon',
    tilt: 6.68,
    rough: 0.97,
    bump: 0.075,
    draw: (ctx) => {
      ramp(ctx, [
        [0, '#b9b3a9'],
        [0.5, '#cdc7bd'],
        [1, '#b3ada3'],
      ])
      /* maria — the dark basalt seas, roughly where they fall on the near side */
      landmass(
        ctx,
        [
          [-20, 32, 30, 26],
          [-4, 18, 22, 20],
          [6, 38, 24, 18],
          [-42, 20, 20, 18],
          [-16, -8, 26, 20],
          [18, 12, 16, 14],
          [-60, 40, 18, 16],
          [30, -22, 20, 16],
        ],
        '#8d8880',
        47,
        0.85,
      )
      speckle(ctx, 4200, 23, 3, 26, '#e4dfd6', '#6d675f')
      speckle(ctx, 320, 5, 24, 74, '#efeae2', '#5a544d')
      /* Tycho's bright ray system */
      const r = rnd(31)
      ctx.strokeStyle = 'rgba(240,236,228,.5)'
      for (let i = 0; i < 40; i++) {
        const a = r() * Math.PI * 2
        const len = 60 + r() * 190
        ctx.globalAlpha = 0.12 + r() * 0.2
        ctx.lineWidth = 1 + r() * 3
        ctx.beginPath()
        ctx.moveTo(430, 400)
        ctx.lineTo(430 + Math.cos(a) * len * 1.5, 400 + Math.sin(a) * len)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    },
  },
  {
    id: 'mars',
    name: 'Mars',
    tilt: 25.19,
    rough: 0.92,
    bump: 0.05,
    draw: (ctx) => {
      ramp(ctx, [
        [0, '#e8e2da'],
        [0.09, '#b8532f'],
        [0.5, '#c2603a'],
        [0.9, '#a8492c'],
        [1, '#ece7e0'],
      ])
      blobs(ctx, 22, 29, 'rgba(122,58,34,.55)', 1.2)
      blobs(ctx, 18, 71, 'rgba(214,142,96,.4)', 0.8)
      speckle(ctx, 2200, 13, 3, 26, '#e0a377', '#6d3018')
    },
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    tilt: 3.13,
    rough: 0.62,
    oblate: 0.935,
    draw: (ctx) => {
      ramp(ctx, [
        [0, '#c9a880'],
        [0.3, '#efdcc0'],
        [0.5, '#d8b48b'],
        [0.7, '#f2e2c8'],
        [1, '#c09b73'],
      ])
      bands(ctx, 30, ['#b98a5c', '#f4e6cd', '#a97445', '#e6cfaa', '#8f5f3c'], 55, 22, 0.8)
      /* great red spot */
      ctx.globalAlpha = 0.85
      ctx.fillStyle = '#b5563a'
      ctx.beginPath()
      ctx.ellipse(690, 330, 92, 44, 0, 0, 7)
      ctx.fill()
      ctx.globalAlpha = 0.5
      ctx.fillStyle = '#d98a63'
      ctx.beginPath()
      ctx.ellipse(690, 330, 58, 26, 0, 0, 7)
      ctx.fill()
      ctx.globalAlpha = 1
    },
  },
  {
    id: 'saturn',
    name: 'Saturn',
    tilt: 26.73,
    rough: 0.6,
    oblate: 0.902,
    rings: { inner: 1.28, outer: 2.28 },
    draw: (ctx) => {
      ramp(ctx, [
        [0, '#c4a672'],
        [0.35, '#f0e0b8'],
        [0.55, '#e2c894'],
        [1, '#bb9d6c'],
      ])
      bands(ctx, 26, ['#d8bd8a', '#f6ecd2', '#c0a06c', '#ead7ac'], 77, 16, 0.7)
    },
  },
  {
    id: 'uranus',
    name: 'Uranus',
    tilt: 97.77,
    rough: 0.5,
    oblate: 0.977,
    rings: { inner: 1.5, outer: 1.92, thin: true },
    draw: (ctx) => {
      ramp(ctx, [
        [0, '#a8dfe4'],
        [0.5, '#7ec2ce'],
        [1, '#a3dbe1'],
      ])
      bands(ctx, 14, ['#94d2da', '#b6e5e9', '#7ab8c4'], 91, 8, 0.45)
    },
  },
  {
    id: 'neptune',
    name: 'Neptune',
    tilt: 28.32,
    rough: 0.5,
    oblate: 0.983,
    draw: (ctx) => {
      ramp(ctx, [
        [0, '#5b7fd8'],
        [0.5, '#3554b4'],
        [1, '#5478cf'],
      ])
      bands(ctx, 16, ['#4767c6', '#7d9ce8', '#2f4aa4'], 103, 10, 0.5)
      ctx.globalAlpha = 0.7
      ctx.fillStyle = '#1f326f'
      ctx.beginPath()
      ctx.ellipse(380, 320, 74, 34, 0, 0, 7)
      ctx.fill()
      ctx.globalAlpha = 0.5
      ctx.fillStyle = '#c9d8f6'
      ctx.beginPath()
      ctx.ellipse(720, 190, 50, 16, 0, 0, 7)
      ctx.fill()
      ctx.globalAlpha = 1
    },
  },
]

function ringTexture(thin: boolean | undefined) {
  const [c, ctx] = canvas2d(512, 8)
  const r = rnd(thin ? 5 : 19)
  for (let x = 0; x < 512; x++) {
    const t = x / 512
    let a = thin ? 0.28 : 0.62 + Math.sin(t * 44) * 0.2 + (r() - 0.5) * 0.25
    /* Cassini division */
    if (!thin && t > 0.62 && t < 0.68) a *= 0.16
    if (!thin && t < 0.06) a *= 0.4
    const v = 200 + Math.floor(r() * 46)
    ctx.fillStyle = `rgba(${v},${v - 16},${v - 52},${Math.max(0, Math.min(1, a))})`
    ctx.fillRect(x, 0, 1, 8)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** flat annulus with radial UVs so the ring texture reads outward */
function ringMesh(inner: number, outer: number, thin: boolean | undefined, name: string) {
  const g = new THREE.RingGeometry(inner * PLANET_RADIUS, outer * PLANET_RADIUS, 192, 1)
  const pos = g.attributes.position as THREE.BufferAttribute
  const uv = g.attributes.uv as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const d = (v.length() / PLANET_RADIUS - inner) / (outer - inner)
    uv.setXY(i, d, i % 2 ? 0 : 1)
  }
  uv.needsUpdate = true
  const m = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({
      name: name + '_ring_material',
      map: ringTexture(thin),
      transparent: true,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0.05,
      depthWrite: false,
    }),
  )
  m.name = name
  m.rotation.x = -Math.PI / 2
  return m
}

/** One solar body — sun or planet — built fresh, in the same units as `PLANET_RADIUS`. */
export function buildBody(id: BodyId): THREE.Group {
  const b = BODIES.find((x) => x.id === id)
  if (!b) throw new Error(`unknown body id: ${id}`)

  const g = new THREE.Group()
  g.name = b.id

  const mapTex = tex(b.draw)
  const mat = new THREE.MeshStandardMaterial({
    name: b.id + '_surface',
    map: mapTex,
    roughness: b.rough ?? 0.8,
    metalness: 0.02,
  })
  if (b.bump) {
    mat.bumpMap = bumpFrom(b.draw)
    mat.bumpScale = b.bump
  }
  if (b.emissive) {
    mat.emissive = new THREE.Color(b.emissive)
    mat.emissiveIntensity = b.emissiveIntensity ?? 1
    mat.emissiveMap = mapTex
  }

  const globe = new THREE.Mesh(new THREE.SphereGeometry(PLANET_RADIUS, 96, 64), mat)
  globe.name = b.id + '_globe'
  if (b.oblate) globe.scale.y = b.oblate
  if (b.emissive) mapTex.wrapS = THREE.RepeatWrapping
  g.add(globe)

  const R = PLANET_RADIUS

  if (b.corona) {
    const coMat = new THREE.MeshStandardMaterial({
      name: 'sun_corona',
      color: 0xff7a12,
      emissive: 0xff8a1e,
      emissiveIntensity: 1.1,
      transparent: true,
      opacity: 0.22,
      roughness: 1,
      side: THREE.BackSide,
      depthWrite: false,
    })
    const co = new THREE.Mesh(new THREE.SphereGeometry(R * 1.09, 64, 40), coMat)
    co.name = 'sun_corona_shell'
    g.add(co)
    const haloMat = new THREE.MeshStandardMaterial({
      name: 'sun_halo',
      color: 0xff9430,
      emissive: 0xffa63c,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.09,
      roughness: 1,
      side: THREE.BackSide,
      depthWrite: false,
    })
    const halo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.26, 48, 32), haloMat)
    halo.name = 'sun_halo_shell'
    g.add(halo)

    /* prominences arcing off the limb */
    const pr = rnd(13)
    const proms: THREE.Mesh[] = []
    for (let i = 0; i < 7; i++) {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(R * (0.16 + pr() * 0.16), R * 0.035, 8, 30, Math.PI * (0.7 + pr() * 0.6)),
        new THREE.MeshStandardMaterial({
          name: 'sun_prominence_material_' + i,
          color: 0xff5a08,
          emissive: 0xff6a10,
          emissiveIntensity: 1.4,
          transparent: true,
          opacity: 0.75,
          roughness: 1,
          depthWrite: false,
        }),
      )
      arc.name = 'sun_prominence_' + i
      const a = pr() * Math.PI * 2
      const t = pr() * Math.PI
      const dir = new THREE.Vector3(Math.sin(t) * Math.cos(a), Math.cos(t), Math.sin(t) * Math.sin(a))
      arc.position.copy(dir.clone().multiplyScalar(R * 1.02))
      arc.lookAt(0, 0, 0)
      arc.rotateY(Math.PI / 2)
      arc.userData.phase = pr() * Math.PI * 2
      arc.userData.rate = 0.5 + pr() * 0.9
      g.add(arc)
      proms.push(arc)
    }

    /* solar flares — jets that erupt off the limb, fade, and re-erupt elsewhere */
    const UP = new THREE.Vector3(0, 1, 0)
    const fr = rnd(97)
    const flares: THREE.Group[] = []
    for (let i = 0; i < 6; i++) {
      const jet = new THREE.Group()
      jet.name = 'sun_flare_' + i
      const geo = new THREE.ConeGeometry(R * 0.13, R * 0.72, 14, 3, true)
      geo.translate(0, R * 0.36, 0)
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          name: 'sun_flare_material_' + i,
          color: 0xffb43c,
          emissive: 0xff7a12,
          emissiveIntensity: 1.7,
          transparent: true,
          opacity: 0,
          roughness: 1,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      )
      mesh.name = 'sun_flare_jet_' + i
      jet.add(mesh)
      const foot = new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.12, 18, 12),
        new THREE.MeshStandardMaterial({
          name: 'sun_flare_foot_material_' + i,
          color: 0xfff0b4,
          emissive: 0xffd070,
          emissiveIntensity: 2.0,
          transparent: true,
          opacity: 0,
          roughness: 1,
          depthWrite: false,
        }),
      )
      foot.name = 'sun_flare_foot_' + i
      foot.scale.y = 0.45
      jet.add(foot)
      jet.userData = { mesh, foot, t: fr(), rate: 0.16 + fr() * 0.2, seeded: false }
      g.add(jet)
      flares.push(jet)
    }
    const reseat = (jet: THREE.Group) => {
      const a = fr() * Math.PI * 2
      const u = fr() * 2 - 1
      const s = Math.sqrt(1 - u * u)
      const dir = new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a))
      jet.position.copy(dir.clone().multiplyScalar(R * 0.98))
      jet.quaternion.setFromUnitVectors(UP, dir)
      jet.userData.lean = 0.5 + fr() * 0.8
      jet.userData.width = 0.7 + fr() * 0.8
    }
    flares.forEach(reseat)

    /* one authored clock drives granulation drift, corona breath, and the flare cycle */
    globe.onBeforeRender = () => {
      const now = performance.now() / 1000
      mapTex.offset.x = (now * 0.008) % 1
      mat.emissiveIntensity = 0.78 + Math.sin(now * 1.7) * 0.09 + Math.sin(now * 4.3) * 0.04
      const breath = 1 + Math.sin(now * 0.9) * 0.014
      co.scale.setScalar(breath)
      coMat.opacity = 0.2 + Math.sin(now * 1.3) * 0.05
      halo.scale.setScalar(1 + Math.sin(now * 0.6 + 1.1) * 0.022)
      haloMat.opacity = 0.08 + Math.sin(now * 0.8 + 0.4) * 0.025
      for (const p of proms) {
        const k = 0.82 + Math.sin(now * p.userData.rate + p.userData.phase) * 0.22
        p.scale.set(k, k, 1)
        const pMat = p.material as THREE.MeshStandardMaterial
        pMat.opacity = 0.55 + Math.sin(now * p.userData.rate * 1.3 + p.userData.phase) * 0.28
      }
      for (const jet of flares) {
        const d = jet.userData
        d.t += d.rate / 60
        if (d.t >= 1) {
          d.t -= 1
          reseat(jet)
        }
        /* fast rise, slow decay */
        const p = d.t
        const rise = Math.min(1, p / 0.22)
        const decay = p < 0.22 ? 1 : Math.max(0, 1 - (p - 0.22) / 0.78)
        const grow = rise * (0.35 + decay * (d.lean || 1))
        jet.scale.set(d.width * (0.5 + decay * 0.6), grow, d.width * (0.5 + decay * 0.6))
        const meshMat = (d.mesh as THREE.Mesh).material as THREE.MeshStandardMaterial
        const footMat = (d.foot as THREE.Mesh).material as THREE.MeshStandardMaterial
        meshMat.opacity = 0.85 * rise * decay * decay
        footMat.opacity = 0.95 * rise * decay
        ;(d.foot as THREE.Mesh).scale.set(1 + rise * 0.5, 0.45, 1 + rise * 0.5)
      }
    }
  }

  if (b.rings) g.add(ringMesh(b.rings.inner, b.rings.outer, b.rings.thin, b.id + '_rings'))

  g.rotation.z = ((b.tilt || 0) * Math.PI) / 180
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return g
}
