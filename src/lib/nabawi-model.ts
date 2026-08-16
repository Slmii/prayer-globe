// Masjid an-Nabawi from the design's `nabawi-model.js`, ported off the
// <three-d-stage> viewer shell so it can be dropped into any scene.
//
// Geometry, proportions and material names are unchanged from the design; the
// only edits are removing the stage/exporter plumbing and returning the group
// instead of handing it to a viewer. Built in metres, y-up, origin at ground
// level so it can sit directly on the globe's surface.

import * as THREE from 'three'

/**
 * Footprint of the cornice in metres — W+1.6 = 108+1.6 = 109.6 m across. This
 * is the full ground extent, used to size the model on screen.
 */
export const NABAWI_FOOTPRINT = 110
/** Height to the top of the minaret crescent, in metres (Y+92.6 ≈ 95.6). */
export const NABAWI_HEIGHT = 95

function materials() {
  return {
    stone: new THREE.MeshStandardMaterial({
      name: 'stone_sand',
      color: 0xe3d6b8,
      roughness: 0.84,
      metalness: 0.02,
    }),
    stoneWarm: new THREE.MeshStandardMaterial({
      name: 'stone_warm',
      color: 0xcbb994,
      roughness: 0.88,
      metalness: 0.02,
    }),
    stoneShade: new THREE.MeshStandardMaterial({
      name: 'stone_shadow',
      color: 0xa8926e,
      roughness: 0.9,
      metalness: 0.02,
    }),
    green: new THREE.MeshStandardMaterial({
      name: 'dome_green',
      color: 0x1f6b4a,
      roughness: 0.4,
      metalness: 0.25,
    }),
    greenDeep: new THREE.MeshStandardMaterial({
      name: 'green_deep',
      color: 0x16523a,
      roughness: 0.45,
      metalness: 0.25,
    }),
    white: new THREE.MeshStandardMaterial({
      name: 'dome_white',
      color: 0xf2ece0,
      roughness: 0.55,
      metalness: 0.03,
    }),
    gold: new THREE.MeshStandardMaterial({
      name: 'gilt',
      color: 0xc79a3c,
      roughness: 0.3,
      metalness: 0.75,
    }),
    marble: new THREE.MeshStandardMaterial({
      name: 'marble_plaza',
      color: 0xe9e5da,
      roughness: 0.62,
      metalness: 0.02,
    }),
    glass: new THREE.MeshStandardMaterial({
      name: 'window_glass',
      color: 0x24405e,
      roughness: 0.25,
      metalness: 0.3,
    }),
  }
}

type Materials = ReturnType<typeof materials>

/* ---------- arcade wall builder ---------- */
function archHole(w: number, h: number, spring: number) {
  const p = new THREE.Path()
  const hw = w / 2
  p.moveTo(-hw, 0)
  p.lineTo(-hw, spring)
  p.quadraticCurveTo(-hw, h * 0.93, 0, h)
  p.quadraticCurveTo(hw, h * 0.93, hw, spring)
  p.lineTo(hw, 0)
  p.lineTo(-hw, 0)
  return p
}

function arcadeWall(opts: {
  width: number
  height: number
  depth: number
  count: number
  archW: number
  archH: number
  spring: number
  material: THREE.Material
  name: string
}): THREE.Mesh {
  const { width, height, depth, count, archW, archH, spring, material, name } = opts
  const outer = new THREE.Shape()
  outer.moveTo(-width / 2, 0)
  outer.lineTo(width / 2, 0)
  outer.lineTo(width / 2, height)
  outer.lineTo(-width / 2, height)
  outer.lineTo(-width / 2, 0)
  const step = width / count
  for (let i = 0; i < count; i++) {
    const cx = -width / 2 + step * (i + 0.5)
    const src = archHole(archW, archH, spring)
    const pts = src.getPoints(22).map((p) => new THREE.Vector2(p.x + cx, p.y))
    outer.holes.push(new THREE.Path(pts))
  }
  const g = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: false, curveSegments: 22 })
  g.translate(0, 0, -depth / 2)
  const m = new THREE.Mesh(g, material)
  m.name = name
  return m
}

/* crenellated parapet */
function parapet(
  M: Materials,
  len: number,
  name: string,
  pos: [number, number, number],
  rotY?: number,
) {
  const g = new THREE.Group()
  g.name = name
  const n = Math.floor(len / 3.2)
  for (let i = 0; i < n; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.0, 0.75), M.stone)
    t.name = `${name}_merlon_${i}`
    t.position.x = -len / 2 + (i + 0.5) * (len / n)
    t.position.y = 1.0
    g.add(t)
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.7, 0.9), M.stone)
  rail.name = name + '_rail'
  g.add(rail)
  g.position.set(pos[0], pos[1], pos[2])
  if (rotY) g.rotation.y = rotY
  return g
}

/* ---------- roof: field of shallow white domes over the halls ---------- */
function smallDome(M: Materials, r: number, tag: string) {
  const g = new THREE.Group()
  g.name = 'roof_dome_' + tag
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 0.98, 0.9, 24), M.white)
  drum.name = 'roof_drum_' + tag
  drum.position.y = 0.45
  g.add(drum)
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(r, 26, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    M.white,
  )
  shell.name = 'roof_shell_' + tag
  shell.position.y = 0.9
  shell.scale.y = 0.62
  g.add(shell)
  const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.13, 12, 8), M.gold)
  tip.name = 'roof_tip_' + tag
  tip.position.y = 0.9 + r * 0.62 + r * 0.08
  g.add(tip)
  return g
}

/* ---------- minarets ---------- */
function minaret(M: Materials, tag: string) {
  const g = new THREE.Group()
  g.name = 'minaret_' + tag
  const put = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    name: string,
    pos: [number, number, number],
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat)
    m.name = name
    m.position.set(pos[0], pos[1], pos[2])
    g.add(m)
    return m
  }
  put(new THREE.BoxGeometry(7.4, 20, 7.4), M.stone, 'minaret_base_' + tag, [0, 10, 0])
  put(new THREE.BoxGeometry(8.0, 1.0, 8.0), M.stoneShade, 'minaret_base_cornice_' + tag, [
    0, 20.3, 0,
  ])
  put(new THREE.CylinderGeometry(3.0, 3.9, 5.0, 8), M.stone, 'minaret_transition_' + tag, [
    0, 23.3, 0,
  ])
  put(new THREE.CylinderGeometry(2.5, 3.0, 26, 8), M.stone, 'minaret_shaft_lower_' + tag, [
    0, 38.8, 0,
  ])
  /* first balcony */
  put(new THREE.CylinderGeometry(4.0, 3.2, 1.2, 16), M.stoneShade, 'balcony1_floor_' + tag, [
    0, 52.4, 0,
  ])
  put(
    new THREE.CylinderGeometry(3.9, 3.9, 2.6, 16, 1, true),
    M.green,
    'balcony1_rail_' + tag,
    [0, 54.3, 0],
  )
  put(new THREE.CylinderGeometry(2.0, 2.4, 14, 8), M.stone, 'minaret_shaft_upper_' + tag, [
    0, 62.6, 0,
  ])
  /* second balcony */
  put(new THREE.CylinderGeometry(3.2, 2.6, 1.0, 16), M.stoneShade, 'balcony2_floor_' + tag, [
    0, 70.1, 0,
  ])
  put(
    new THREE.CylinderGeometry(3.1, 3.1, 2.2, 16, 1, true),
    M.green,
    'balcony2_rail_' + tag,
    [0, 71.7, 0],
  )
  put(new THREE.CylinderGeometry(1.7, 1.9, 8, 8), M.stone, 'minaret_lantern_shaft_' + tag, [
    0, 76.8, 0,
  ])
  /* green bulb cap */
  const cap = put(new THREE.SphereGeometry(2.5, 24, 16), M.green, 'minaret_cap_' + tag, [
    0, 82.6, 0,
  ])
  cap.scale.set(1, 1.35, 1)
  put(new THREE.ConeGeometry(2.4, 3.2, 20), M.green, 'minaret_cap_cone_' + tag, [0, 86.6, 0])
  put(new THREE.CylinderGeometry(0.22, 0.3, 2.6, 12), M.gold, 'minaret_finial_' + tag, [
    0, 89.4, 0,
  ])
  put(new THREE.SphereGeometry(0.7, 16, 12), M.gold, 'minaret_finial_bulb_' + tag, [0, 91.0, 0])
  const c = put(
    new THREE.TorusGeometry(1.0, 0.13, 10, 34, Math.PI * 1.45),
    M.gold,
    'minaret_crescent_' + tag,
    [0, 92.6, 0],
  )
  c.rotation.z = -Math.PI * 0.28
  return g
}

/* ---------- courtyard shade canopies (open umbrellas) ---------- */
function umbrella(M: Materials, tag: string) {
  const g = new THREE.Group()
  g.name = 'canopy_' + tag
  const put = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    name: string,
    pos: [number, number, number],
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat)
    m.name = name
    m.position.set(pos[0], pos[1], pos[2])
    g.add(m)
    return m
  }
  put(new THREE.CylinderGeometry(0.6, 0.8, 13, 14), M.stoneShade, 'canopy_mast_' + tag, [
    0, 6.5, 0,
  ])
  put(new THREE.BoxGeometry(15.5, 0.55, 15.5), M.white, 'canopy_shade_' + tag, [0, 13.4, 0])
  for (let i = 0; i < 4; i++) {
    const r = put(new THREE.BoxGeometry(15.5, 0.3, 0.55), M.white, `canopy_rib_${tag}_${i}`, [
      0, 13.0, 0,
    ])
    r.rotation.y = (i / 4) * Math.PI
  }
  put(new THREE.SphereGeometry(0.75, 16, 12), M.gold, 'canopy_boss_' + tag, [0, 13.9, 0])
  return g
}

/** The complete Masjid an-Nabawi, in metres, resting on y = 0. */
export function buildNabawi(): THREE.Group {
  const M: Materials = materials()
  const model = new THREE.Group()
  model.name = 'masjid_an_nabawi'
  const put = (
    g: THREE.BufferGeometry,
    mat: THREE.Material,
    name: string,
    pos?: [number, number, number],
    parent: THREE.Object3D = model,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(g, mat)
    m.name = name
    if (pos) m.position.set(pos[0], pos[1], pos[2])
    parent.add(m)
    return m
  }

  /* footprint */
  const W = 108,
    D = 84,
    WALL = 17,
    BASE = 1.6

  /* plinth — the mosque stands on its own low base, with no plaza */
  put(new THREE.BoxGeometry(W, BASE, D), M.stoneShade, 'plinth', [0, BASE / 2, 0])

  const Y = BASE

  /* ---------- outer walls with arcades ---------- */
  const northWall = arcadeWall({
    width: W,
    height: WALL,
    depth: 3.2,
    count: 13,
    archW: 4.2,
    archH: 10.5,
    spring: 5.6,
    material: M.stone,
    name: 'wall_north',
  })
  northWall.position.set(0, Y, -D / 2 + 1.6)
  model.add(northWall)

  const southWall = arcadeWall({
    width: W,
    height: WALL,
    depth: 3.2,
    count: 13,
    archW: 4.2,
    archH: 10.5,
    spring: 5.6,
    material: M.stone,
    name: 'wall_south',
  })
  southWall.position.set(0, Y, D / 2 - 1.6)
  model.add(southWall)

  for (const sgn of [1, -1]) {
    const w = arcadeWall({
      width: D - 4,
      height: WALL,
      depth: 3.2,
      count: 10,
      archW: 4.2,
      archH: 10.5,
      spring: 5.6,
      material: M.stone,
      name: sgn > 0 ? 'wall_east' : 'wall_west',
    })
    w.rotation.y = Math.PI / 2
    w.position.set(sgn * (W / 2 - 1.6), Y, 0)
    model.add(w)
  }

  /* solid inner mass of the prayer halls, leaving the sahn (courtyard) open */
  const HALL = 24
  put(
    new THREE.BoxGeometry(W - 10, WALL - 1.5, HALL),
    M.stoneWarm,
    'prayer_hall_south',
    [0, Y + (WALL - 1.5) / 2, D / 2 - HALL / 2 - 4],
  )
  put(
    new THREE.BoxGeometry(W - 10, WALL - 1.5, HALL),
    M.stoneWarm,
    'prayer_hall_north',
    [0, Y + (WALL - 1.5) / 2, -D / 2 + HALL / 2 + 4],
  )
  for (const sgn of [1, -1]) {
    put(
      new THREE.BoxGeometry(16, WALL - 1.5, D - 2 * HALL - 8),
      M.stoneWarm,
      sgn > 0 ? 'prayer_hall_east' : 'prayer_hall_west',
      [sgn * (W / 2 - 13), Y + (WALL - 1.5) / 2, 0],
    )
  }

  /* cornice + roof deck */
  put(new THREE.BoxGeometry(W + 1.6, 1.1, D + 1.6), M.stoneShade, 'cornice', [
    0, Y + WALL - 0.55, 0,
  ])
  put(new THREE.BoxGeometry(W - 2, 0.5, D - 2), M.stoneWarm, 'roof_deck', [0, Y + WALL + 0.25, 0])

  const pY = Y + WALL + 0.8
  model.add(parapet(M, W, 'parapet_north', [0, pY, -D / 2 - 0.2]))
  model.add(parapet(M, W, 'parapet_south', [0, pY, D / 2 + 0.2]))
  model.add(parapet(M, D, 'parapet_east', [W / 2 + 0.2, pY, 0], Math.PI / 2))
  model.add(parapet(M, D, 'parapet_west', [-W / 2 - 0.2, pY, 0], Math.PI / 2))

  const domeY = Y + WALL + 0.5
  let dc = 0
  for (const zc of [D / 2 - HALL / 2 - 4, -D / 2 + HALL / 2 + 4]) {
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 2; j++) {
        const d = smallDome(M, 5.4, 'h' + dc++)
        d.position.set(-42 + i * 14, domeY, zc + (j ? 7 : -7))
        model.add(d)
      }
    }
  }
  for (const sgn of [1, -1]) {
    for (let i = 0; i < 2; i++) {
      const d = smallDome(M, 5.4, 'v' + dc++)
      d.position.set(sgn * (W / 2 - 13), domeY, -7 + i * 14)
      model.add(d)
    }
  }

  /* courtyard floor (sahn) */
  put(new THREE.BoxGeometry(W - 46, 0.4, D - 2 * HALL - 10), M.marble, 'sahn_floor', [
    0, Y + 0.2, 0,
  ])

  /* ---------- the Green Dome over the Prophet's chamber ---------- */
  const gd = new THREE.Group()
  gd.name = 'green_dome'
  const gdR = 9.2
  put(new THREE.BoxGeometry(gdR * 2.5, 6.5, gdR * 2.5), M.stone, 'green_dome_square_base', [
    0, 3.25, 0,
  ], gd)
  put(
    new THREE.BoxGeometry(gdR * 2.7, 0.7, gdR * 2.7),
    M.stoneShade,
    'green_dome_base_cornice',
    [0, 6.6, 0],
    gd,
  )
  put(new THREE.CylinderGeometry(gdR, gdR * 1.04, 7.4, 32), M.stone, 'green_dome_drum', [
    0, 10.6, 0,
  ], gd)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const w = put(
      new THREE.BoxGeometry(1.1, 3.4, 0.4),
      M.glass,
      'drum_window_' + i,
      [Math.sin(a) * (gdR + 0.05), 11.6, Math.cos(a) * (gdR + 0.05)],
      gd,
    )
    w.rotation.y = a
  }
  put(
    new THREE.TorusGeometry(gdR + 0.25, 0.4, 12, 40),
    M.greenDeep,
    'green_dome_ring',
    [0, 14.4, 0],
    gd,
  ).rotation.x = Math.PI / 2

  /* bulbous ogee profile via lathe */
  const prof: THREE.Vector2[] = []
  for (let i = 0; i <= 44; i++) {
    const t = i / 44
    const a = (t * Math.PI) / 2
    const r = gdR * (Math.cos(a) + 0.11 * Math.sin(a * 2) * (1 - t))
    prof.push(new THREE.Vector2(Math.max(0.02, r), gdR * 1.24 * Math.sin(a)))
  }
  put(new THREE.LatheGeometry(prof, 52), M.green, 'green_dome_shell', [0, 14.3, 0], gd)
  /* ribs */
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    const rib = put(
      new THREE.TorusGeometry(gdR * 0.99, 0.11, 8, 34, Math.PI / 2),
      M.greenDeep,
      'green_dome_rib_' + i,
      [0, 14.3, 0],
      gd,
    )
    rib.rotation.set(Math.PI / 2, 0, 0)
    rib.rotation.z = a
    rib.scale.y = 1.24
  }
  put(
    new THREE.CylinderGeometry(0.3, 0.42, 3.0, 16),
    M.gold,
    'green_dome_finial_stem',
    [0, 15.9 + gdR * 1.24, 0],
    gd,
  )
  put(
    new THREE.SphereGeometry(0.85, 20, 14),
    M.gold,
    'green_dome_finial_bulb',
    [0, 17.7 + gdR * 1.24, 0],
    gd,
  )
  const cres = put(
    new THREE.TorusGeometry(1.25, 0.16, 12, 40, Math.PI * 1.45),
    M.gold,
    'green_dome_crescent',
    [0, 19.7 + gdR * 1.24, 0],
    gd,
  )
  cres.rotation.z = -Math.PI * 0.28

  gd.position.set(-W / 2 + 26, Y + WALL + 0.5, D / 2 - 17)
  model.add(gd)

  /* the Rawdah chamber walls beneath, with a gilded screen */
  const chamber = new THREE.Group()
  chamber.name = 'rawdah_chamber'
  put(new THREE.BoxGeometry(24, WALL - 1.5, 24), M.stoneWarm, 'chamber_mass', [
    0, (WALL - 1.5) / 2, 0,
  ], chamber)
  for (let i = 0; i < 6; i++) {
    put(
      new THREE.BoxGeometry(0.5, 8.5, 0.5),
      M.gold,
      'chamber_screen_bar_' + i,
      [-6 + i * 2.4, 5.5, 12.15],
      chamber,
    )
  }
  put(new THREE.BoxGeometry(14, 0.6, 0.7), M.gold, 'chamber_screen_head', [0, 10, 12.15], chamber)
  chamber.position.set(-W / 2 + 26, Y, D / 2 - 17)
  model.add(chamber)

  /* ---------- minarets ---------- */
  const mp: [string, number, number][] = [
    ['sw', -W / 2 + 3.7, D / 2 - 3.7],
    ['se', W / 2 - 3.7, D / 2 - 3.7],
    ['nw', -W / 2 + 3.7, -D / 2 + 3.7],
    ['ne', W / 2 - 3.7, -D / 2 + 3.7],
  ]
  for (const [tag, x, z] of mp) {
    const m = minaret(M, tag)
    m.position.set(x, Y, z)
    model.add(m)
  }

  /* ---------- courtyard shade canopies (open umbrellas) ---------- */
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const u = umbrella(M, `${i}${j}`)
      u.position.set(-9 + i * 18, Y + 0.4, -9 + j * 18)
      model.add(u)
    }
  }

  /* entrance portal on the south face */
  const portal = new THREE.Group()
  portal.name = 'main_portal'
  const pw = arcadeWall({
    width: 20,
    height: 21,
    depth: 3.6,
    count: 1,
    archW: 10,
    archH: 16,
    spring: 8.5,
    material: M.stoneWarm,
    name: 'portal_frame',
  })
  portal.add(pw)
  put(new THREE.BoxGeometry(21.5, 1.2, 4.4), M.stoneShade, 'portal_cornice', [0, 21.4, 0], portal)
  for (let i = 0; i < 5; i++) {
    put(
      new THREE.BoxGeometry(3.3, 2.4, 1.4),
      M.stone,
      'portal_merlon_' + i,
      [-7 + i * 3.5, 23.2, 0],
      portal,
    )
  }
  portal.position.set(0, Y, D / 2 + 1.2)
  model.add(portal)

  model.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
  })

  return model
}
