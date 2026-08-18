// The time control, as the design's chosen "bare hairline" variant.
//
// One hairline spanning the whole scrub range: the present at the left edge,
// ten days out at the right, and a head wherever the clock has been pushed to.
//
// The range is deliberately the same one "Play 10 days" runs through, and it
// does not reach backwards. There is no past here by design — a prayer time
// that has already passed is a fact, not something to explore — so the left
// edge is now, and dragging there returns you to it.
//
// The design also marks each prayer along the track. Those are gone: at this
// width six ticks and their labels collided and read as noise, and the day dome
// above already lays the prayers out with room to name them.

import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Readout } from '../lib/readout';
import { SCRUB_MIN, SCRUB_MAX, SWEEP_SPEEDS } from '../hooks/util';
import { fmt, utcHours } from '../lib/astro';
import { Arabic, Label, Title } from './Typography';

interface Props {
	readout: Readout;
	/** Scrub offset in minutes, as the clock holds it. */
	scrub: number;
	setScrub(minutes: number): void;
	/** Someone is dragging — suppresses the live countdown elsewhere. */
	onScrubbingChange(dragging: boolean): void;
	scrubLabel: string;
	/** Seconds a full sweep circuit takes, and the setter for it. */
	sweepSeconds: number;
	onSweepSpeed(seconds: number): void;
	/** The clock's exact instant, safe to sample every frame. */
	getNowMs(): number;
}

export default function TimeBar({
	readout: a,
	scrub,
	setScrub,
	onScrubbingChange,
	scrubLabel,
	sweepSeconds,
	onSweepSpeed,
	getNowMs
}: Props) {
	const trackRef = useRef<HTMLDivElement>(null);
	const dragging = useRef(false);

	/** Move the clock to fraction `f` of the scrub range, now to +10 days. */
	const seek = (clientX: number) => {
		const el = trackRef.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
		setScrub(Math.round(SCRUB_MIN + f * (SCRUB_MAX - SCRUB_MIN)));
	};

	const down = (e: ReactPointerEvent<HTMLDivElement>) => {
		dragging.current = true;
		onScrubbingChange(true);
		e.currentTarget.setPointerCapture(e.pointerId);
		seek(e.clientX);
	};
	const move = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (dragging.current) seek(e.clientX);
	};
	const up = () => {
		dragging.current = false;
		onScrubbingChange(false);
	};

	const span = SCRUB_MAX - SCRUB_MIN;
	const head = `${(((scrub - SCRUB_MIN) / span) * 100).toFixed(2)}%`;
	const atNow = scrubLabel === 'now';

	/*
	 * The digits, redrawn every frame.
	 *
	 * `readout` is far too expensive to rebuild at frame rate — it does the solar
	 * and lunar positions and tallies every city by prayer — so it is sampled a
	 * few times a second, and that is exactly what made the time appear to jump
	 * whenever it moved: playing, gliding or dragging, the number arrived in
	 * fifths of a second.
	 *
	 * Only these four characters need to be smooth, and they cost a division and
	 * a format. So they are written straight to the node from an animation frame,
	 * out of React's way, rebuilt from the same offset the readout used so the two
	 * can never disagree.
	 */
	const clockRef = useRef<HTMLDivElement>(null);
	const offsetRef = useRef(a.offsetHours);
	offsetRef.current = a.offsetHours;

	useEffect(() => {
		let raf = 0;
		const frame = () => {
			const node = clockRef.current;
			if (node) {
				const next = fmt(utcHours(new Date(getNowMs())) + offsetRef.current);
				// Written only on change: an unchanged assignment still dirties the
				// node for the compositor.
				if (node.textContent !== next) node.textContent = next;
			}
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
	}, [getNowMs]);

	return (
		<div className='tbar' onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
			<div className='tbar-head'>
				{/* React paints the first value; the frame loop above owns it after. */}
				<div className='tbar-clock' ref={clockRef}>
					{a.clock}
				</div>
				<div className='tbar-mid'>
					<div className='tbar-prayer'>
						<Title size='lg' className='tbar-prayer-name'>
							{a.prayer}
						</Title>
						<Arabic size='md' className='tbar-prayer-ar'>
							{a.ar}
						</Arabic>
					</div>
					<div className='tbar-label'>
						{/* With no city the clock is stating UTC, so it says UTC. */}
						{atNow ? 'now' : scrubLabel} · {a.city ?? 'UTC'} · {a.stamp}
					</div>
				</div>
				<div className='tbar-actions'>
					{/*
						The clock's pace, kept with the clock.

						It paces whatever is running — a sweep circuit or a run of Play —
						which is a property of time passing rather than of the chain panel
						that happens to start one of them. This bar is the one surface on
						screen in every mode, so the control is where its effect is rather
						than behind a tab.
					*/}
					<div className='speed-seg' role='group' aria-label='Clock speed'>
						<Label size='xs' className='speed-seg-label'>
							SPEED
						</Label>
						{SWEEP_SPEEDS.map(s => (
							<button
								key={s.seconds}
								type='button'
								aria-pressed={s.seconds === sweepSeconds}
								className={'speed-seg-btn' + (s.seconds === sweepSeconds ? ' speed-seg-btn-on' : '')}
								data-hotkey={'speed' + s.seconds}
								onPointerDown={e => e.stopPropagation()}
								onClick={() => onSweepSpeed(s.seconds)}
							>
								{s.label}
							</button>
						))}
					</div>
					<Label size='sm' className='tbar-hint'>
						DRAG ANYWHERE
					</Label>
					<button
						type='button'
						className={'tbar-now' + (atNow ? '' : ' tbar-now-armed')}
						disabled={atNow}
						data-hotkey='now'
						data-tip='Return to the present · N'
						data-tip-above=''
						// Stop the press reaching the card, or the drag handler would seek
						// to wherever the button happens to sit before the reset lands.
						onPointerDown={e => e.stopPropagation()}
						onClick={() => setScrub(0)}
					>
						Now
					</button>
				</div>
			</div>

			<div className='tbar-track' ref={trackRef}>
				<span className='tbar-rule' />
				{/*
          A bare hairline: no prayer ticks, no noon mark.

          The design put a pip at each prayer, but on this width six of them plus
          a centre tick read as a row of unexplained scratches — and the prayer
          positions are already told properly by the day dome above, which has
          the room to name them. What is left is what this control is for:
          somewhere to drag, and a head showing where you are.
        */}
				<span className='tbar-progress' style={{ width: head }} />
				<span className='tbar-dot' style={{ left: head }} />
			</div>
		</div>
	);
}
