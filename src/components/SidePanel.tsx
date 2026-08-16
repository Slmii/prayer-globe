import { useEffect, useRef, useState } from 'react'
import type { Readout, ArcMark } from '../lib/readout'
import type { PrayerTimes } from '../hooks/queries'

interface SidePanelProps {
  readout: Readout
  times: PrayerTimes
  /** A Diyanet lookup is in flight or imminent for the displayed city. */
  querying: boolean
  /** Fly the globe to a point — used by the sun/moon cards. */
  onGoTo(lat: number, lon: number): void
  /** Show me the cities in this prayer phase. */
  onPickPhase(phase: number): void
  /** The clock has been scrubbed or is playing — not the present moment. */
  timeShifted: boolean
}

/** h:mm:ss while there is an hour to go, m:ss inside the last one. */
function countdown(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Placeholder for a value that depends on the city's still-unknown UTC offset. */
function Skeleton({ w = 42 }: { w?: number }) {
  return <span className="skel" style={{ width: w }} aria-hidden="true" />
}

// The arc is a semicircle: midnight at both feet, local noon at the apex.
const ARC = { cx: 170, cy: 174, r: 148 }

/** Point on the day arc for a fraction of the day, 0 → 1 left to right. */
function arcPoint(f: number) {
  const a = Math.PI - f * Math.PI
  return { x: ARC.cx + ARC.r * Math.cos(a), y: ARC.cy - ARC.r * Math.sin(a) }
}

/**
 * The day drawn as a dome.
 *
 * Both feet are midnight and the apex is local noon, with each prayer sitting
 * where it actually falls between them — so the shape of the day, and how far
 * through it you are, reads before any number does.
 */
function DayArc({
  marks,
  nowF,
  prayer,
  ar,
  pending,
}: {
  marks: ArcMark[]
  nowF: number
  prayer: string
  ar: string
  /** Waiting on the city's timetable — its offset, and so the whole arc. */
  pending: boolean
}) {
  // At midnight the dot leaves one foot of the arc and reappears at the other.
  // Interpolating that would drag it straight across the dome, so the jump is
  // detected and played as a fade out and back in instead.
  const prevF = useRef(nowF)
  const holdF = useRef(nowF)
  const timer = useRef<number | null>(null)
  const [wrapKey, setWrapKey] = useState(0)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const prev = prevF.current
    // Advance immediately. Deferring this to the timer meant the wrap kept
    // re-detecting on every tick, and because the tick (200ms) is shorter than
    // the fade (240ms) each run cleared the pending timer before it could fire —
    // so the dot faded out at midnight and never came back.
    prevF.current = nowF
    if (Math.abs(nowF - prev) <= 0.5) return

    holdF.current = prev
    setLeaving(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setLeaving(false)
      // Remounting drops the old transform, so nothing interpolates across.
      setWrapKey((k) => k + 1)
      timer.current = null
    }, 240)
  }, [nowF])

  // Only cancel on unmount, never on a re-run.
  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), [])

  const now = arcPoint(leaving ? holdF.current : nowF)
  const path = `M ${ARC.cx - ARC.r} ${ARC.cy} A ${ARC.r} ${ARC.r} 0 0 1 ${ARC.cx + ARC.r} ${ARC.cy}`

  return (
    <div className={'arc' + (pending ? ' arc-pending' : '')}>
      <svg viewBox="0 0 340 190" className="arc-svg" aria-hidden="true">
        <defs>
          <linearGradient id="pgArc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#4b4590" />
            <stop offset=".28" stopColor="#f4c56a" />
            <stop offset=".72" stopColor="#f0925e" />
            <stop offset="1" stopColor="#4b4590" />
          </linearGradient>
        </defs>
        <path className="arc-track" d={path} />
        <path className="arc-band" d={path} />
        <line className="arc-horizon" x1="10" y1={ARC.cy} x2="330" y2={ARC.cy} />
        {!pending &&
          marks.map((m) => {
          const p = arcPoint(m.f)
          return (
            <circle
              key={m.label}
              className="arc-mark"
              cx={p.x}
              cy={p.y}
              r={m.active ? 5 : 3.4}
              style={{ fill: m.active ? m.color : '#0f1120', stroke: m.color }}
            />
            )
          })}
        {/* Translated rather than re-pointed so a CSS transition can carry it
            between ticks: the panel only re-renders ~5 times a second, which
            while playing the day would otherwise step in visible jumps. */}
        {!pending && (
          <g
            key={wrapKey}
            className={'arc-now-g' + (leaving ? ' arc-now-leaving' : '')}
            style={{ transform: `translate(${now.x}px, ${now.y}px)` }}
          >
            <circle className="arc-now-ring" r={13} />
            <circle className="arc-now" r={7} />
          </g>
        )}
      </svg>

      <div className="arc-centre">
        {pending ? (
          <>
            <div className="arc-prayer">
              <Skeleton w={128} />
            </div>
            <div className="arc-ar">
              <Skeleton w={72} />
            </div>
          </>
        ) : (
          <>
            <div className="arc-prayer">{prayer}</div>
            <div className="arc-ar">{ar}</div>
          </>
        )}
      </div>
      <span className="arc-foot arc-foot-l">MIDNIGHT</span>
      <span className="arc-foot arc-foot-r">MIDNIGHT</span>
    </div>
  )
}

/** Where the prayer table came from. */
function SourceBadge({ readout, times, querying }: SidePanelProps) {
  if (readout.source === 'diyanet') {
    // Not "LIVE" any more: these are Diyanet's own published times, but read
    // from the snapshot in public/times/ rather than fetched per visit. Saying
    // live would claim a freshness the app no longer has — and the times are
    // Diyanet's regardless, which is the part that matters.
    return (
      <div className="src src-live">
        <span className="src-dot" />
        <span className="src-label">DIYANET · PUBLISHED</span>
        {times.district && <span className="src-note">{times.district.districtName}</span>}
      </div>
    )
  }
  if (times.rateLimited) {
    return (
      <div className="src src-warn">
        <span className="src-dot src-dot-warn" />
        <span className="src-label">RATE LIMITED</span>
        <span className="src-note">100 req / 15 min · solar model meanwhile</span>
      </div>
    )
  }
  const note = querying
    ? 'asking Diyanet for this city'
    : times.error
      ? 'Diyanet unreachable · solar model'
      : times.unavailable
        ? 'no Diyanet district · solar model'
        : 'pick a city to load its times'
  return (
    <div className="src">
      <span className="src-dot src-dot-idle" />
      <span className="src-label">{querying ? 'FETCHING…' : 'COMPUTED'}</span>
      <span className="src-note">{note}</span>
    </div>
  )
}

export default function SidePanel(props: SidePanelProps) {
  const { readout: a } = props
  // Until Diyanet answers we do not know the city's UTC offset, so every
  // clock-derived figure would be an hour or so out. Better to show nothing
  // than a number that visibly corrects itself a moment later.
  const pending = props.querying
  // Which band of the cities-by-prayer bar is under the pointer. The bands carry
  // no labels of their own, so this is the only way to read them.
  const [segment, setSegment] = useState<number | null>(null)

  return (
    <aside className="panel">
      <header className="panel-head">
        <div className="mark">
          <span className="mark-sq" />
          <span className="mark-sq mark-rot" />
        </div>
        <div className="wordmark">Ever&#8209;Standing</div>
        <div className="method">DIYANET 18°/17°</div>
      </header>

      <div className="datebar">
        <span className="datebar-greg">{a.dateLine}</span>
        {/*
          The hijri date is the one value that arrives with Diyanet rather than
          being derived, so between cities it is briefly empty. Left alone that
          collapsed its line box and lifted the whole panel by a line.

          The text therefore always stays in flow — hidden, not removed, and with
          a non-breaking space when Diyanet has no hijri at all — and the loading
          shimmer is laid over it. Swapping the text *for* a skeleton would have
          reintroduced the same jump: `.skel` is 10px against this line's 13px.
        */}
        <span className="datebar-hijri">
          {pending && <Skeleton w={104} />}
          <span className={pending ? 'is-hidden' : undefined}>{a.hijri || ' '}</span>
        </span>
      </div>

      <div className="rule" />

      <DayArc marks={a.arcMarks} nowF={a.nowF} prayer={a.prayer} ar={a.ar} pending={pending} />

      <div className="now-head">
        <span className="now-mode">{a.selMode}</span>
        <span className="now-hint">{a.selHint}</span>
      </div>

      <div className="city-card">
        <div className="city-card-main">
          <div className="city-card-name">
            <span className="city-dot" />
            <span className="city-name">{a.city}</span>
          </div>
          <div className="city-card-sub">
            {a.coord} · qibla {a.qibla}
          </div>
        </div>
        <div className="city-card-time">
          <div className="city-clock">{pending ? <Skeleton w={64} /> : a.clock}</div>
          <div className="city-next">
            {pending ? (
              <Skeleton w={92} />
            ) : props.timeShifted ? (
              // Counting down to a prayer at a moment that is not now would be
              // a countdown to nothing, so name the next prayer and stop there.
              <>next: {a.nextLabel}</>
            ) : (
              <>
                <span className="city-countdown">{countdown(a.nextMs)}</span> to {a.nextLabel}
              </>
            )}
          </div>
        </div>
      </div>

      <SourceBadge {...props} />

      <div className="times-grid">
        {a.times.map((r) => {
          const on = r.mark !== 'transparent'
          return (
            <div key={r.label} className={'time-card' + (on ? ' time-card-on' : '')}>
              <div className="time-card-head">
                <span className="time-card-dot" style={{ background: r.dim }} />
                <span className="time-card-label" style={{ color: r.fg }}>
                  {r.label}
                </span>
                <span className="time-card-ar" style={{ color: r.dim }}>
                  {r.ar}
                </span>
              </div>
              <span className="time-card-val" style={{ color: r.fg }}>
                {pending ? <Skeleton w={54} /> : r.time}
              </span>
            </div>
          )
        })}
      </div>

      <section className="solar" aria-label="Sunrise and sunset from coordinates">
        <div className="solar-head">
          <span className="solar-title">FROM COORDINATES</span>
          <span className="solar-note">geometric · −0.8°</span>
        </div>
        <div className="solar-row">
          <div className="solar-cell">
            <svg className="solar-mark" viewBox="0 0 20 14" aria-hidden="true">
              <path className="solar-horizon" d="M1 12h18" />
              <path className="solar-disc solar-disc-rise" d="M5.5 12a4.5 4.5 0 0 1 9 0" />
              <path className="solar-arrow solar-arrow-rise" d="M10 6.6V1.6M7.9 3.4 10 1.2l2.1 2.2" />
            </svg>
            <span className="solar-label">Sunrise</span>
            <span className="solar-time">{pending ? <Skeleton /> : a.sunriseGeo}</span>
          </div>
          <div className="solar-cell">
            <svg className="solar-mark" viewBox="0 0 20 14" aria-hidden="true">
              <path className="solar-horizon" d="M1 12h18" />
              <path className="solar-disc solar-disc-set" d="M5.5 12a4.5 4.5 0 0 1 9 0" />
              <path className="solar-arrow solar-arrow-set" d="M10 1.2v5M7.9 4.4 10 6.6l2.1-2.2" />
            </svg>
            <span className="solar-label">Sunset</span>
            <span className="solar-time">{pending ? <Skeleton /> : a.sunsetGeo}</span>
          </div>
        </div>
      </section>

      <footer className="panel-foot">
        <div className="bodies">
          <button
            type="button"
            className="body-card body-card-go"
            onClick={() => props.onGoTo(a.sunAt.lat, a.sunAt.lon)}
            title="Go to the point the sun is overhead"
          >
            <div className="body-head">
              <span className="body-icon body-icon-sun" aria-hidden="true">
                <span className="body-icon-rays" />
                <span className="body-icon-disc" />
              </span>
              <span className="body-title">SUN OVERHEAD</span>
            </div>
            <span className="body-val">{a.sunPos}</span>
          </button>
          <button
            type="button"
            className="body-card body-card-go"
            onClick={() => props.onGoTo(a.moonAt.lat, a.moonAt.lon)}
            title="Go to the point the moon is overhead"
          >
            <div className="body-head">
              <span className="body-icon body-icon-moon" aria-hidden="true">
                <span className="body-icon-disc">
                  {/* Same shadow rule as the globe glyph: covered at new, clear at full. */}
                  <span
                    className="body-icon-shadow"
                    style={{ transform: `translateX(${(a.moonIllum * 11).toFixed(1)}px)` }}
                  />
                </span>
              </span>
              <span className="body-title">MOON OVERHEAD</span>
            </div>
            <span className="body-val">{a.moonPos}</span>
          </button>
        </div>

        <div className="tally">
          <div className="tally-bar">
            {a.counts.map((c, i) => (
              <button
                key={c.label}
                type="button"
                className={'tally-cell' + (segment === i ? ' tally-cell-on' : '')}
                style={{ flex: c.flex }}
                title={`Show the ${c.n} cities in ${c.label}`}
                onMouseEnter={() => setSegment(i)}
                onMouseLeave={() => setSegment(null)}
                onFocus={() => setSegment(i)}
                onBlur={() => setSegment(null)}
                onClick={() => props.onPickPhase(c.phase)}
              >
                <span className="tally-seg" style={{ background: c.color }} />
                {segment === i && (
                  <span
                    className={
                      'tally-tip' +
                      (i === 0 ? ' tally-tip-first' : '') +
                      (i === a.counts.length - 1 ? ' tally-tip-last' : '')
                    }
                  >
                    <span className="tally-tip-dot" style={{ background: c.color }} />
                    <span className="tally-tip-name">{c.label}</span>
                    <span className="tally-tip-n">{c.n} cities</span>
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="tally-foot">
            <span>CITIES BY PRAYER</span>
            <span>{a.countLead}</span>
          </div>
        </div>
      </footer>
    </aside>
  )
}
