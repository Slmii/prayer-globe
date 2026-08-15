import { useCallback, useEffect, useRef, useState } from 'react'

/** The present. The scrubber does not run into the past. */
export const SCRUB_MIN = 0
/** Ten days forward — still inside the 32 days Diyanet returns. */
export const SCRUB_MAX = 10 * 24 * 60

export type PlayDir = 0 | 1 | -1

export interface Clock {
  /** Scrub offset in minutes, sampled at the last React tick (for display). */
  scrub: number
  playing: PlayDir
  /** Continuous instant, safe to call every animation frame. */
  getNowMs: () => number
  setScrub: (minutes: number) => void
  play: (dir: 1 | -1) => void
  stop: () => void
}

/**
 * A clock React can render from and the animation loop can sample continuously.
 *
 * These are different needs and conflating them is what made the sun and moon
 * stutter: React only re-renders a few times a second, so anything reading the
 * time from props moved in visible steps — and while playing, each step jumped
 * ~19 simulated minutes at once.
 *
 * So the scrub offset is stored as an anchor (a wall-clock instant plus the
 * offset at that instant) and derived on demand. `getNowMs()` is exact whenever
 * it is called, while `scrub` is just a sample for the panel text, which does
 * not need 60 Hz.
 */
export function useClock(minutesPerSecond: number, intervalMs = 200): Clock {
  const [playing, setPlayingState] = useState<PlayDir>(0)
  const [scrub, setScrubSample] = useState(0)
  const [, setTick] = useState(0)

  const anchor = useRef({ at: 0, scrub: 0 })
  const dirRef = useRef<PlayDir>(0)

  const read = useCallback(() => {
    const dir = dirRef.current
    if (!dir) return anchor.current.scrub
    const elapsed = (performance.now() - anchor.current.at) / 1000
    const s = anchor.current.scrub + dir * elapsed * minutesPerSecond
    // Forward runs out to +10 days; rewinding comes back to now and no further.
    return dir > 0 ? Math.min(s, SCRUB_MAX) : Math.max(s, 0)
  }, [minutesPerSecond])

  const getNowMs = useCallback(() => Date.now() + read() * 60000, [read])

  const halt = useCallback((at: number) => {
    anchor.current = { at: performance.now(), scrub: at }
    dirRef.current = 0
    setPlayingState(0)
    setScrubSample(at)
  }, [])

  const stop = useCallback(() => halt(read()), [halt, read])

  const setScrub = useCallback((minutes: number) => halt(minutes), [halt])

  const play = useCallback(
    (dir: 1 | -1) => {
      const from = read()
      // Already parked at that end — nothing to play.
      if (dir > 0 ? from >= SCRUB_MAX : from <= 0) return
      anchor.current = { at: performance.now(), scrub: from }
      dirRef.current = dir
      setPlayingState(dir)
    },
    [read],
  )

  // Re-render a few times a second so the panel follows real time as well as
  // the scrub, and park the clock once it reaches either end.
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = read()
      setScrubSample(s)
      setTick((t) => t + 1)
      const dir = dirRef.current
      if (dir && (dir > 0 ? s >= SCRUB_MAX : s <= 0)) halt(s)
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [read, halt, intervalMs])

  return { scrub, playing, getNowMs, setScrub, play, stop }
}

/**
 * Trail `value` by `delay`, and only move at all while `enabled`.
 *
 * Both halves matter for the Diyanet lookup. The delay stops a pointer sweeping
 * across the globe from firing a request per city it passes. The `enabled` gate
 * stops the auto-spin from doing the same thing far worse: the centre city
 * changes every second or so while spinning, which on its own is enough to burn
 * the API's 100-requests-per-15-minutes budget in about a minute. So we hold the
 * last settled city until the user actually points at something.
 */
export function useSettledValue<T>(value: T, enabled: boolean, delay: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (!enabled) return
    const id = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(id)
  }, [value, enabled, delay])
  return settled
}
