import { useEffect, useRef, useState } from 'react';
import type { Readout, ArcMark } from '../lib/readout';
import type { PrayerTimes } from '../hooks/queries';
import type { PhaseTable } from '../lib/phases';
import { nextBoundary } from '../lib/phases';
import { PHASES } from '../lib/astro';
import { CITIES } from '../lib/cities';
import { MAX_PINNED, resolvePin, pinName } from '../lib/permalink';
import type { Pin } from '../lib/permalink';
import type { City } from '../lib/cities';
import { AppIcon } from './AppIcon';
import ChainPanel from './ChainPanel';
import RecordsPanel from './RecordsPanel';
import RamadanPanel from './RamadanPanel';
import HilalPanel from './HilalPanel';
import type { Criterion } from '../lib/hilal';
import type { CitySummary } from '../lib/hilal-field';
import { Caption, Display, Label, Title, Value } from './Typography';

interface SidePanelProps {
	readout: Readout;
	times: PrayerTimes;
	/** A Diyanet lookup is in flight or imminent for the displayed city. */
	querying: boolean;
	/** Fly the globe to a point — used by the sun/moon cards. */
	onGoTo(lat: number, lon: number): void;
	/** Show me the cities in this prayer phase. */
	onPickPhase(phase: number): void;
	/** The clock has been scrubbed or is playing — not the present moment. */
	timeShifted: boolean;
	/** Which of the panel's four modes is showing. */
	mode: PanelMode;
	onMode(m: PanelMode): void;
	/** Every city's boundaries, for the chain and records modes. */
	phases: PhaseTable | null;
	/** The scrubbed instant the panel is describing. */
	nowMs: number;
	/** Which prayer the chain mode follows, a PHASES index. */
	chain: number;
	onChain(phase: number): void;
	/** The clock is running the chain's one-day sweep. */
	sweeping: boolean;
	onSweep(): void;
	/** Fly to a city and select it — used by chain edges and records. */
	onGoToCity(city: City): void;
	/** The pinned cities, oldest first — a name, or a whole record for one found
	 *  by locating, which the bundle does not contain. */
	pinned: Pin[];
	onTogglePin(): void;
	/** Drop one city from the pinned list. */
	onUnpin(name: string): void;
	/** Go and find where the reader is — the same act as the console's button. */
	onLocate(): void;
	/** A fix is being waited on, so the button can say so rather than sit dead. */
	locating: boolean;
	/** The evening the crescent map is drawn for, ms. */
	hilalEveningMs: number;
	criterion: Criterion;
	/** The selected city as a record, for the crescent's local geometry. */
	hilalCity: City | null;
	hilalBusy: boolean;
	conjunctionMs: number | null;
	/** Move the crescent map by whole evenings. */
	onStep(days: number): void;
	onNextCrescent(): void;
	onTonight(): void;
	/** The crescent map is showing an evening other than tonight. */
	shifted: boolean;
	tonightMs: number;
	/** Cities per crescent zone, and the best-placed one. */
	hilalSummary: CitySummary;
	/** Show the direction to the Kaaba from the selected city, in 3D. */
	onOpenQibla(): void;
}

/**
 * The panel's four modes.
 *
 * The header, the date and the footer are shared; only the middle changes. That
 * is deliberate — the sun and moon overhead, and the world's tally of prayers,
 * are true whatever you happen to be reading, so they stay put rather than
 * appearing and vanishing under you.
 */
export type PanelMode = 'now' | 'chain' | 'records' | 'ramadan' | 'hilal';

const MODES: { id: PanelMode; label: string; hint: string }[] = [
	{ id: 'now', label: 'Now', hint: 'This city, right now' },
	{ id: 'chain', label: 'Chain', hint: 'Follow one prayer around the earth' },
	{
		id: 'records',
		label: 'Records',
		hint: "The day's extremes across every city"
	},
	{ id: 'ramadan', label: 'Ramadan', hint: 'The month of fasting, day by day' },
	{ id: 'hilal', label: 'Hilal', hint: 'Where tonight’s new crescent can be seen' }
];

/** h:mm:ss while there is an hour to go, m:ss inside the last one. */
function countdown(ms: number): string {
	const t = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(t / 3600);
	const m = Math.floor((t % 3600) / 60);
	const s = t % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Placeholder for a value that depends on the city's still-unknown UTC offset. */
function Skeleton({ w = 42 }: { w?: number }) {
	return <span className='skel' style={{ width: w }} aria-hidden='true' />;
}

// The arc is a semicircle: midnight at both feet, local noon at the apex.
const ARC = { cx: 170, cy: 174, r: 148 };

/** Point on the day arc for a fraction of the day, 0 → 1 left to right. */
function arcPoint(f: number) {
	const a = Math.PI - f * Math.PI;
	return { x: ARC.cx + ARC.r * Math.cos(a), y: ARC.cy - ARC.r * Math.sin(a) };
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
	pending
}: {
	marks: ArcMark[];
	nowF: number;
	prayer: string;
	ar: string;
	/** Waiting on the city's timetable — its offset, and so the whole arc. */
	pending: boolean;
}) {
	// At midnight the dot leaves one foot of the arc and reappears at the other.
	// Interpolating that would drag it straight across the dome, so the jump is
	// detected and played as a fade out and back in instead.
	const prevF = useRef(nowF);
	const holdF = useRef(nowF);
	const timer = useRef<number | null>(null);
	const [wrapKey, setWrapKey] = useState(0);
	const [leaving, setLeaving] = useState(false);

	useEffect(() => {
		const prev = prevF.current;
		// Advance immediately. Deferring this to the timer meant the wrap kept
		// re-detecting on every tick, and because the tick (200ms) is shorter than
		// the fade (240ms) each run cleared the pending timer before it could fire —
		// so the dot faded out at midnight and never came back.
		prevF.current = nowF;
		if (Math.abs(nowF - prev) <= 0.5) return;

		holdF.current = prev;
		setLeaving(true);
		if (timer.current) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			setLeaving(false);
			// Remounting drops the old transform, so nothing interpolates across.
			setWrapKey(k => k + 1);
			timer.current = null;
		}, 240);
	}, [nowF]);

	// Only cancel on unmount, never on a re-run.
	useEffect(() => () => window.clearTimeout(timer.current ?? undefined), []);

	/**
	 * Where the marker is, as an angle rather than a point.
	 *
	 * The dot is moved by a CSS transition so it glides between renders instead of
	 * stepping — but a transition on `translate(x, y)` interpolates in a straight
	 * line, and a straight line between two points on a dome is a chord *through*
	 * it. At a few minutes per tick that was invisible; once the scrubber covered
	 * ten days across its width, a single drag moved the dot far enough that it
	 * visibly cut the corner and left the arc.
	 *
	 * Rotating about the arc's own centre has no such problem: the path a rotation
	 * traces is the circle. `translate(centre) rotate(f·180°) translate(-r)` puts
	 * f=0 at the left foot, 0.5 at the apex and 1 at the right foot — and because
	 * the two transform lists differ only in the angle, the browser interpolates
	 * that angle and the dot rides the arc exactly.
	 */
	const nowDeg = (leaving ? holdF.current : nowF) * 180;
	const path = `M ${ARC.cx - ARC.r} ${ARC.cy} A ${ARC.r} ${ARC.r} 0 0 1 ${ARC.cx + ARC.r} ${ARC.cy}`;

	return (
		<div className={'arc' + (pending ? ' arc-pending' : '')}>
			<svg viewBox='0 0 340 190' className='arc-svg' aria-hidden='true'>
				<defs>
					<linearGradient id='pgArc' x1='0' y1='0' x2='1' y2='0'>
						<stop offset='0' stopColor='#4b4590' />
						<stop offset='.28' stopColor='#f4c56a' />
						<stop offset='.72' stopColor='#f0925e' />
						<stop offset='1' stopColor='#4b4590' />
					</linearGradient>
				</defs>
				<path className='arc-track' d={path} />
				<path className='arc-band' d={path} />
				<line className='arc-horizon' x1='10' y1={ARC.cy} x2='330' y2={ARC.cy} />
				{!pending &&
					marks.map(m => {
						const p = arcPoint(m.f);
						return (
							<circle
								key={m.label}
								className='arc-mark'
								cx={p.x}
								cy={p.y}
								r={m.active ? 5 : 3.4}
								style={{
									fill: m.active ? m.color : '#0f1120',
									stroke: m.color
								}}
							/>
						);
					})}
				{/* Translated rather than re-pointed so a CSS transition can carry it
            between ticks: the panel only re-renders ~5 times a second, which
            while playing the day would otherwise step in visible jumps. */}
				{!pending && (
					<g
						key={wrapKey}
						className={'arc-now-g' + (leaving ? ' arc-now-leaving' : '')}
						style={{
							transform: `translate(${ARC.cx}px, ${ARC.cy}px) rotate(${nowDeg}deg) translate(-${ARC.r}px, 0px)`
						}}
					>
						<circle className='arc-now-ring' r={13} />
						<circle className='arc-now' r={7} />
					</g>
				)}
			</svg>

			<div className='arc-centre'>
				{pending ? (
					<>
						<div className='arc-prayer'>
							<Skeleton w={128} />
						</div>
						<div className='arc-ar'>
							<Skeleton w={72} />
						</div>
					</>
				) : (
					<>
						<Display as='div' size='xl' className='arc-prayer'>
							{prayer}
						</Display>
						<div className='arc-ar'>{ar}</div>
					</>
				)}
			</div>
			<span className='arc-foot arc-foot-l'>MIDNIGHT</span>
			<span className='arc-foot arc-foot-r'>MIDNIGHT</span>
		</div>
	);
}

/** Where the prayer table came from. */
function SourceBadge({ readout, times, querying }: SidePanelProps) {
	if (readout.source === 'diyanet') {
		// Not "LIVE" any more: these are Diyanet's own published times, but read
		// from the snapshot in public/times/ rather than fetched per visit. Saying
		// live would claim a freshness the app no longer has — and the times are
		// Diyanet's regardless, which is the part that matters.
		return (
			<div className='src src-live'>
				<span className='src-dot' />
				<span className='src-label'>DIYANET · PUBLISHED</span>
				{times.district && (
					<Caption size='sm' className='src-note'>
						{times.district.districtName}
					</Caption>
				)}
			</div>
		);
	}
	if (times.rateLimited) {
		return (
			<div className='src src-warn'>
				<span className='src-dot src-dot-warn' />
				<span className='src-label'>RATE LIMITED</span>
				<Caption size='sm' className='src-note'>
					100 req / 15 min · solar model meanwhile
				</Caption>
			</div>
		);
	}
	const note = querying
		? 'asking Diyanet for this city'
		: times.error
		? 'Diyanet unreachable · solar model'
		: times.unavailable
		? 'no Diyanet district · solar model'
		: 'pick a city to load its times';
	return (
		<div className='src'>
			<span className='src-dot src-dot-idle' />
			<span className='src-label'>{querying ? 'FETCHING…' : 'COMPUTED'}</span>
			<Caption size='sm' className='src-note'>
				{note}
			</Caption>
		</div>
	);
}

/**
 * The pinned city, always in view.
 *
 * The point of pinning is that your own city stops being something you navigate
 * to. So once one is set it keeps a line of its own, with whatever it is
 * counting down to, however far away you happen to be looking. Its times come
 * from the whole-world table rather than a fetch, because only the *selected*
 * city's timetable is ever loaded.
 */
function HomeCard({
	pinned,
	phases,
	nowMs,
	activeCity,
	onGoTo,
	onUnpin
}: {
	pinned: Pin[];
	phases: PhaseTable | null;
	nowMs: number;
	activeCity: string | null;
	onGoTo(city: City): void;
	onUnpin(name: string): void;
}) {
	const cities = pinned.map(resolvePin).filter((c): c is City => !!c);
	if (!cities.length) return null;

	return (
		<div className='home-list'>
			{cities.map(city => {
				const next = phases ? nextBoundary(phases, city.ilceID, nowMs) : null;
				const mins = next ? Math.max(0, Math.round((next.ms - nowMs) / 60000)) : null;
				const when =
					mins == null
						? '—'
						: mins >= 60
						? `${PHASES[next!.phase].tr} in ${Math.floor(mins / 60)}h ${mins % 60}m`
						: `${PHASES[next!.phase].tr} in ${mins}m`;
				const here = city.n === activeCity;
				return (
					// A row, not a button: the row flies there and the cross unpins, and a
					// button cannot live inside a button.
					<div key={city.n} className={'home-card' + (here ? ' home-card-here' : '')}>
						<button
							type='button'
							className='home-go'
							onClick={() => onGoTo(city)}
							data-tip={here ? 'You are here' : `Go to ${city.n}`}
						>
							<span className='home-dot' />
							<span className='home-city'>{city.n}</span>
							<Value size='2xs' className='home-next'>
								{when}
							</Value>
						</button>
						<button
							type='button'
							className='home-drop'
							aria-label={`Unpin ${city.n}`}
							data-tip={`Unpin ${city.n}`}
							data-tip-end=''
							onClick={() => onUnpin(city.n)}
						>
							<AppIcon name='x' size='small' />
						</button>
					</div>
				);
			})}
		</div>
	);
}

export default function SidePanel(props: SidePanelProps) {
	const { readout: a } = props;
	// Until Diyanet answers we do not know the city's UTC offset, so every
	// clock-derived figure would be an hour or so out. Better to show nothing
	// than a number that visibly corrects itself a moment later.
	const pending = props.querying;

	// The two ways out of the empty state: the city you pinned, and the one this
	// whole app points at. Both resolved here rather than in the markup, so the
	// buttons simply do not appear when there is nothing behind them.
	const homes = props.pinned.map(resolvePin).filter((c): c is City => !!c);
	const makkah = CITIES.find(c => c.n === 'Makkah') ?? null;
	const isPinned = !!a.city && props.pinned.some(p => pinName(p) === a.city);
	const pinsFull = props.pinned.length >= MAX_PINNED;
	/**
	 * Pinning is offered for cities the app ships, and refused — visibly — for one
	 * found by locating.
	 *
	 * A found city has no dot on the globe, no row in the world table and no place
	 * in the chain or the records: it is a timetable and a name, held for the
	 * session. Pinning implies it will still be there next time in the same sense
	 * the others are, and it would not be. Shown disabled rather than hidden, so
	 * the answer is "not this one, and here is why" instead of a control that
	 * silently comes and goes.
	 */
	const pinnable = !!a.city && CITIES.some(c => c.n === a.city);
	// Which band of the cities-by-prayer bar is under the pointer. The bands carry
	// no labels of their own, so this is the only way to read them.
	const [segment, setSegment] = useState<number | null>(null);

	return (
		<aside className='panel'>
			<header className='panel-head'>
				<div className='mark'>
					<span className='mark-sq' />
					<span className='mark-sq mark-rot' />
				</div>
				<div className='wordmark'>Ever&#8209;Standing</div>
				{/*
					Where every number in this panel comes from, and the depression
					angles behind them. It reads as a badge rather than as a footnote
					because it is the app's one claim about its own authority — and
					because the two halves say different things: the source, and the
					convention that source applies.
				*/}
				<div className='method' data-tip='Diyanet’s own tables, solved at 18° for fajr and 17° for isha'>
					<span className='method-src'>DIYANET</span>
					<span className='method-sep' aria-hidden='true' />
					<span className='method-deg'>18°/17°</span>
				</div>
			</header>

			<div className='datebar'>
				<span className='datebar-greg'>{a.dateLine}</span>
				{/*
          The hijri date is the one value that arrives with Diyanet rather than
          being derived, so between cities it is briefly empty. Left alone that
          collapsed its line box and lifted the whole panel by a line.

          The text therefore always stays in flow — hidden, not removed, and with
          a non-breaking space when Diyanet has no hijri at all — and the loading
          shimmer is laid over it. Swapping the text *for* a skeleton would have
          reintroduced the same jump: `.skel` is 10px against this line's 13px.
        */}
				<span className='datebar-hijri'>
					{pending && <Skeleton w={104} />}
					<span className={pending ? 'is-hidden' : undefined}>{a.hijri || ' '}</span>
				</span>
			</div>

			<div className='rule' />

			<div className='modes' role='tablist'>
				{MODES.map((m, i) => {
					// Ramadan is one city's month of fasting, drawn from its own timetable.
					// With nothing selected there is no month to draw, so the tab says so
					// rather than opening on an empty chart. Chain and Records are about
					// every city at once and need no selection.
					const needsCity = m.id === 'ramadan' && !a.city;
					return (
						<button
							key={m.id}
							type='button'
							role='tab'
							aria-selected={props.mode === m.id}
							disabled={needsCity}
							className={'mode-btn' + (props.mode === m.id ? ' mode-btn-on' : '')}
							data-tip={needsCity ? 'Pick a city first — this is one city’s month' : m.hint}
							{...(i === 0 ? { 'data-tip-start': '' } : {})}
							{...(i === MODES.length - 1 ? { 'data-tip-end': '' } : {})}
							onClick={() => props.onMode(m.id)}
						>
							{m.label}
						</button>
					);
				})}
			</div>

			{/*
				Nothing selected. Said plainly, instead of opening on whichever city
				happened to sort first and presenting it as a choice. The footer below
				carries on regardless — where the sun and moon stand, and how the world
				divides by prayer, are true without anyone picking a place.
			*/}
			{(props.mode === 'now' || props.mode === 'ramadan') && !a.city && (
				<div className='no-city'>
					{/* The wordmark's two squares, opened out and given a dashed orbit —
					    the app's own mark, standing in for the city that isn't there. */}
					<div className='no-city-mark' aria-hidden='true'>
						<span className='no-city-sq' />
						<span className='no-city-sq no-city-sq-rot' />
						<span className='no-city-ring' />
					</div>
					<div className='no-city-title'>No city selected</div>
					<p className='no-city-note'>
						Hover the earth to read any city’s times, or click one to fly there. The globe keeps turning
						either way.
					</p>
					<div className='no-city-actions'>
						{/* First, because it is the one answer that needs no prior
						    knowledge of the map: the other buttons ask you to already
						    have somewhere in mind. Green, as everything that means
						    "you" on this globe is — the mark it drops, and the pinned
						    cities that are yours. */}
						<button
							type='button'
							className='no-city-btn no-city-btn-here'
							aria-busy={props.locating}
							disabled={props.locating}
							onClick={props.onLocate}
						>
							<AppIcon name='locate' size='small' />
							{props.locating ? 'Locating' : 'My location'}
						</button>
						{homes.map(h => (
							<button
								key={h.n}
								type='button'
								className='no-city-btn no-city-btn-home'
								onClick={() => props.onGoToCity(h)}
							>
								<span className='no-city-dot' />
								{h.n}
							</button>
						))}
						{makkah && (
							<button type='button' className='no-city-btn' onClick={() => props.onGoToCity(makkah)}>
								<span className='no-city-dot' />
								Makkah
							</button>
						)}
					</div>
				</div>
			)}

			{props.mode === 'now' && a.city && (
				<>
					<DayArc marks={a.arcMarks} nowF={a.nowF} prayer={a.prayer} ar={a.ar} pending={pending} />

					<div className='now-head'>
						<Label size='lg' className='now-mode'>
							{a.selMode}
						</Label>
						<Caption size='sm' className='now-hint'>
							{a.selHint}
						</Caption>
					</div>

					<HomeCard
						pinned={props.pinned}
						phases={props.phases}
						nowMs={props.nowMs}
						activeCity={a.city}
						onGoTo={props.onGoToCity}
						onUnpin={props.onUnpin}
					/>

					<div className='city-card'>
						<div className='city-card-main'>
							<div className='city-card-name'>
								<span className='city-dot' />
								<Title size='xl' className='city-name'>
									{a.city}
								</Title>
								{!pending && (
									<button
										type='button'
										className={'pin-btn' + (isPinned ? ' pin-btn-on' : '')}
										aria-pressed={isPinned}
										/* `aria-disabled`, not `disabled`: a disabled button dispatches
										   no pointer events at all, so the tooltip explaining why it is
										   refused would never open — the one thing it is here to do. It
										   stays focusable and announces as disabled; the click is
										   turned away below. */
										aria-disabled={!pinnable}
										data-tip={
											!pinnable
												? 'Found from your location — held for this session only, so there is nothing lasting to pin yet'
												: isPinned
												? 'Unpin this city'
												: pinsFull
												? `${MAX_PINNED} cities pinned — unpin one first`
												: 'Keep this city in view'
										}
										onClick={() => pinnable && props.onTogglePin()}
									>
										{/* Filled when this city is pinned — the icon's own state,
										    rather than swapping one character for another. */}
										<span className='pin-glyph'>
											<AppIcon name='pin' size='small' filled={isPinned} />
										</span>
										{isPinned ? 'Pinned' : 'Pin'}
									</button>
								)}
							</div>
							<div className='city-card-sub'>
								{a.coord} ·{' '}
								<button
									type='button'
									className='qibla-open'
									data-tip='See which way that is, in 3D'
									onClick={props.onOpenQibla}
								>
									qibla {a.qibla}
								</button>
							</div>
						</div>
						<div className='city-card-time'>
							<Value as='div' size='xl' className='city-clock'>
								{pending ? <Skeleton w={64} /> : a.clock}
							</Value>
							<div className='city-next'>
								{pending ? (
									<Skeleton w={92} />
								) : props.timeShifted ? (
									// Counting down to a prayer at a moment that is not now would be
									// a countdown to nothing, so name the next prayer and stop there.
									<>next: {a.nextLabel}</>
								) : (
									<>
										<span className='city-countdown'>{countdown(a.nextMs)}</span> to {a.nextLabel}
									</>
								)}
							</div>
						</div>
					</div>

					<SourceBadge {...props} />

					<div className='times-grid'>
						{a.times.map(r => {
							const on = r.mark !== 'transparent';
							return (
								<div key={r.label} className={'time-card' + (on ? ' time-card-on' : '')}>
									<div className='time-card-head'>
										<span className='time-card-dot' style={{ background: r.dim }} />
										<span className='time-card-label' style={{ color: r.fg }}>
											{r.label}
										</span>
										<span className='time-card-ar' style={{ color: r.dim }}>
											{r.ar}
										</span>
									</div>
									<span className='time-card-val' style={{ color: r.fg }}>
										{pending ? <Skeleton w={54} /> : r.time}
									</span>
								</div>
							);
						})}
					</div>

					<section className='solar' aria-label='Sunrise and sunset from coordinates'>
						<div className='solar-head'>
							<Label size='sm' className='solar-title'>
								FROM COORDINATES
							</Label>
							<Label size='sm' className='solar-note'>
								geometric · −0.8°
							</Label>
						</div>
						<div className='solar-row'>
							<div className='solar-cell'>
								<span className='solar-mark solar-mark-rise'>
									<AppIcon name='sunrise' />
								</span>
								<span className='solar-label'>Sunrise</span>
								<Value size='sm' className='solar-time'>
									{pending ? <Skeleton /> : a.sunriseGeo}
								</Value>
							</div>
							<div className='solar-cell'>
								<span className='solar-mark solar-mark-set'>
									<AppIcon name='sunset' />
								</span>
								<span className='solar-label'>Sunset</span>
								<Value size='sm' className='solar-time'>
									{pending ? <Skeleton /> : a.sunsetGeo}
								</Value>
							</div>
						</div>
					</section>
				</>
			)}

			{props.mode === 'chain' && (
				<ChainPanel
					phases={props.phases}
					nowMs={props.nowMs}
					chain={props.chain}
					onChain={props.onChain}
					onGoTo={props.onGoToCity}
					sweeping={props.sweeping}
					onSweep={props.onSweep}
				/>
			)}

			{props.mode === 'records' && (
				<RecordsPanel
					phases={props.phases}
					nowMs={props.nowMs}
					dateLine={a.dateLine}
					onGoTo={props.onGoToCity}
				/>
			)}

			{props.mode === 'ramadan' && a.city && (
				<RamadanPanel days={props.times.days} nowMs={props.nowMs} cityName={a.city ?? ''} pending={pending} />
			)}

			{/* No city needed: the crescent is a question about the whole earth,
			    and the legend answers it before anywhere is picked. */}
			{props.mode === 'hilal' && (
				<HilalPanel
					eveningMs={props.hilalEveningMs}
					criterion={props.criterion}
					city={props.hilalCity}
					busy={props.hilalBusy}
					onStep={props.onStep}
					onNextCrescent={props.onNextCrescent}
					onTonight={props.onTonight}
					shifted={props.shifted}
					tonightMs={props.tonightMs}
					days={props.times.days}
					summary={props.hilalSummary}
					onGoToCity={props.onGoToCity}
				/>
			)}

			<footer className='panel-foot'>
				<div className='bodies'>
					<button
						type='button'
						className='body-card body-card-go'
						onClick={() => props.onGoTo(a.sunAt.lat, a.sunAt.lon)}
						data-tip='Go to the point the sun is overhead'
						data-tip-above=''
					>
						<div className='body-head'>
							<span className='body-icon body-icon-sun'>
								<AppIcon name='sun' filled />
							</span>
							<Label size='md' className='body-title'>
								SUN OVERHEAD
							</Label>
						</div>
						<span className='body-val'>{a.sunPos}</span>
					</button>
					<button
						type='button'
						className='body-card body-card-go'
						onClick={() => props.onGoTo(a.moonAt.lat, a.moonAt.lon)}
						data-tip='Go to the point the moon is overhead'
						data-tip-above=''
					>
						<div className='body-head'>
							{/*
								The hand-drawn disc used to slide a shadow across itself to draw the
								exact phase. An icon set cannot do that, so the illumination it was
								showing now reads only from the percentage in the value line beside
								it, and the icon fills once past half — lit or mostly dark, which is
								the part you can take in at a glance anyway.
							*/}
							<span className='body-icon body-icon-moon'>
								<AppIcon name='moon' filled={a.moonIllum > 0.5} />
							</span>
							<Label size='md' className='body-title'>
								MOON OVERHEAD
							</Label>
						</div>
						<span className='body-val'>{a.moonPos}</span>
					</button>
				</div>

				<div className='tally'>
					<div className='tally-bar'>
						{a.counts.map((c, i) => (
							<button
								key={c.label}
								type='button'
								className={'tally-cell' + (segment === i ? ' tally-cell-on' : '')}
								style={{ flex: c.flex }}
								aria-label={`Show the ${c.n} cities in ${c.label}`}
								onMouseEnter={() => setSegment(i)}
								onMouseLeave={() => setSegment(null)}
								onFocus={() => setSegment(i)}
								onBlur={() => setSegment(null)}
								onClick={() => props.onPickPhase(c.phase)}
							>
								<span className='tally-seg' style={{ background: c.color }} />
								{segment === i && (
									<span
										className={
											'tally-tip' +
											(i === 0 ? ' tally-tip-first' : '') +
											(i === a.counts.length - 1 ? ' tally-tip-last' : '')
										}
									>
										<span className='tally-tip-dot' style={{ background: c.color }} />
										<span className='tally-tip-name'>{c.label}</span>
										<Label size='md' className='tally-tip-n'>
											{c.n} cities
										</Label>
									</span>
								)}
							</button>
						))}
					</div>
					<div className='tally-foot'>
						<span>CITIES BY PRAYER</span>
						<span>{a.countLead}</span>
					</div>
				</div>
			</footer>

			{/*
				The credit, last and quietest thing in the panel.

				A direct child of the panel, not of the footer above it. It is pinned to
				the foot of the scroller, and a sticky element can only travel inside
				its own parent — tucked in the footer it had a hundred and fifty pixels
				to move in and never reached the bottom of anything.

				The year comes from the clock rather than being typed in, so it cannot
				go stale in a file nobody thinks to open in January. The logo carries
				the name itself, so the line does not repeat it in words.
			*/}
			<div className='credit'>
				<span>© {new Date().getFullYear()} · Made by</span>
				{/* `noopener` because it opens in a new tab: without it the new page
				    gets a handle on this one through `window.opener`. */}
				<a
					className='credit-link'
					href='https://www.sbytes-it.com/en'
					target='_blank'
					rel='noopener noreferrer'
				>
					<img className='credit-logo' src={`${import.meta.env.BASE_URL}company.png`} alt='S-Bytes IT' />
				</a>
			</div>
		</aside>
	);
}
