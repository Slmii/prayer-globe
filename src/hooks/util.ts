import { useCallback, useEffect, useRef, useState } from 'react';

/** The present. The scrubber does not run into the past. */
export const SCRUB_MIN = 0;
/** Ten days forward — still inside the 32 days Diyanet returns. */
export const SCRUB_MAX = 10 * 24 * 60;

/** Minutes in the chain sweep's single circuit. */
export const SWEEP_MINUTES = 1440;

/**
 * Sweep speeds, as multiples of the standard pace.
 *
 * 1× is a circuit in forty seconds — fast enough to see the loop close, slow
 * enough to read the cities it crosses. The others are that, halved and doubled.
 *
 * Lives here with the other clock constants rather than in the panel that
 * renders it: App sets the pace and ChainPanel offers the choice, and having the
 * list in either one made the other import it, which put a cycle between them.
 */
export const SWEEP_SPEEDS: { label: string; seconds: number }[] = [
	{ label: '½×', seconds: 80 },
	{ label: '1×', seconds: 40 },
	{ label: '2×', seconds: 20 },
	{ label: '4×', seconds: 10 }
];

export type PlayDir = 0 | 1 | -1;

export interface Clock {
	/** Scrub offset in minutes, sampled at the last React tick (for display). */
	scrub: number;
	playing: PlayDir;
	/** Continuous instant, safe to call every animation frame. */
	getNowMs: () => number;
	setScrub: (minutes: number) => void;
	/**
	 * Run the clock. `rate` overrides the default minutes-per-second and `limit`
	 * caps how far the scrub may travel — together they let one clock serve both
	 * the ten-day playback and the chain's single-day sweep.
	 */
	play: (dir: 1 | -1, opts?: { rate?: number; limit?: number }) => void;
	/** Minutes of simulated time per real second, for whatever is running now. */
	rate: number;
	stop: () => void;
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
export function useClock(minutesPerSecond: number, intervalMs = 200, initialScrub = 0): Clock {
	const [playing, setPlayingState] = useState<PlayDir>(0);
	// Seeded rather than set afterwards, so a link that names a time opens on it
	// instead of opening on now and then jumping.
	const [scrub, setScrubSample] = useState(initialScrub);
	const [, setTick] = useState(0);

	const anchor = useRef({ at: 0, scrub: initialScrub });
	const dirRef = useRef<PlayDir>(0);
	const rateRef = useRef(minutesPerSecond);
	const limitRef = useRef(SCRUB_MAX);
	const [rate, setRate] = useState(minutesPerSecond);

	const read = useCallback(() => {
		const dir = dirRef.current;
		if (!dir) return anchor.current.scrub;
		const elapsed = (performance.now() - anchor.current.at) / 1000;
		const s = anchor.current.scrub + dir * elapsed * rateRef.current;
		// Forward runs to whatever ceiling this run set; rewinding comes back to
		// now and no further.
		return dir > 0 ? Math.min(s, limitRef.current) : Math.max(s, 0);
	}, []);

	const getNowMs = useCallback(() => Date.now() + read() * 60000, [read]);

	const halt = useCallback((at: number) => {
		anchor.current = { at: performance.now(), scrub: at };
		dirRef.current = 0;
		setPlayingState(0);
		setScrubSample(at);
	}, []);

	const stop = useCallback(() => halt(read()), [halt, read]);

	/**
	 * Jump the clock to an offset, clamped to the range.
	 *
	 * Clamping belongs here rather than in each caller: the range input that used
	 * to be the only way in enforced its own bounds, so when it was replaced by a
	 * drag target nothing did, and repeated drags could walk the clock past ten
	 * days — or, with a negative offset, into a past this app does not have.
	 */
	const setScrub = useCallback((minutes: number) => halt(Math.max(SCRUB_MIN, Math.min(SCRUB_MAX, minutes))), [halt]);

	const play = useCallback(
		(dir: 1 | -1, opts?: { rate?: number; limit?: number }) => {
			const from = read();
			const ceiling = Math.min(opts?.limit ?? SCRUB_MAX, SCRUB_MAX);
			// Already parked at that end — nothing to play.
			if (dir > 0 ? from >= ceiling : from <= 0) return;
			rateRef.current = opts?.rate ?? minutesPerSecond;
			limitRef.current = ceiling;
			setRate(rateRef.current);
			anchor.current = { at: performance.now(), scrub: from };
			dirRef.current = dir;
			setPlayingState(dir);
		},
		[read, minutesPerSecond]
	);

	// Re-render a few times a second so the panel follows real time as well as
	// the scrub, and park the clock once it reaches either end.
	useEffect(() => {
		const id = window.setInterval(() => {
			const s = read();
			setScrubSample(s);
			setTick(t => t + 1);
			const dir = dirRef.current;
			if (dir && (dir > 0 ? s >= limitRef.current : s <= 0)) halt(s);
		}, intervalMs);
		return () => window.clearInterval(id);
	}, [read, halt, intervalMs]);

	return { scrub, playing, rate, getNowMs, setScrub, play, stop };
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
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		if (!enabled) return;
		const id = window.setTimeout(() => setSettled(value), delay);
		return () => window.clearTimeout(id);
	}, [value, enabled, delay]);
	return settled;
}
