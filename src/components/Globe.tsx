import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { Map as MLMap, Marker, LngLat } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CITIES } from '../lib/cities'
import { createMosqueLayer } from './mosqueLayer'
import { createCosmos } from './cosmos'
import type { PlanetLabel } from './cosmos'
import { MOSQUES } from '../lib/mosques'
import {
  D,
  PHASES,
  phaseAt,
  skyState,
  bearing,
  terminatorArcs,
  nightPolygon,
  bodyPaths,
} from '../lib/astro'

/** Cities whose dot is replaced by a 3D mosque. */
const MOSQUE_CITIES = new Set(MOSQUES.map((m) => m.city))

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

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
  onHover(p: { lat: number; lng: number } | null): void
  onView(v: { lng: number; lat: number; zoom: number }): void
  /** A city dot was clicked, by name. */
  onCitySelect(name: string): void
  /** A city dot is under the pointer, by name (null when none). */
  onCityHover(name: string | null): void
  onNote(note: string): void
}

type GlyphKind = 'sun' | 'moon'

// Twelve spokes, each 7° wide on a 30° pitch.
const SUN_RAYS = `conic-gradient(from 0deg,${Array.from({ length: 12 }, (_, i) => {
  const a = i * 30
  return `rgba(255,232,170,.55) ${a}deg ${a + 7}deg,transparent ${a + 7}deg ${a + 30}deg`
}).join(',')})`

const RAY_MASK = 'radial-gradient(circle,transparent 0 34%,#000 40% 64%,transparent 70%)'

// left, top, width, height, opacity
const MARIA: [number, number, number, number, number][] = [
  [2.4, 3.6, 3.6, 3.2, 0.5],
  [7.6, 2.2, 2.4, 2.2, 0.42],
  [6, 8.4, 3, 2.6, 0.38],
]

/** DOM node for one celestial marker. */
function glyph(kind: GlyphKind): HTMLDivElement {
  const n = document.createElement('div')
  // Must be absolute: as a flow-level block it would stretch to the overlay's
  // full width, and the translate(-50%) centring would then shift it by half
  // the viewport instead of half the glyph.
  n.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;will-change:transform'
  const b = document.createElement('div')

  if (kind === 'sun') {
    b.style.cssText =
      'position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center'
    const corona = document.createElement('div')
    corona.style.cssText =
      'position:absolute;width:34px;height:34px;border-radius:50%;background:radial-gradient(circle,rgba(255,246,214,.5) 0%,rgba(255,214,120,.24) 42%,rgba(255,196,88,0) 72%);animation:pg-breathe 4.2s ease-in-out infinite'
    const rays = document.createElement('div')
    rays.style.cssText = `position:absolute;width:30px;height:30px;border-radius:50%;background:${SUN_RAYS};-webkit-mask:${RAY_MASK};mask:${RAY_MASK};animation:pg-spin 24s linear infinite`
    const disc = document.createElement('div')
    disc.style.cssText =
      'position:relative;width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 38% 34%,#fffdf4 0%,#ffe9a8 46%,#ffc65c 78%,#f0a63a 100%);box-shadow:0 0 12px 3px rgba(255,203,102,.6),0 0 26px 10px rgba(255,176,64,.22)'
    b.append(corona, rays, disc)
  } else {
    b.style.cssText =
      'position:relative;width:26px;height:26px;display:flex;align-items:center;justify-content:center'
    const halo = document.createElement('div')
    halo.style.cssText =
      'position:absolute;width:26px;height:26px;border-radius:50%;background:radial-gradient(circle,rgba(226,231,247,.34) 0%,rgba(198,205,232,0) 68%);animation:pg-breathe 6.5s ease-in-out infinite'
    const disc = document.createElement('div')
    disc.style.cssText =
      'position:relative;width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 36% 32%,#fdfdff 0%,#e2e6f4 52%,#b9c0d8 100%);box-shadow:0 0 10px 2px rgba(214,220,240,.35);overflow:hidden'
    for (const [l, t, w, h, o] of MARIA) {
      const m = document.createElement('div')
      m.style.cssText = `position:absolute;left:${l}px;top:${t}px;width:${w}px;height:${h}px;border-radius:50%;background:rgba(146,155,183,${o})`
      disc.appendChild(m)
    }
    const shadow = document.createElement('div')
    shadow.className = 'pg-moon-shadow'
    shadow.style.cssText =
      'position:absolute;left:0;top:0;width:14px;height:14px;border-radius:50%;background:#0b0d13;transform:translateX(0);transition:transform .6s ease'
    disc.appendChild(shadow)
    b.append(halo, disc)
  }

  const name = kind === 'sun' ? 'SUN' : 'MOON'
  const l = document.createElement('div')
  l.textContent = name
  l.style.cssText = `position:absolute;left:${kind === 'sun' ? 34 : 28}px;top:50%;transform:translateY(-50%);font:500 8.5px ui-monospace,Menlo,monospace;letter-spacing:.11em;color:rgba(233,233,237,.72);white-space:nowrap;text-shadow:0 1px 6px rgba(6,7,11,.95)`
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

/**
 * Slide the terminator shadow across the moon disc to match its lit fraction:
 * fully covering at new moon, fully clear at full.
 */
function setMoonPhase(el: HTMLElement, illum: number) {
  const shadow = el.querySelector<HTMLElement>('.pg-moon-shadow')
  if (shadow) shadow.style.transform = `translateX(${(illum * 14).toFixed(1)}px)`
}

const Globe = forwardRef<GlobeHandle, GlobeProps>(function Globe(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const readyRef = useRef(false)
  const bodiesRef = useRef<Record<GlyphKind, HTMLDivElement> | null>(null)
  const pulsesRef = useRef<Record<GlyphKind, Marker> | null>(null)
  const hoveredRef = useRef<string | null>(null)
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
  function pushSky() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const sky = skyState(new Date(propsRef.current.getNowMs()))
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
      src.setData(EMPTY)
      return
    }

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
    const { dec, eot, utcH } = skyState(new Date(getNowMs()))

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
        const st = (((utcH + c.lo / 15 + eot / 60) % 24) + 24) % 24
        return {
          type: 'Feature',
          // `m` marks a site drawn as a mosque; its dot is hidden but the
          // feature stays so clicking and the active ring still work.
          properties: {
            n: c.n,
            c: PHASES[phaseAt(c.la, st, dec)].c,
            m: MOSQUE_CITIES.has(c.n) ? 1 : 0,
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
    if (maplibregl.GlobeControl) map.addControl(new maplibregl.GlobeControl(), 'top-right')

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
      try {
        map.addLayer(createMosqueLayer())
      } catch (err) {
        console.error('[mosques]', err)
      }

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

      pushSky()
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

    if (skyRef.current) cosmosRef.current = createCosmos(skyRef.current)

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
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      if (!mapRef.current) return

      if (propsRef.current.spin && map.getZoom() < 3.2 && !map.isMoving()) {
        const c = map.getCenter()
        map.jumpTo({ center: [c.lng + 0.05, c.lat] })
      }

      // The sky shares the globe's frame but not its canvas, so it needs the
      // measured silhouette radius to line its camera up.
      const cosmos = cosmosRef.current
      if (cosmos) {
        const box = map.getContainer()
        placePlanetLabels(
          cosmos.render({
            map,
            nowMs: propsRef.current.getNowMs(),
            show: propsRef.current.showOrrery,
            rimPx: globeRadius(box.clientWidth, box.clientHeight),
          }),
        )
      }

      const bodies = bodiesRef.current
      if (bodies && readyRef.current) {
        const cen = map.getCenter()
        const box = map.getContainer()
        const sky = skyState(new Date(propsRef.current.getNowMs()))
        const rim = globeRadius(box.clientWidth, box.clientHeight)
        positionBody(bodies.sun, sky.sun.lat, sky.sun.lon, cen, rim)
        positionBody(bodies.moon, sky.moon.lat, sky.moon.lon, cen, rim)
        setMoonPhase(bodies.moon, sky.moon.illum)
        const pulses = pulsesRef.current
        if (pulses) {
          pulses.sun.setLngLat([sky.sun.lon, sky.sun.lat])
          pulses.moon.setLngLat([sky.moon.lon, sky.moon.lat])
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

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      readyRef.current = false
      if (overlayRef.current) overlayRef.current.replaceChildren()
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
