import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MLMap, Marker, LngLat } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CITIES } from '../lib/cities'
// three.js and everything drawn with it — the mosque models, the starfield, the
// sun and moon bodies — is loaded on demand. It is 141 KB gzipped, a quarter of
// the bundle, and none of it is needed to draw the globe.
//
// The orbs and the cosmos are null-checked in the frame loop, so they simply
// start drawing when they arrive. The mosque layer is not in that loop and
// needs more care: a city with a mosque has its dot hidden, so it stays visible
// until the layer is actually added (see `mosquesReadyRef`).
import type { createCosmos } from './cosmos'
import type { Orb } from './orb'
import type { PlanetLabel } from './cosmos'
import { blendOf } from '../lib/phases'
import type { PhaseTable } from '../lib/phases'
import { MOSQUES } from '../lib/mosques'
import {
  D,
  PHASES,
  skyState,
  bearing,
  terminatorArcs,
  nightPolygon,
  bodyPaths,
  phaseBlend,
} from '../lib/astro'

/** Cities whose dot is replaced by a 3D mosque. */
const MOSQUE_CITIES = new Set(MOSQUES.map((m) => m.city))

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

const HEX = (c: string) => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
]
const PHASE_RGB = PHASES.map((p) => HEX(p.c))

/** Blend two phase colours, so a dot eases into its next prayer. */
function mixPhase(a: number, b: number, t: number): string {
  if (t <= 0 || a === b) return PHASES[a].c
  const x = PHASE_RGB[a]
  const y = PHASE_RGB[b]
  const m = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t)
  return `rgb(${m(0)},${m(1)},${m(2)})`
}

/**
 * Latitude/longitude grid, every 15°.
 *
 * Sampled every 5° along each line so the curves bend with the sphere instead
 * of cutting straight chords through it. Static, so it is built once.
 */
const GRATICULE: FeatureCollection = {
  type: 'FeatureCollection',
  features: (() => {
    const lines: [number, number][][] = []
    for (let lat = -75; lat <= 75; lat += 15) {
      const line: [number, number][] = []
      for (let lon = -180; lon <= 180; lon += 5) line.push([lon, lat])
      lines.push(line)
    }
    for (let lon = -180; lon < 180; lon += 15) {
      const line: [number, number][] = []
      for (let lat = -85; lat <= 85; lat += 5) line.push([lon, lat])
      lines.push(line)
    }
    return [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'MultiLineString' as const, coordinates: lines },
      },
    ]
  })(),
}

/** How far outside the globe's rim the sun and moon ride, in pixels. */
const ORBIT_GAP = 46

export interface GlobeHandle {
  flyTo(lng: number, lat: number, zoom: number, duration?: number): void
}

interface GlobeProps {
  worldGeo?: FeatureCollection
  /** Continuous scrubbed instant. Sampled per frame, not passed as a value. */
  getNowMs: () => number
  activeCityName: string
  spin: boolean
  /** Draw the tracks the sun and moon have taken over the scrubbed span. */
  showPaths: boolean
  /** Draw the planets on their orbits around the globe. */
  showOrrery: boolean
  /** Pulse every city currently in this prayer phase, or null for none. */
  highlightPhase: number | null
  /** Every city's Diyanet boundaries, for dot colour. Null until loaded. */
  phases: PhaseTable | null
  onHover(p: { lat: number; lng: number } | null): void
  onView(v: { lng: number; lat: number; zoom: number }): void
  /** A city dot was clicked, by name. */
  onCitySelect(name: string): void
  /** A city dot is under the pointer, by name (null when none). */
  onCityHover(name: string | null): void
  onNote(note: string): void
}

type GlyphKind = 'sun' | 'moon'

/**
 * Glyph box size in CSS pixels.
 *
 * The sun gets the larger frame because the design's model brings a corona out
 * to 1.26 radii and flares past that; crop it to the moon's size and it loses
 * the atmosphere that makes it a sun rather than a yellow ball.
 */
const ORB_PX: Record<GlyphKind, number> = { sun: 48, moon: 34 }

/** DOM node for one celestial marker. */
function glyph(kind: GlyphKind): HTMLDivElement {
  const n = document.createElement('div')
  // Must be absolute: as a flow-level block it would stretch to the overlay's
  // full width, and the translate(-50%) centring would then shift it by half
  // the viewport instead of half the glyph.
  n.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;will-change:transform'
  const b = document.createElement('div')
  const px = ORB_PX[kind]
  b.style.cssText = `position:relative;width:${px}px;height:${px}px`

  // The body itself is the design's 3D model on its own canvas; `createOrb`
  // takes it from here. Both keep a halo behind them, for different reasons: it
  // is what makes the sun read as a light source rather than a yellow ball, and
  // it is what keeps the moon findable on the nights when its lit crescent is
  // only a couple of pixels wide.
  const halo = document.createElement('div')
  halo.style.cssText =
    kind === 'sun'
      ? 'position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(255,214,120,.22) 0%,rgba(255,196,88,0) 66%);animation:pg-breathe 4.2s ease-in-out infinite'
      : 'position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(226,231,247,.3) 0%,rgba(198,205,232,0) 68%);animation:pg-breathe 6.5s ease-in-out infinite'
  b.append(halo)
  const cv = document.createElement('canvas')
  cv.className = 'pg-orb'
  cv.style.cssText = `position:absolute;inset:0;width:${px}px;height:${px}px;display:block`
  b.append(cv)

  const name = kind === 'sun' ? 'SUN' : 'MOON'
  const l = document.createElement('div')
  l.textContent = name
  l.style.cssText = `position:absolute;left:${px + 2}px;top:50%;transform:translateY(-50%);font:500 8.5px ui-monospace,Menlo,monospace;letter-spacing:.11em;color:rgba(233,233,237,.72);white-space:nowrap;text-shadow:0 1px 6px rgba(6,7,11,.95)`
  n.dataset.kind = name
  n.append(b, l)
  return n
}

/**
 * The exact point the body stands over, marked on the globe itself. The big
 * glyph rides outside the rim, so this is what actually carries the position.
 */
function pulse(kind: GlyphKind): HTMLDivElement {
  const n = document.createElement('div')
  n.className = `pg-pulse pg-pulse-${kind}`
  const ring = document.createElement('span')
  ring.className = 'pg-pulse-ring'
  const core = document.createElement('span')
  core.className = 'pg-pulse-core'
  n.append(ring, core)
  return n
}

/** The canvas inside a glyph that `createOrb` draws the 3D body onto. */
function orbCanvas(el: HTMLElement): HTMLCanvasElement | null {
  return el.querySelector<HTMLCanvasElement>('canvas.pg-orb')
}

const Globe = forwardRef<GlobeHandle, GlobeProps>(function Globe(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const readyRef = useRef(false)
  /**
   * Whether the 3D mosque layer is actually drawing yet.
   *
   * A city flagged `m` has its dot painted at zero opacity, because a mosque
   * model stands there instead. That flag used to be set from the city list
   * alone, but the layer is now loaded asynchronously — so between first paint
   * and the chunk arriving, Makkah, Madinah, Istanbul, Cairo, Delhi and Jakarta
   * had no marker at all, and if the chunk ever failed to load they never got
   * one. The dot stays until its model can replace it.
   */
  const mosquesReadyRef = useRef(false)
  const bodiesRef = useRef<Record<GlyphKind, HTMLDivElement> | null>(null)
  const orbsRef = useRef<Record<GlyphKind, Orb> | null>(null)
  const pulsesRef = useRef<Record<GlyphKind, Marker> | null>(null)
  const hoveredRef = useRef<string | null>(null)
  const highlightRef = useRef<number | null>(null)
  /**
   * The scrubbed instant `pushSky` last drew, and whether `pushPaths` last left
   * the source empty.
   *
   * Both used to run every frame. That is two `setData` calls on `edges` and
   * `night` plus one on `paths` — each serialising several hundred coordinates,
   * posting them to the worker, and re-tiling — sixty times a second, forever,
   * including with the clock frozen and nobody touching anything. `setData`
   * also forces a repaint internally, so this was what kept the map from ever
   * idling; removing the mosque layer's `triggerRepaint` alone did not.
   *
   * NaN forces the next push, which is how a style reload gets its data back.
   */
  const skyDrawnAtRef = useRef(Number.NaN)
  const pathsEmptyRef = useRef(false)
  /**
   * Camera signature and clock reading the celestial layer was last drawn for.
   *
   * The starfield, the orrery, the sun and moon glyphs and their pulses all
   * depend on exactly two things: where the camera is, and what time it is.
   * Neither changes between most frames, yet the block was redrawing a full
   * three.js scene and running an 18-step project/unproject search sixty times
   * a second regardless.
   */
  const lastCamRef = useRef('')
  const lastCelestialAtRef = useRef(Number.NaN)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const planetLabelsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const skyRef = useRef<HTMLCanvasElement>(null)
  const cosmosRef = useRef<ReturnType<typeof createCosmos> | null>(null)

  // The rAF loop and map callbacks need the latest props without re-subscribing.
  const propsRef = useRef(props)
  propsRef.current = props

  useImperativeHandle(
    ref,
    () => ({
      flyTo(lng, lat, zoom, duration = 2600) {
        mapRef.current?.flyTo({ center: [lng, lat], zoom, duration, curve: 1.5, essential: true })
      },
    }),
    [],
  )

  /**
   * Position the planet name tags the orrery layer hands us each frame.
   *
   * The planets live at 1.3–2.5 earth radii, so there is no lat/lon for
   * map.project to work with — the layer projects them with the same matrix it
   * renders through and passes the screen coordinates out.
   */
  function placePlanetLabels(labels: PlanetLabel[]) {
    const overlay = overlayRef.current
    if (!overlay) return
    const tags = planetLabelsRef.current
    // No labels means the sky is not being drawn at all — hide any left over,
    // or they hang in the view after the orrery has faded out.
    if (labels.length === 0) {
      for (const el of tags.values()) el.style.opacity = '0'
      return
    }
    for (const l of labels) {
      let el = tags.get(l.name)
      if (!el) {
        el = document.createElement('div')
        el.className = 'pg-planet'
        el.textContent = l.name
        overlay.appendChild(el)
        tags.set(l.name, el)
      }
      el.style.color = l.color
      el.style.opacity = l.visible ? '1' : '0'
      el.style.transform = `translate(10px, -50%) translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px)`
    }
  }

  /** Radius in px of the globe's silhouette, or null when it overflows the view. */
  function globeRadius(w: number, h: number): number | null {
    const map = mapRef.current
    if (!map) return null
    const cx = w / 2
    const cy = h / 2
    const onGlobe = (r: number) => {
      const px = { x: cx, y: cy - r }
      if (px.y < 0) return false
      let ll
      try {
        ll = map.unproject([px.x, px.y])
      } catch {
        return false
      }
      if (!ll || !isFinite(ll.lat) || !isFinite(ll.lng)) return false
      const back = map.project(ll)
      return Math.hypot(back.x - px.x, back.y - px.y) < 2.5
    }
    const limit = cy
    if (onGlobe(limit)) return null // zoomed in far enough that there is no rim
    let lo = 1
    let hi = limit
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2
      if (onGlobe(mid)) lo = mid
      else hi = mid
    }
    return lo
  }

  /**
   * Place a celestial body in screen space, always clear of the globe.
   *
   * Drawing the glyph at its true projected position buried it in city labels,
   * so the body now rides outside the silhouette in the direction of the point
   * it stands over, and the exact spot is marked by a pulse on the globe itself.
   * That split is also why these are positioned elements rather than MapLibre
   * markers: a point behind the earth has no lng/lat that projects outside.
   *
   * The direction degenerates when the body is almost dead centre — there is no
   * sensible 2D bearing for something directly in front of you — so the glyph
   * fades out over that last stretch and the pulse carries the meaning alone.
   */
  function positionBody(el: HTMLElement, lat: number, lon: number, cen: LngLat, rim: number | null) {
    const map = mapRef.current
    if (!map) return

    // No rim means the globe fills the view: we are zoomed into a city, where a
    // body parked in the corner of the screen means nothing. Hide it.
    if (rim == null) {
      el.style.opacity = '0'
      return
    }
    el.style.opacity = '1'

    const box = map.getContainer()
    const w = box.clientWidth
    const h = box.clientHeight
    const cx = w / 2
    const cy = h / 2

    const cosA =
      Math.sin(lat * D) * Math.sin(cen.lat * D) +
      Math.cos(lat * D) * Math.cos(cen.lat * D) * Math.cos((lon - cen.lng) * D)
    const angDist = Math.acos(Math.max(-1, Math.min(1, cosA))) / D
    const facing = cosA > 0

    const b = (bearing(cen.lat, cen.lng, lat, lon) - (map.getBearing() || 0)) * D
    const maxR = Math.min(w, h) / 2 - 30
    const r = Math.min(rim + ORBIT_GAP, maxR)
    const x = cx + Math.sin(b) * r
    const y = cy - Math.cos(b) * r

    el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
    const body = el.firstChild as HTMLElement | null
    if (body) {
      const fade = Math.max(0, Math.min(1, (angDist - 16) / 14))
      body.style.opacity = ((facing ? 1 : 0.55) * fade).toFixed(2)
    }
  }

  /**
   * The geometry that actually moves: terminator limbs and the night cap.
   *
   * Runs every frame. While "Play day" is running the sub-solar point sweeps
   * 24° of longitude per second, so anything throttled to even 120 ms lands in
   * visible ~3° jumps. These are only a few hundred coordinates, so rebuilding
   * them per frame is affordable — unlike the city dots below.
   */
  /** Terminator, night side and sub-solar point, for the scrubbed instant. */
  function pushSky(force = false) {
    const map = mapRef.current
    if (!map || !readyRef.current) return

    const nowMs = propsRef.current.getNowMs()
    // The sub-solar point drifts 0.25°/minute, so 30 s of scrubbed time is
    // 0.125° — around half a pixel at the default zoom, and far less than the
    // 0.00007° a single frame would move it. Scrubbing and playing cross this
    // in one frame, so they still update continuously; only a resting clock
    // goes quiet.
    if (!force && Math.abs(nowMs - skyDrawnAtRef.current) < 30_000) return
    skyDrawnAtRef.current = nowMs

    const sky = skyState(new Date(nowMs))
    const { dec } = sky
    const subLat = sky.sun.lat
    const subLon = sky.sun.lon

    const arcs = terminatorArcs(subLat, subLon)
    const edges = map.getSource('edges') as maplibregl.GeoJSONSource | undefined
    edges?.setData({
      type: 'FeatureCollection',
      features: ([
        ['sunrise', arcs.sunrise],
        ['sunset', arcs.sunset],
      ] as [string, [number, number][][]][]).map(([k, coordinates]) => ({
        type: 'Feature',
        properties: { k },
        geometry: { type: 'MultiLineString', coordinates },
      })),
    })

    const night = map.getSource('night') as maplibregl.GeoJSONSource | undefined
    night?.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [nightPolygon(dec, subLon)] },
        },
      ],
    })
  }

  /** Sun and moon tracks from the present to wherever the clock has been moved. */
  function pushPaths() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource('paths') as maplibregl.GeoJSONSource | undefined
    if (!src) return

    const nowMs = propsRef.current.getNowMs()
    const realNow = Date.now()
    if (!propsRef.current.showPaths || Math.abs(nowMs - realNow) < 60000) {
      // Clearing an already-clear source is still a worker round trip.
      if (!pathsEmptyRef.current) {
        src.setData(EMPTY)
        pathsEmptyRef.current = true
      }
      return
    }
    pathsEmptyRef.current = false

    const paths = bodyPaths(realNow, nowMs)
    src.setData({
      type: 'FeatureCollection',
      features: ([
        ['moon', paths.moon],
        ['sun', paths.sun],
      ] as [string, [number, number][][]][]).map(([k, coordinates]) => ({
        type: 'Feature',
        properties: { k },
        geometry: { type: 'MultiLineString', coordinates },
      })),
    })
  }

  /**
   * City dots and the active-city ring. Their colours only change at prayer
   * boundaries, so this is throttled — 143 features per frame would not be.
   */
  function pushCities() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const { getNowMs, activeCityName } = propsRef.current
    const nowMs = getNowMs()
    const { dec, eot, utcH } = skyState(new Date(nowMs))

    const cen = map.getCenter()
    const zoom = map.getZoom()
    const visible = (la: number, lo: number) => {
      const a =
        Math.sin(la * D) * Math.sin(cen.lat * D) +
        Math.cos(la * D) * Math.cos(cen.lat * D) * Math.cos((lo - cen.lng) * D)
      return a > (zoom > 3 ? -0.2 : 0.12)
    }
    const cities = map.getSource('cities') as maplibregl.GeoJSONSource | undefined
    cities?.setData({
      type: 'FeatureCollection',
      features: CITIES.filter((c) => visible(c.la, c.lo)).map((c) => {
        // Diyanet's own boundaries where we have them; the solar model is the
        // fallback for a scrub past the published window.
        const table = propsRef.current.phases
        const st = (((utcH + c.lo / 15 + eot / 60) % 24) + 24) % 24
        const blend =
          (table && blendOf(table, c.ilceID, nowMs)) ?? phaseBlend(c.la, st, dec)
        return {
          type: 'Feature',
          // `m` marks a site drawn as a mosque; its dot is hidden but the
          // feature stays so clicking and the active ring still work. `p` is the
          // phase, so a whole prayer can be highlighted at once.
          properties: {
            n: c.n,
            c: mixPhase(blend.phase, blend.next, blend.t),
            p: blend.phase,
            m: mosquesReadyRef.current && MOSQUE_CITIES.has(c.n) ? 1 : 0,
          },
          geometry: { type: 'Point', coordinates: [c.lo, c.la] },
        }
      }),
    })
    if (map.getLayer('city-active')) {
      map.setFilter('city-active', ['==', ['get', 'n'], activeCityName])
    }
  }

  // --- map lifecycle -------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // three.js arrives asynchronously now, and this effect can be torn down
    // before it lands — StrictMode double-invokes it on mount, and cleanup then
    // runs while the import is still in flight, so there is nothing assigned yet
    // for it to dispose. Without this flag both the discarded and the live
    // effect would construct a renderer and the first one's WebGL context would
    // leak; browsers only allow a handful of those.
    let torn = false

    const map = new maplibregl.Map({
      container: host,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'space', type: 'background', paint: { 'background-color': '#0b0d13' } }],
        projection: { type: 'globe' },
      },
      center: [39, 20],
      zoom: 1.4,
      minZoom: 0.6,
      maxZoom: 8,
      attributionControl: { compact: true },
      dragRotate: true,
      pitchWithRotate: false,
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __pgmap?: MLMap }).__pgmap = map

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    // No GlobeControl: it toggles the projection to flat Mercator, and every
    // other layer here — the orrery camera, the night polygon's pole handling,
    // the buildings' depth remap — is built around the globe.

    // MapLibre's controls ship native `title`s, which the browser renders in its
    // own style after a delay of its choosing. Move them onto the same tooltip
    // the rest of the app uses, keeping the accessible name that `title` was
    // also providing. Right-aligned because these sit against the viewport edge.
    for (const el of map.getContainer().querySelectorAll<HTMLElement>('[title]')) {
      const text = el.getAttribute('title')
      if (!text) continue
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', text)
      el.dataset.tip = text
      el.dataset.tipEnd = ''
      el.removeAttribute('title')
    }

    map.on('error', (e) => {
      const m = e?.error?.message ?? 'unknown'
      console.error('[map]', m)
      propsRef.current.onNote('map error · ' + m.slice(0, 60))
    })

    map.on('style.load', () => {
      try {
        map.setSky({
          'sky-color': '#0d1018',
          'horizon-color': '#232742',
          'fog-color': '#191c2e',
          'sky-horizon-blend': 0.6,
          'horizon-fog-blend': 0.6,
          'fog-ground-blend': 0.4,
          'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.3, 9, 0],
        })
      } catch {
        // sky unsupported on this renderer — harmless
      }

      // World outlines arrive from TanStack Query; start empty and fill in.
      map.addSource('world', { type: 'geojson', data: EMPTY, attribution: 'Natural Earth' })
      map.addLayer({
        id: 'land',
        type: 'fill',
        source: 'world',
        paint: { 'fill-color': '#3a4052', 'fill-opacity': 1 },
      })
      // Night sits between the land fill and the country outlines. Underneath
      // it, land at night falls to rgb(25,27,37) against ocean at rgb(7,8,13) —
      // technically distinct, but it reads as one black disc, and half the globe
      // is night at any moment. Drawing the outlines on top keeps the dark side
      // legible as a wireframe earth without making it look like daytime.
      // Grid first, so land and the night wash sit over it rather than under.
      map.addSource('graticule', { type: 'geojson', data: GRATICULE })
      map.addLayer({
        id: 'graticule',
        type: 'line',
        source: 'graticule',
        paint: {
          'line-color': '#cfd3e5',
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.13, 4, 0.09, 8, 0.05],
          'line-width': 0.5,
        },
      })

      map.addSource('night', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'night',
        type: 'fill',
        source: 'night',
        paint: { 'fill-color': '#04050a', 'fill-opacity': 0.7 },
      })

      map.addLayer({
        id: 'borders',
        type: 'line',
        source: 'world',
        paint: {
          'line-color': '#cfd3e5',
          // Sitting above the night fill they keep the dark side readable, but at
          // full strength a long border chain (Russia–Mongolia–China–India) reads
          // as a single smooth line across the globe and looks like a stray
          // terminator. Fade them back when zoomed out; sharpen them close in.
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.4, 3, 0.6, 6, 0.9],
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 4, 1, 8, 1.5],
        },
      })

      // Traces of where the sun and moon have travelled over the scrubbed span.
      map.addSource('paths', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'path-moon',
        type: 'line',
        source: 'paths',
        filter: ['==', ['get', 'k'], 'moon'],
        paint: { 'line-color': '#cfd3e5', 'line-width': 1, 'line-opacity': 0.38 },
      })
      map.addLayer({
        id: 'path-sun',
        type: 'line',
        source: 'paths',
        filter: ['==', ['get', 'k'], 'sun'],
        paint: { 'line-color': '#ffc65c', 'line-width': 1.1, 'line-opacity': 0.5 },
      })

      map.addSource('edges', { type: 'geojson', data: EMPTY })
      // Two limbs of a single circle, told apart by colour rather than by dash:
      // gold where the sun is coming up, lavender where it is going down. The
      // gold matches the sun glyph, so the lit limb reads as the sun's own edge.
      map.addLayer({
        id: 'edge-sunset',
        type: 'line',
        source: 'edges',
        filter: ['==', ['get', 'k'], 'sunset'],
        paint: { 'line-color': '#b5abfc', 'line-width': 1.5, 'line-opacity': 0.85 },
      })
      map.addLayer({
        id: 'edge-sunrise',
        type: 'line',
        source: 'edges',
        filter: ['==', ['get', 'k'], 'sunrise'],
        paint: { 'line-color': '#ffc65c', 'line-width': 1.5, 'line-opacity': 0.9 },
      })

      map.addSource('cities', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'cities',
        type: 'circle',
        source: 'cities',
        paint: {
          'circle-color': ['get', 'c'],
          'circle-opacity': ['case', ['==', ['get', 'm'], 1], 0, 0.9],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2.4, 3, 4, 8, 7],
          'circle-stroke-color': 'rgba(12,14,20,.8)',
          'circle-stroke-width': ['case', ['==', ['get', 'm'], 1], 0, 1],
        },
      })
      map.addLayer({
        id: 'city-highlight',
        type: 'circle',
        source: 'cities',
        filter: ['==', ['get', 'p'], -1],
        paint: {
          'circle-color': ['get', 'c'],
          'circle-opacity': 0.18,
          'circle-radius': 12,
          'circle-stroke-color': ['get', 'c'],
          'circle-stroke-width': 1.4,
          'circle-stroke-opacity': 0.9,
        },
      })
      map.addLayer({
        id: 'city-hover',
        type: 'circle',
        source: 'cities',
        filter: ['==', ['get', 'n'], ''],
        paint: {
          'circle-color': 'rgba(181,171,252,.10)',
          'circle-radius': 10,
          'circle-stroke-color': 'rgba(210,206,253,.75)',
          'circle-stroke-width': 1,
        },
      })
      map.addLayer({
        id: 'city-active',
        type: 'circle',
        source: 'cities',
        filter: ['==', ['get', 'n'], ''],
        paint: {
          'circle-color': 'rgba(181,171,252,.18)',
          'circle-radius': 13,
          'circle-stroke-color': '#f5f4ff',
          'circle-stroke-width': 1.6,
        },
      })

      // Sun and moon live in their own overlay so they can orbit outside the
      // globe; city labels stay as map markers since they are always on it.
      const overlay = overlayRef.current
      if (overlay && !bodiesRef.current) {
        const sun = glyph('sun')
        const moon = glyph('moon')
        const tip = document.createElement('div')
        tip.className = 'pg-tip'
        tip.style.opacity = '0'
        overlay.append(sun, moon, tip)
        bodiesRef.current = { sun, moon }
        tipRef.current = tip

        const sunCv = orbCanvas(sun)
        const moonCv = orbCanvas(moon)
        const pair = bodiesRef.current
        if (sunCv && moonCv) {
          void import('./orb')
            .then(({ createOrb }) => {
              // Identity, not truthiness. Unmounting to #/solar and back before
              // the chunk lands leaves two `.then`s pending on the same import;
              // a `bodiesRef.current` truthiness check passes in both, so the
              // first would build two renderers on the now-detached canvases
              // and the second would overwrite them without disposing —
              // leaking two WebGL contexts per cycle, against a browser limit
              // of about sixteen.
              if (torn || bodiesRef.current !== pair) return
              // Until this lands the glyphs are just a soft halo and a label.
              orbsRef.current = {
                sun: createOrb(sunCv, 'sun', ORB_PX.sun),
                moon: createOrb(moonCv, 'moon', ORB_PX.moon),
              }
              // Constant appearance, so once is enough — the frame loop only
              // redraws the moon, whose phase and tilt actually change.
              orbsRef.current.sun.render(1, 0)
            })
            .catch((err) => console.error('[orbs]', err))
        }
      }
      // Pulses stay map markers: they belong to a real point on the surface and
      // should disappear with it when it rotates behind the earth.
      if (!pulsesRef.current) {
        const sky = skyState(new Date(propsRef.current.getNowMs()))
        pulsesRef.current = {
          sun: new maplibregl.Marker({ element: pulse('sun'), opacityWhenCovered: '0' })
            .setLngLat([sky.sun.lon, sky.sun.lat])
            .addTo(map),
          moon: new maplibregl.Marker({ element: pulse('moon'), opacityWhenCovered: '0' })
            .setLngLat([sky.moon.lon, sky.moon.lat])
            .addTo(map),
        }
      }

      // The mosque sites are drawn as buildings instead of dots.
      void import('./mosqueLayer')
        .then(({ createMosqueLayer }) => {
          // The map can be torn down while this is in flight.
          if (torn || !map.getStyle()) return
          map.addLayer(createMosqueLayer())
          // Only now is it safe to hide those cities' dots.
          mosquesReadyRef.current = true
          pushCities()
        })
        .catch((err) => console.error('[mosques]', err))

      readyRef.current = true
      propsRef.current.onNote('Natural Earth outlines · globe')
      const tip = tipRef.current
      if (tip) {
        // The globe carries no labels at all, so this is the only place a city
        // is named on the map.
        const name = hoveredRef.current
        const city = name ? CITIES.find((c) => c.n === name) : undefined
        if (city) {
          const p = map.project([city.lo, city.la])
          tip.textContent = city.n
          tip.style.transform = `translate(-50%, -100%) translate(${p.x.toFixed(1)}px, ${(p.y - 14).toFixed(1)}px)`
          tip.style.opacity = '1'
        } else {
          tip.style.opacity = '0'
        }
      }

      // Forced: the sources are brand new after a style load, so there is
      // nothing to compare the clock against yet.
      pushSky(true)
      pushCities()
    })

    // Off the globe, `lngLat` still resolves to a point on the rim, which would
    // otherwise keep switching cities while the pointer is out in empty space.
    // Projecting it back and checking it lands under the cursor tells us whether
    // the pointer is really on the earth.
    /** Name of the city dot under a screen point, with a forgiving hit box. */
    const cityAt = (pt: { x: number; y: number }): string | null => {
      if (!map.getLayer('cities')) return null
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [pt.x - 7, pt.y - 7],
        [pt.x + 7, pt.y + 7],
      ]
      // Several dots can fall inside the box at low zoom, and the first match is
      // not necessarily the one under the cursor — pick the closest.
      let best: string | null = null
      let bestDist = Infinity
      for (const f of map.queryRenderedFeatures(box, { layers: ['cities'] })) {
        const name = f.properties?.n
        if (typeof name !== 'string' || f.geometry.type !== 'Point') continue
        const [lon, lat] = f.geometry.coordinates as [number, number]
        const p = map.project([lon, lat])
        const d = Math.hypot(p.x - pt.x, p.y - pt.y)
        if (d < bestDist) {
          bestDist = d
          best = name
        }
      }
      return best
    }

    map.on('mousemove', (e) => {
      const back = map.project(e.lngLat)
      const onGlobe = Math.hypot(back.x - e.point.x, back.y - e.point.y) < 2.5
      propsRef.current.onHover(onGlobe ? { lat: e.lngLat.lat, lng: e.lngLat.lng } : null)

      // Hovering only previews a city; the panel still waits for a click.
      const name = onGlobe ? cityAt(e.point) : null
      if (name !== hoveredRef.current) {
        hoveredRef.current = name
        if (map.getLayer('city-hover')) map.setFilter('city-hover', ['==', ['get', 'n'], name ?? ''])
        map.getCanvas().style.cursor = name ? 'pointer' : ''
        propsRef.current.onCityHover(name)
      }
    })
    map.on('mouseout', () => {
      propsRef.current.onHover(null)
      if (hoveredRef.current !== null) {
        hoveredRef.current = null
        if (map.getLayer('city-hover')) map.setFilter('city-hover', ['==', ['get', 'n'], ''])
        map.getCanvas().style.cursor = ''
        propsRef.current.onCityHover(null)
      }
    })
    // Selection is explicit: only an actual city dot picks a city. A small box
    // around the pointer makes the small dots comfortably clickable.
    map.on('click', (e) => {
      const name = cityAt(e.point)
      if (name) propsRef.current.onCitySelect(name)
    })
    const emitView = () => {
      const c = map.getCenter()
      propsRef.current.onView({ lng: c.lng, lat: c.lat, zoom: map.getZoom() })
    }
    map.on('move', emitView)

    const skyCanvas = skyRef.current
    if (skyCanvas) {
      void import('./cosmos')
        .then(({ createCosmos }) => {
          if (torn || skyRef.current !== skyCanvas) return
          cosmosRef.current = createCosmos(skyCanvas)
          // Size it here, not only in the ResizeObserver. The observer delivers
          // its first callback before the next paint, long before a 140 KB
          // chunk can arrive, and it bails when cosmosRef is still null — so
          // this used to be the one sizing call and it never happened. The
          // canvas stayed at the HTML default 300×150 with camera.aspect 1
          // while CSS stretched it across the stage, which threw the orbit
          // rings off-centre from the globe on every single load.
          skyCanvas.width = host.clientWidth
          skyCanvas.height = host.clientHeight
          cosmosRef.current.resize(host.clientWidth, host.clientHeight)
        })
        .catch((err) => console.error('[cosmos]', err))
    }

    const ro = new ResizeObserver(() => {
      map.resize()
      const sky = skyRef.current
      if (sky && cosmosRef.current) {
        sky.width = host.clientWidth
        sky.height = host.clientHeight
        cosmosRef.current.resize(host.clientWidth, host.clientHeight)
      }
    })
    ro.observe(host)

    // Everything time-driven runs here, sampling the clock directly rather than
    // reading a value off props — props only change on React's ~5 Hz tick, which
    // is what made the bodies move in visible steps.
    //
    // Markers are cheap DOM transforms, so they update every frame. Rebuilding
    // the GeoJSON sources is not, so those are throttled; at 120 ms they still
    // keep up with the fastest the terminator ever sweeps.
    let raf = 0
    let lastLayers = 0
    let lastPulse = 0
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      if (!mapRef.current) return

      if (propsRef.current.spin && map.getZoom() < 3.2 && !map.isMoving()) {
        const c = map.getCenter()
        map.jumpTo({ center: [c.lng + 0.05, c.lat] })
      }

      // The sky shares the globe's frame but not its canvas, so it needs the
      // measured silhouette radius to line its camera up. One measurement per
      // frame: it is an 18-step project/unproject search, and both blocks below
      // want the same number.
      const frameBox = map.getContainer()

      // Everything below moves only with the camera or the clock. A second of
      // scrubbed time is 0.004° of celestial motion — far below a pixel — so a
      // resting globe redraws once a second instead of sixty times, while
      // scrubbing and spinning still cross the threshold every frame and update
      // continuously. The container size is in the signature because the rim
      // measurement depends on it.
      const cam =
        `${map.getCenter().lng.toFixed(4)}|${map.getCenter().lat.toFixed(4)}` +
        `|${map.getZoom().toFixed(3)}|${map.getBearing().toFixed(2)}|${map.getPitch().toFixed(2)}` +
        `|${frameBox.clientWidth}x${frameBox.clientHeight}`
      const celestialNow = propsRef.current.getNowMs()
      const celestialDirty =
        cam !== lastCamRef.current ||
        !(Math.abs(celestialNow - lastCelestialAtRef.current) < 1000)

      if (celestialDirty) {
      lastCamRef.current = cam
      lastCelestialAtRef.current = celestialNow
      const frameRim = globeRadius(frameBox.clientWidth, frameBox.clientHeight)

      const cosmos = cosmosRef.current
      if (cosmos) {
        placePlanetLabels(
          cosmos.render({
            map,
            nowMs: propsRef.current.getNowMs(),
            show: propsRef.current.showOrrery,
            rimPx: frameRim,
          }),
        )
      }

      const bodies = bodiesRef.current
      if (bodies && readyRef.current) {
        const cen = map.getCenter()
        const sky = skyState(new Date(propsRef.current.getNowMs()))
        const rim = frameRim
        positionBody(bodies.sun, sky.sun.lat, sky.sun.lon, cen, rim)
        positionBody(bodies.moon, sky.moon.lat, sky.moon.lon, cen, rim)

        // Redraw the 3D bodies, but not while they are hidden — zoomed into a
        // city both glyphs are switched off, and there is no sense running two
        // WebGL contexts to fill invisible pixels.
        const orbs = orbsRef.current
        if (orbs && rim != null) {
          // The sun is not redrawn here. Its arguments are constant, so every
          // frame produced identical pixels through a WebGL context of its own;
          // it is rendered once when the orbs are created.
          // The moon's lit limb faces the sun, so the terminator's tilt on
          // screen is the bearing from the sub-lunar point to the sub-solar one,
          // turned from compass degrees (clockwise from up) into an angle from
          // the +x axis, and corrected for however the map itself is rotated.
          const toSun =
            bearing(sky.moon.lat, sky.moon.lon, sky.sun.lat, sky.sun.lon) - (map.getBearing() || 0)
          orbs.moon.render(sky.moon.illum, (90 - toSun) * D)
        }
        const pulses = pulsesRef.current
        if (pulses) {
          pulses.sun.setLngLat([sky.sun.lon, sky.sun.lat])
          pulses.moon.setLngLat([sky.moon.lon, sky.moon.lat])
        }
      }
      }

      const tip = tipRef.current
      if (tip) {
        // The globe carries no labels at all, so this is the only place a city
        // is named on the map.
        const name = hoveredRef.current
        const city = name ? CITIES.find((c) => c.n === name) : undefined
        if (city) {
          const p = map.project([city.lo, city.la])
          tip.textContent = city.n
          tip.style.transform = `translate(-50%, -100%) translate(${p.x.toFixed(1)}px, ${(p.y - 14).toFixed(1)}px)`
          tip.style.opacity = '1'
        } else {
          tip.style.opacity = '0'
        }
      }

      // Pulse the highlighted set. Paint properties are set here rather than
      // animated declaratively because MapLibre has no keyframes of its own.
      if (map.getLayer('city-highlight')) {
        const phase = propsRef.current.highlightPhase
        if (phase !== highlightRef.current) {
          highlightRef.current = phase
          map.setFilter('city-highlight', ['==', ['get', 'p'], phase ?? -1])
        }
        if (phase !== null && t - lastPulse > 33) {
          lastPulse = t
          const beat = 0.5 + 0.5 * Math.sin(t / 190)
          map.setPaintProperty('city-highlight', 'circle-radius', 9 + beat * 9)
          map.setPaintProperty('city-highlight', 'circle-opacity', 0.1 + beat * 0.16)
          map.setPaintProperty('city-highlight', 'circle-stroke-opacity', 0.35 + beat * 0.55)
        }
      }

      pushSky()
      if (t - lastLayers > 250) {
        lastLayers = t
        pushCities()
      }
      // Per frame, like the terminator: on the fixed sample grid only the tip
      // moves, so throttling here would show as a stuttering leading edge.
      pushPaths()
    }
    raf = requestAnimationFrame(frame)

    /**
     * A hidden tab has no reason to run any of this.
     *
     * Browsers throttle requestAnimationFrame in background tabs but do not
     * stop it, and the globe kept spinning, rendering three WebGL contexts and
     * driving MapLibre's projection-error readback the whole time a user had it
     * open behind something else. Stopping outright costs nothing: on return,
     * the camera signature and clock have both moved, so the first frame
     * redraws everything anyway.
     */
    const onVisibility = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden) raf = requestAnimationFrame(frame)
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      torn = true
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      ro.disconnect()
      readyRef.current = false
      if (overlayRef.current) overlayRef.current.replaceChildren()
      orbsRef.current?.sun.dispose()
      orbsRef.current?.moon.dispose()
      orbsRef.current = null
      bodiesRef.current = null
      pulsesRef.current = null
      tipRef.current = null
      planetLabelsRef.current.clear()
      mapRef.current = null
      cosmosRef.current?.dispose()
      cosmosRef.current = null
      map.remove()
    }
  }, [])

  // World outlines, once TanStack Query has them.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !props.worldGeo) return
    const apply = () => {
      const src = map.getSource('world') as maplibregl.GeoJSONSource | undefined
      if (src) src.setData(props.worldGeo!)
    }
    if (readyRef.current) apply()
    else map.once('style.load', apply)
  }, [props.worldGeo])

  return (
    <>
      <div ref={hostRef} className="globe-host" />
      <canvas ref={skyRef} className="sky-canvas" />
      <div ref={overlayRef} className="bodies-layer" />
    </>
  )
})

export default Globe
