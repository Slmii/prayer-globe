// The live qibla finder — the design's `Qibla Finder 3D.html`.
//
// Turn until the arrow points straight away from you. The camera never moves;
// the world rotates under it by your heading, so "the arrow points away from
// me" and "I am facing the qibla" are the same statement. Within 4° it locks:
// the arrow goes green, the banner appears, and a phone buzzes.
//
// WHERE THE HEADING COMES FROM, AND WHERE IT DOESN'T
//
// A phone has a magnetometer and can answer this honestly. A laptop does not —
// measured on this machine, `deviceorientation` fires exactly once with alpha,
// beta and gamma all null, and `Magnetometer` is not exposed at all. So the
// finder never assumes: it asks for the compass, waits a moment to see whether
// anything real arrives, and falls back to dragging when nothing does. Drag and
// the arrow keys turn *you*, not the camera, which keeps the instrument honest
// on a desktop — it is then a heading you set rather than one it read.
//
// Two things are deliberately not shown until a heading exists: the big degree
// readout and the turn instruction. Printing "0°" before any source has
// reported would be inventing a direction the app does not know.
//
// Changed from the design: the coordinates come from the app rather than from
// `navigator.geolocation`, since a city is already selected — so the design's
// Locate button and its location fallbacks are gone.

import { useEffect, useRef, useState } from 'react';
import { buildFinderScene, delta } from '../lib/qibla-finder-scene';
import type { FinderScene } from '../lib/qibla-finder-scene';
import { qiblaGeometry } from '../lib/qibla-geometry';
import { Label, Value, Caption } from './Typography';

/**
 * Within this many degrees, we call it facing the qibla.
 *
 * Tighter than the design's 4°, which felt loose beside a readout quoting the
 * bearing to a tenth. It does not go lower: a phone magnetometer is good to
 * perhaps ±5–15° once calibrated, and below about a degree its own noise would
 * strobe the lock on and off rather than report anything.
 */
const LOCK_DEG = 2;
/** How long to wait for a real compass reading before believing there isn't one. */
const COMPASS_GRACE_MS = 1600;

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compassPoint = (deg: number) => POINTS[Math.round(deg / 22.5) % 16];

/** Where the heading is coming from, which is the one thing worth being plain about. */
export type Source = 'gate' | 'compass' | 'manual';

interface Props {
	lat: number;
	lon: number;
	place: string;
	/*
	 * Owned by the modal rather than by this component, so that switching to the
	 * diagram and back does not ask permission a second time. Re-entering the
	 * finder should resume it, not re-gate it.
	 */
	source: Source;
	setSource(next: Source): void;
}

export default function QiblaFinder({ lat, lon, place, source, setSource }: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const sceneRef = useRef<FinderScene | null>(null);

	// Read every frame, so they are refs rather than state: re-rendering React 60
	// times a second to print a number is not a thing worth doing.
	const headingRef = useRef(0);
	const shownRef = useRef(0);
	const aimedRef = useRef(false);
	const lockedRef = useRef(false);
	const lockAtRef = useRef(0);
	const bigRef = useRef<HTMLSpanElement>(null);
	const turnRef = useRef<HTMLSpanElement>(null);
	const offRef = useRef<HTMLSpanElement>(null);

	const [locked, setLocked] = useState(false);
	const [hint, setHint] = useState('Turn until the arrow points straight away from you.');

	// Read inside listeners that are attached once, so it has to be a ref.
	const sourceRef = useRef(source);
	sourceRef.current = source;

	const geo = qiblaGeometry(lat, lon);

	// Same reason: the frame loop is created once and must not close over a
	// bearing that can change under it.
	const bearingRef = useRef(geo.bearing);
	bearingRef.current = geo.bearing;

	/** Detaches the live compass feed, when there is one. */
	const detachRef = useRef<(() => void) | null>(null);

	// The scene, and the frame loop that drives it. Built once.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const S = buildFinderScene(canvas);
		sceneRef.current = S;
		S.resize();

		const host = canvas.parentElement;
		const ro = new ResizeObserver(() => S.resize());
		if (host) ro.observe(host);

		let raf = 0;
		let last = performance.now();
		const frame = (now: number) => {
			const dt = Math.min(0.05, (now - last) / 1000);
			last = now;

			// Smooth the heading so a jittery magnetometer does not shake the scene.
			const from = shownRef.current;
			shownRef.current = (from + delta(from, headingRef.current) * Math.min(1, dt * 7) + 360) % 360;
			S.world.rotation.y = (shownRef.current * Math.PI) / 180;

			if (aimedRef.current) {
				const off = delta(shownRef.current, bearingRef.current);
				const abs = Math.abs(off);
				const isLocked = abs <= LOCK_DEG;

				if (isLocked !== lockedRef.current) {
					lockedRef.current = isLocked;
					S.setLocked(isLocked);
					setLocked(isLocked);
					if (isLocked) {
						lockAtRef.current = now;
						navigator.vibrate?.([18, 40, 18]);
					}
				}

				if (bigRef.current) bigRef.current.textContent = Math.round(shownRef.current) + '°';
				if (offRef.current) offRef.current.textContent = abs < 0.5 ? 'aligned' : abs.toFixed(1) + '°';
				if (turnRef.current) {
					turnRef.current.textContent = isLocked
						? 'hold this direction'
						: (off > 0 ? 'turn right ' : 'turn left ') + Math.round(abs) + '°';
				}

				// A gentle breathing on the halo while locked.
				S.halo.scale.setScalar(isLocked ? 1 + Math.sin((now - lockAtRef.current) / 380) * 0.045 : 1);
			}

			S.renderer.render(S.scene, S.camera);
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			S.dispose();
			sceneRef.current = null;
		};
	}, []);

	// The compass outlives no mount. Left attached it would go on writing to a
	// dead component's ref, and a second mount would stack a second feed on top.
	useEffect(
		() => () => {
			detachRef.current?.();
			detachRef.current = null;
		},
		[]
	);

	// Point the ray at the bearing. Negative because a Y-rotation by a maps the
	// ray's authored −Z axis to (−sin a, −cos a), so the bearing needs the
	// opposite sign.
	useEffect(() => {
		const S = sceneRef.current;
		if (S) S.ray.rotation.y = (-geo.bearing * Math.PI) / 180;
	}, [geo.bearing]);

	/* ── heading sources ─────────────────────────────────────── */

	// Drag, and the arrow keys, turn you rather than the camera.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		let drag: { x: number; h: number } | null = null;

		const setHeading = (deg: number, manual: boolean) => {
			headingRef.current = (deg + 360) % 360;
			aimedRef.current = true;
			/*
			 * Turning it by hand takes over from the compass, which means actually
			 * letting go of the compass. Left attached it kept writing this same ref
			 * on every reading, so on a phone a drag was overwritten before it could
			 * be seen — the label said manual while the magnetometer still drove.
			 */
			if (manual && sourceRef.current === 'compass') {
				detachRef.current?.();
				detachRef.current = null;
				setSource('manual');
			}
		};

		const down = (e: PointerEvent) => {
			drag = { x: e.clientX, h: headingRef.current };
			// Capture is a convenience — it keeps a drag alive past the canvas edge.
			// It throws if the pointer is already gone, and losing the whole handler
			// to that would cost the drag itself, which matters more.
			try {
				canvas.setPointerCapture(e.pointerId);
			} catch {
				/* no active pointer; the drag still tracks via pointermove */
			}
		};
		const move = (e: PointerEvent) => {
			if (!drag) return;
			setHeading(drag.h + (e.clientX - drag.x) * 0.4, true);
		};
		const up = () => {
			drag = null;
		};
		const keys = (e: KeyboardEvent) => {
			if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
			e.preventDefault();
			const step = (e.shiftKey ? 10 : 2) * (e.key === 'ArrowLeft' ? -1 : 1);
			setHeading(headingRef.current + step, true);
		};

		canvas.addEventListener('pointerdown', down);
		canvas.addEventListener('pointermove', move);
		canvas.addEventListener('pointerup', up);
		canvas.addEventListener('pointercancel', up);
		window.addEventListener('keydown', keys);
		return () => {
			canvas.removeEventListener('pointerdown', down);
			canvas.removeEventListener('pointermove', move);
			canvas.removeEventListener('pointerup', up);
			canvas.removeEventListener('pointercancel', up);
			window.removeEventListener('keydown', keys);
		};
	}, []);

	/**
	 * Ask for the compass, then check whether one actually answered.
	 *
	 * Presence is not the test. Chrome on a Mac defines DeviceOrientationEvent,
	 * accepts the listener and fires it once with every field null — so the only
	 * reliable signal is a reading with a real number in it, within a moment of
	 * asking.
	 */
	async function startCompass(): Promise<boolean> {
		const DOE = window.DeviceOrientationEvent as
			| (typeof window.DeviceOrientationEvent & { requestPermission?: () => Promise<string> })
			| undefined;
		if (!DOE) return false;
		if (typeof DOE.requestPermission === 'function') {
			try {
				if ((await DOE.requestPermission()) !== 'granted') return false;
			} catch {
				return false;
			}
		}

		// Starting again replaces the feed rather than adding a second one.
		detachRef.current?.();
		detachRef.current = null;

		return new Promise<boolean>(resolve => {
			let settled = false;
			const onOrient = (e: DeviceOrientationEvent) => {
				const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
				let h: number | null = null;
				if (typeof ios === 'number') h = ios;
				else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
				if (h === null) return;
				headingRef.current = (h + 360) % 360;
				aimedRef.current = true;
				if (!settled) {
					settled = true;
					setSource('compass');
					resolve(true);
				}
			};
			const detach = () => {
				window.removeEventListener('deviceorientationabsolute', onOrient, true);
				window.removeEventListener('deviceorientation', onOrient, true);
			};
			window.addEventListener('deviceorientationabsolute', onOrient, true);
			window.addEventListener('deviceorientation', onOrient, true);
			// Kept on success — this is the live feed — but registered so that
			// unmounting, or starting over, can still take it down.
			detachRef.current = detach;

			setTimeout(() => {
				if (settled) return;
				settled = true;
				detach();
				detachRef.current = null;
				resolve(false);
			}, COMPASS_GRACE_MS);
		});
	}

	/*
	 * Coming back from the diagram, the gate has already been answered — so pick
	 * the heading source up again instead of asking. A compass reader re-attaches
	 * its listeners, which went down with the last unmount.
	 */
	useEffect(() => {
		if (source === 'gate') return;
		aimedRef.current = true;
		if (source === 'compass') void startCompass();
		// Mount only: this is the resume, not a reaction to later changes.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function start() {
		setSource('manual');
		const ok = await startCompass();
		if (!ok) {
			// Nothing to read, so the finder starts pointing north and waits for you
			// to turn it. Saying so beats a silent zero.
			aimedRef.current = true;
			setSource('manual');
		}
	}

	const dist = Math.round(geo.distance).toLocaleString('en-GB');

	return (
		<div className='qf'>
			<canvas ref={canvasRef} className='qf-canvas' />

			{/*
				The design keeps Calibrate up here beside Locate. In a modal the
				top-right corner belongs to the close button and the mode switch, so
				it has moved down to the strip — it is a rarely-pressed utility and
				reads fine there.
			*/}
			<div className='qf-top'>
				<div className='qf-plate'>
					<Label size='xs' as='span'>
						Your position
					</Label>
					<Value size='sm' as='span'>
						{place}
					</Value>
					<Label size='xs' as='span'>
						{dist} km to Makkah
					</Label>
				</div>
			</div>

			<div className={'qf-lock' + (locked ? ' on' : '')}>
				<span className='qf-lock-ar'>القبلة</span>
				<span className='qf-lock-en'>Facing the Qibla</span>
				<span className='qf-lock-sub'>
					Qibla {geo.bearing.toFixed(1)}° · {source === 'compass' ? 'compass' : 'manual'}
				</span>
			</div>

			{/*
				The big number is the way you are facing, and the banner's is the way
				the Kaaba lies — two different quantities, both in degrees, a few
				apart while locked. Unlabelled they read as one number contradicting
				itself, so each says which it is. The strip below spells out the
				difference, but it is the first thing to go on a narrow screen.
			*/}
			<div className={'qf-dial' + (locked ? ' locked' : '')}>
				<Label size='xs' as='span'>
					Your heading
				</Label>
				<span className='qf-dial-big' ref={bigRef}>
					—°
				</span>
				<span className='qf-dial-turn' ref={turnRef}>
					{source === 'gate' ? 'waiting' : source === 'compass' ? 'reading compass' : 'drag or ← → to turn'}
				</span>
			</div>

			<div className='qf-strip'>
				<div className='qf-cell'>
					<Label size='xs' as='span'>
						Qibla bearing
					</Label>
					<Value size='sm' as='span'>
						{geo.bearing.toFixed(1)}° {compassPoint(geo.bearing)}
					</Value>
				</div>
				<div className='qf-cell'>
					<Label size='xs' as='span'>
						Off by
					</Label>
					<Value size='sm' as='span'>
						<span ref={offRef}>—</span>
					</Value>
				</div>
				<button
					type='button'
					className='qf-ctl'
					onClick={() => {
						setHint('Move the phone in a figure of eight, away from metal and magnets, then hold it flat.');
						setTimeout(() => setHint('Turn until the arrow points straight away from you.'), 6000);
					}}
				>
					Calibrate
				</button>
				<Caption size='2xs' as='span' className='qf-hint'>
					{hint}
				</Caption>
			</div>

			{source === 'gate' && (
				<div className='qf-gate'>
					<div className='qf-gate-card'>
						<h1>Live qibla finder</h1>
						<p>
							This turns the Kaaba around you as you turn. On a phone it reads your compass; on a laptop
							there is no compass to read, so you turn it yourself.
						</p>
						<div className='qf-gate-row'>
							<button type='button' className='qf-gate-go' onClick={start}>
								Start
							</button>
							<button
								type='button'
								className='qf-gate-alt'
								onClick={() => {
									aimedRef.current = true;
									setSource('manual');
								}}
							>
								Drag instead
							</button>
						</div>
						<Caption size='2xs' as='span' className='qf-gate-fine'>
							Nothing leaves your device.
						</Caption>
					</div>
				</div>
			)}
		</div>
	);
}
