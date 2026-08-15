import { useCallback, useMemo, useRef, useState } from 'react'
import Globe from './components/Globe'
import type { GlobeHandle } from './components/Globe'
import SidePanel from './components/SidePanel'
import Legend from './components/Legend'
import CitySearch from './components/CitySearch'
import { CITIES } from './lib/cities'
import type { City } from './lib/cities'
import { useWorldGeo, usePrayerTimes } from './hooks/queries'
import { useClock, useSettledValue, SCRUB_MIN, SCRUB_MAX } from './hooks/util'
import { buildReadout } from './lib/readout'
import { pad } from './lib/astro'

// Minutes of simulated time per real second while playing — 10 days in ~40s.
const PLAY_RATE = 360

/** "+2d 06h 15m", or "now" at the present instant. */
function scrubLabelOf(minutes: number): string {
  const r = Math.round(minutes)
  if (r === 0) return 'now'
  const abs = Math.abs(r)
  const d = Math.floor(abs / 1440)
  const h = Math.floor((abs % 1440) / 60)
  return (r > 0 ? '+' : '−') + (d ? `${d}d ` : '') + `${h}h ${pad(abs % 60)}m`
}

interface View {
  lng: number
  lat: number
  zoom: number
}

export default function App() {
  const [spin, setSpin] = useState(false)
  const [showPaths, setShowPaths] = useState(false)
  const [showOrrery, setShowOrrery] = useState(true)
  const [hover, setHover] = useState<{ lat: number; lng: number } | null>(null)
  const [hoveredCity, setHoveredCity] = useState<string | null>(null)
  const [view, setView] = useState<View>({ lng: 39, lat: 20, zoom: 1.4 })
  const [note, setNote] = useState('loading outlines…')
  const globe = useRef<GlobeHandle>(null)

  const clock = useClock(PLAY_RATE)
  const { scrub, playing, getNowMs } = clock
  // Sampled for the panel; the globe samples the clock itself, every frame.
  const nowMs = getNowMs()

  const world = useWorldGeo()

  // Selection is explicit only: a click on a city dot, or the search box.
  // Deriving it from the map centre relabelled the panel just from turning the
  // globe, and snapping to the nearest city on hover was equally twitchy.
  const [activeCity, setActiveCity] = useState<City>(CITIES[0])

  // The city now only changes on a deliberate action, so there is no request
  // storm to guard against — a short settle is enough to coalesce rapid clicks.
  const queryCity = useSettledValue(activeCity, true, 400)
  const times = usePrayerTimes(queryCity)
  const settling = queryCity.n !== activeCity.n
  const querying = settling || times.isLoading || times.isFetching

  // Diyanet data is only valid for the city it was fetched for.
  const days = !settling && times.days?.length ? times.days : null

  const readout = useMemo(
    () => buildReadout({ city: activeCity, nowMs, hover, centerLng: view.lng, days }),
    [activeCity, nowMs, hover, view.lng, days],
  )

  const selectCity = useCallback((c: City, fly: boolean) => {
    setActiveCity(c)
    if (fly) {
      setSpin(false)
      globe.current?.flyTo(c.lo, c.la, 6.5, 3000)
    }
  }, [])

  // Clicking a dot selects it in place; searching flies there.
  const onCitySelect = useCallback(
    (name: string) => {
      const c = CITIES.find((x) => x.n === name)
      if (c) selectCity(c, false)
    },
    [selectCity],
  )

  /** Centre the globe on a point without changing the selected city. */
  const goTo = useCallback((lat: number, lon: number) => {
    setSpin(false)
    globe.current?.flyTo(lon, lat, 2.6, 2200)
  }, [])

  const onView = useCallback((v: View) => setView(v), [])
  const onNote = useCallback((n: string) => setNote(n), [])

  const mapNote = world.isPending
    ? 'loading Natural Earth outlines…'
    : world.isError
      ? 'outline fetch failed'
      : note

  const rounded = Math.round(scrub)
  const scrubLabel = scrubLabelOf(rounded)

  return (
    <div className="app">
      <SidePanel readout={readout} times={times} querying={querying} onGoTo={goTo} />

      <main className="stage">
        <Globe
          ref={globe}
          worldGeo={world.data}
          getNowMs={getNowMs}
          activeCityName={activeCity.n}
          spin={spin && !hover}
          showPaths={showPaths}
          showOrrery={showOrrery}
          onHover={setHover}
          onView={onView}
          onCitySelect={onCitySelect}
          onCityHover={setHoveredCity}
          onNote={onNote}
        />

        <div className="controls">
          <div className="pill">
            <button
              className={'pill-btn' + (spin ? ' pill-btn-on' : '')}
              aria-pressed={spin}
              title="Auto-rotate the earth"
              onClick={() => setSpin((v) => !v)}
            >
              <span className="pill-dot">{spin && <span className="pill-live pill-live-spin" />}</span>
              {spin ? 'Spinning' : 'Auto-spin'}
            </button>

            <button
              className={'pill-btn' + (playing ? ' pill-btn-on' : '')}
              aria-pressed={playing !== 0}
              title="Run the day forward"
              onClick={() => (playing ? clock.stop() : clock.play(1))}
            >
              <span className="pill-dot">{!!playing && <span className="pill-live pill-live-play" />}</span>
              {playing ? 'Stop' : 'Play 10 days'}
            </button>

            <button
              className={'pill-btn' + (showOrrery ? ' pill-btn-on' : '')}
              aria-pressed={showOrrery}
              title="Stars and planets"
              onClick={() => setShowOrrery((v) => !v)}
            >
              <span className="pill-dot">{showOrrery && <span className="pill-live pill-live-sky" />}</span>
              Sky
            </button>

            <button
              className={'pill-btn' + (showPaths ? ' pill-btn-on' : '')}
              aria-pressed={showPaths}
              title="Tracks the sun and moon have taken"
              onClick={() => setShowPaths((v) => !v)}
            >
              <span className="pill-dot">{showPaths && <span className="pill-live pill-live-path" />}</span>
              Path
            </button>

            <span className="pill-sep" />

            <button
              className="pill-btn pill-btn-plain"
              title="Fly to the selected city"
              onClick={() => selectCity(activeCity, true)}
            >
              City
            </button>
            <button
              className="pill-btn pill-btn-plain"
              title="Fly to Makkah"
              onClick={() => {
                const makkah = CITIES.find((c) => c.n === 'Makkah')
                if (makkah) selectCity(makkah, true)
              }}
            >
              Makkah
            </button>
            <button
              className="pill-btn pill-btn-plain"
              title="Pull back to the whole earth"
              onClick={() => {
                setSpin(false)
                globe.current?.flyTo(view.lng, 20, 1.4, 2200)
              }}
            >
              Whole earth
            </button>
            <button
              className="pill-btn pill-btn-plain"
              title="Return to the present"
              onClick={() => clock.setScrub(0)}
              disabled={!playing && rounded === 0}
            >
              Now
            </button>
          </div>

          <CitySearch onSelect={(c) => selectCity(c, true)} />
        </div>

        <div className="pointer">
          <div className="pointer-title">POINTER</div>
          <div className="pointer-pos">{readout.ptrPos}</div>
          <div className="pointer-note">
            {hoveredCity ? `${hoveredCity} · click to select` : `zoom ${view.zoom.toFixed(1)} · ${mapNote}`}
          </div>
        </div>

        <Legend />

        <div className="scrubber">
          <div className="scrub-head">
            <span className="scrub-title">TIME</span>
            <span className="scrub-label">{scrubLabel}</span>
            <span className="scrub-note">
              sun, moon and the night side follow the scrub · UTC {readout.utc}
            </span>
          </div>
          <input
            type="range"
            min={SCRUB_MIN}
            max={SCRUB_MAX}
            step={5}
            value={rounded}
            aria-label="Scrub time, minutes from now"
            onChange={(e) => clock.setScrub(Number(e.target.value))}
          />
        </div>
      </main>
    </div>
  )
}
