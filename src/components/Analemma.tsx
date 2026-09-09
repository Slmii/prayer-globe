// The sun's year, from one city, at one time of day — and which days each
// prayer lands on it.
//
// The design's `Analemma.html`, fitted to the app. A photograph of the sun taken
// at the same clock time every day for a year does not show it in the same
// place: it shows a figure of eight, tall because the earth is tilted and
// lopsided because its orbit is an ellipse.
//
// WHAT MAKES IT MORE THAN A CURIOSITY
//
// Four of the five prayers are defined by an altitude of the sun, and the
// vertical axis here *is* altitude — so each of them is a flat line across this
// sky, and every place the figure crosses one is a date on which that prayer
// falls at exactly this clock time. Asr is a band rather than a line because its
// angle moves with the season; Dhuhr is not an altitude at all but the sun
// clearing the meridian, so it is solved against the same table the year strip
// draws and the two agree by construction.
//
// The whole figure moves as the clock scrubs. Change the hour and it swings east
// to west across the sky; change the day and the sun walks around the loop.
// Both come from the time bar, which is already there — which is why the
// transport keys are deliberately left live over this modal.
//
// CHANGED FROM THE DESIGN
//
// The design's globe keeps every city on local mean solar time, so its plate
// sits square on the local meridian. This app prints Diyanet's real civil times
// everywhere else, so the plate uses the same civil offset — a reader who sees
// "every day at 09:15" must be able to trust that it is the 09:15 on their own
// clock. The figure leans a little as a result, by exactly the difference
// between the reader's timezone and their longitude.

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import Modal from './Modal';
import { AnalemmaSky } from './AnalemmaSky';
import { analemma, eotWords, hhmm, compassPoint, PRAYER_LINES } from '../lib/analemma';
import { SUN_EDGE_DEG, PHASES, phaseAt } from '../lib/astro';
import type { Analemma as Fig, AnalemmaPoint } from '../lib/analemma';
import { Label, Value, Arabic } from './Typography';

interface Props {
	place: string;
	lat: number;
	lon: number;
	/** Hours to add to UTC for this city's clock, held fixed across the year. */
	offsetHours: number;
	/** The scrubbed instant — sets both the hour drawn and where the sun sits. */
	nowMs: number;
	onClose(): void;
}

// Proportioned to the column it sits in rather than to the figure: the plate is
// the subject and should fill its half, and the figure is tall enough to want
// the height.
const W = 560;
const H = 470;
const PAD = { l: 52, r: 60, t: 26, b: 34 };

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });

/** Keep an axis to a readable handful of lines, whatever the span. */
const niceStep = (span: number, target: number) =>
	[0.5, 1, 2, 5, 10, 15, 30, 45, 60, 90].find(s => span / s <= target) ?? 120;

/**
 * The months, as initials along the foot of a chart.
 *
 * Every strip here runs January to December and none of them said so — which
 * left three charts whose horizontal axis was anybody's guess. Initials because
 * there are 238 pixels to fit twelve labels into.
 */
function MonthAxis({ x0, x1, y, days }: { x0: number; x1: number; y: number; days: number }) {
	const year = 2026;
	return (
		<g className='ana-months-axis'>
			{Array.from({ length: 12 }, (_, m) => {
				const day = Math.round((Date.UTC(year, m, 16) - Date.UTC(year, 0, 1)) / 86400000);
				return (
					<text key={m} x={x0 + (day / days) * (x1 - x0)} y={y} textAnchor='middle' className='ana-tick'>
						{MONTH.format(Date.UTC(year, m, 1))[0]}
					</text>
				);
			})}
		</g>
	);
}

/**
 * One signed quantity across the year, with the cursor marked on it.
 *
 * Carries its own scale and its own sentence: a wave between two unlabelled
 * extremes says only "something goes up and down", which is not worth the space
 * it takes.
 */
function Wobble({
	title,
	aside,
	hint,
	color,
	values,
	span,
	at,
	fmt
}: {
	title: string;
	aside: string;
	hint: string;
	color: string;
	values: number[];
	span: number;
	at: number;
	fmt: (v: number) => string;
}) {
	const w = 266;
	const h = 84;
	const padX = 30;
	const mid = 36;
	const x = (i: number) => padX + (i / (values.length - 1)) * (w - padX - 6);
	const y = (v: number) => mid - (v / span) * 26;
	const d = values.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join('');

	const hi = Math.max(...values);
	const lo = Math.min(...values);

	return (
		<div className='ana-wobble'>
			<div className='ana-sec-row'>
				<Label size='xs' className='ana-sec-title' style={{ color }}>
					{title}
				</Label>
				<Label size='2xs' className='ana-sec-aside'>
					{aside}
				</Label>
			</div>
			<p className='ana-sec-note'>{hint}</p>
			<svg viewBox={`0 0 ${w} ${h}`} className='ana-strip' aria-hidden='true'>
				{/* Zero, so "early" and "late" are visibly either side of something. */}
				<line x1={padX} y1={mid} x2={w - 6} y2={mid} stroke='rgba(233,233,237,0.14)' strokeDasharray='4 4' />
				<text x={padX - 5} y={y(hi) + 3} textAnchor='end' className='ana-tick'>
					{fmt(hi)}
				</text>
				<text x={padX - 5} y={mid + 3} textAnchor='end' className='ana-tick'>
					0
				</text>
				<text x={padX - 5} y={y(lo) + 3} textAnchor='end' className='ana-tick'>
					{fmt(lo)}
				</text>
				<path d={d} fill='none' stroke={color} strokeWidth='1.6' />
				<circle cx={x(at)} cy={y(values[at])} r='3.5' fill='#f4c56a' />
				<MonthAxis x0={padX} x1={w - 6} y={h - 3} days={values.length} />
			</svg>
		</div>
	);
}

export function Analemma({ place, lat, lon, offsetHours, nowMs, onClose }: Props) {
	/*
	 * The figure is tall and narrow — forty degrees of altitude against a dozen
	 * of bearing — so the design offers to stretch it sideways. At ×1 it is true
	 * angular scale and honest but cramped; ×2 is the default because it is the
	 * first setting at which the two loops are plainly different sizes, which is
	 * the fact the shape exists to show.
	 */
	const [ex, setEx] = useState(2);
	const [isSkyView, setIsSkyView] = useState(true);
	const [isReducedMotion, setIsReducedMotion] = useState(
		() => window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
	useEffect(() => {
		const media = window.matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => setIsReducedMotion(media.matches);
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	}, []);

	/*
	 * Walking the year.
	 *
	 * The figure is a path the sun actually travels, one lap a year, and the
	 * still picture never says so — you have to be told that the loop is time
	 * rather than shape. Sending the sun round it says it without a sentence, and
	 * each prayer mark lighting as the sun reaches it turns the crossings from
	 * annotations into events.
	 *
	 * `null` means "wherever today is", so the button changes what drives the
	 * cursor rather than adding a second source of truth for it.
	 */
	const [walk, setWalk] = useState<number | null>(null);
	const [isPlaying, setPlaying] = useState(false);

	const clockHour = (((nowMs / 3600000 + offsetHours) % 24) + 24) % 24;
	const clockMin = clockHour * 60;

	// Recomputed by the minute rather than by the frame: the shape depends only
	// on the hour, and a year of solar positions is cheap but not free.
	const minuteKey = Math.round(clockMin);
	const dayKey = Math.floor(nowMs / 86400000);

	const fig: Fig = useMemo(
		() => analemma(lat, lon, offsetHours, clockHour, nowMs),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[lat, lon, offsetHours, minuteKey, dayKey]
	);

	const plate = useMemo(() => {
		const xs = fig.points.map(p => p.dx);
		const ys = fig.points.map(p => p.alt);
		const xMin = Math.min(...xs);
		const xMax = Math.max(...xs);
		const yMin = Math.min(...ys);
		const yMax = Math.max(...ys);

		const xSpan = Math.max(xMax - xMin, 1.5);
		const ySpan = Math.max(yMax - yMin, 8);

		/*
		 * Fill the height first, then widen by as much of the asked-for stretch as
		 * still fits.
		 *
		 * Taking the smaller of the two scales instead let the widening decide the
		 * size of everything: a shape that is already wide — the sun before dawn,
		 * whose loop is as broad as it is tall — hit the side walls at ×2 and then
		 * sat in the middle 40% of the plate with empty sky above and below it. The
		 * height is the axis that always has something to say, so it is the one
		 * that gets filled, and the stretch gives way instead.
		 */
		const availW = W - PAD.l - PAD.r;
		let s = (H - PAD.t - PAD.b) / (ySpan * 1.08);
		let exFit = Math.min(ex, availW / (xSpan * s * 1.15));

		/*
		 * A shape too wide to fit even unstretched has to shrink, not spill.
		 *
		 * Clamping the stretch at 1 was wrong: near dawn the loop is about as wide
		 * as it is tall, so filling the height made it wider than the plate and it
		 * ran off both sides with only a slice of the middle showing. Below 1 the
		 * width is what binds, so the scale gives way instead — the one case where
		 * the height cannot have what it wants.
		 */
		if (exFit < 1) {
			exFit = 1;
			s = availW / (xSpan * 1.15);
		}

		const cx = (PAD.l + W - PAD.r) / 2;
		const cy = (PAD.t + H - PAD.b) / 2;
		const xm = (xMin + xMax) / 2;
		const ym = (yMin + yMax) / 2;

		const X = (v: number) => cx + (v - xm) * s * exFit;
		const Y = (v: number) => cy - (v - ym) * s;

		// A path through the samples, kept only where `test` holds — so the
		// stretch below the horizon can be drawn as the different thing it is.
		const seg = (test: (alt: number) => boolean) => {
			let d = '';
			let open = false;
			for (const p of [...fig.points, fig.points[0]]) {
				if (test(p.alt)) {
					d += (open ? 'L' : 'M') + X(p.dx).toFixed(1) + ' ' + Y(p.alt).toFixed(1);
					open = true;
				} else {
					open = false;
				}
			}
			return d;
		};

		// Altitude gridlines, and the bearing offsets across the bottom.
		const altSpan = (H - PAD.t - PAD.b) / s;
		const altStep = niceStep(altSpan, 7);
		const rows: { v: number; y: number }[] = [];
		for (let a = Math.ceil((ym - (H - PAD.b - cy) / s) / altStep) * altStep; rows.length < 20; a += altStep) {
			const y = Y(a);
			if (y < PAD.t) {
				break;
			}
			if (y <= H - PAD.b) {
				rows.push({ v: a, y });
			}
		}

		const offSpan = (W - PAD.l - PAD.r) / (s * exFit);
		const azStep = niceStep(offSpan, 5);
		const cols: { v: number; x: number }[] = [];
		for (let a = Math.ceil((xm - (cx - PAD.l) / (s * exFit)) / azStep) * azStep; cols.length < 20; a += azStep) {
			const x = X(a);
			if (x > W - PAD.r) {
				break;
			}
			if (x >= PAD.l) {
				cols.push({ v: a, x });
			}
		}

		const placed: { x: number; y: number }[] = [];

		/*
		 * The crossing dates, written on the plate beside their marks — and placed
		 * first, so that where a date and a month name want the same few pixels it
		 * is the month that gives way.
		 *
		 * Without them the picture shows anonymous dots on a dotted line while the
		 * rail shows a list of dates, and nothing says the two are the same fact.
		 * That is the whole question the crossings exist to answer, so it outranks
		 * the months, which are only there for orientation.
		 */
		const crossLabels = fig.crossings.map(c => {
			const x = X(c.dx);
			const y = Y(c.alt);
			const right = x < (PAD.l + W - PAD.r) / 2;
			const lx = x + (right ? 12 : -12);
			const clash = placed.some(q => Math.abs(q.x - lx) < 46 && Math.abs(q.y - y) < 11);
			if (!clash) {
				placed.push({ x: lx, y });
			}
			return { c, x: lx, y, anchor: (right ? 'start' : 'end') as 'start' | 'end', show: !clash };
		});

		// One dot per month along the trace, dropped where it would overprint.
		const months: { m: number; x: number; y: number; label: boolean }[] = [];
		const year = new Date(fig.today.ms).getUTCFullYear();
		for (let m = 0; m < 12; m++) {
			const n = Math.round((Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 86400000);
			const p: AnalemmaPoint = fig.points[Math.min(n, fig.points.length - 1)];
			const x = X(p.dx);
			const y = Y(p.alt);
			const clash = placed.some(q => Math.abs(q.x - x) < 30 && Math.abs(q.y - y) < 14);
			if (!clash) {
				placed.push({ x, y });
			}
			months.push({ m, x, y, label: !clash });
		}

		return {
			X,
			Y,
			crossLabels,
			above: seg(a => a >= 0),
			below: seg(a => a < 0),
			rows,
			cols,
			months,
			horizonY: Y(0),
			asr: [Y(fig.asrRange[1]), Y(fig.asrRange[0])] as [number, number],
			// What the widening actually came to, which is what the caption must
			// say — claiming ×3 while showing ×1.4 would be the plate lying.
			exFit
		};
	}, [fig, ex]);

	/*
	 * A lap every twelve seconds. Slow enough that the pause at each solstice —
	 * where the sun spends weeks barely moving — is visible as a pause, which is
	 * half of why the shape has the ends it does.
	 */
	const DAYS_PER_SECOND = 32;

	useEffect(() => {
		if (!isPlaying || isReducedMotion) {
			return;
		}
		const n = fig.points.length;
		let raf = 0;
		let last = performance.now();
		let at = walk ?? fig.today.day;
		const frame = (now: number) => {
			at = (at + (Math.min(now - last, 80) / 1000) * DAYS_PER_SECOND) % n;
			last = now;
			setWalk(at);
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
		// `walk` is the seed, not a trigger: listing it would restart the lap on
		// every frame it sets.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isPlaying, isReducedMotion, fig.points.length]);

	/*
	 * Where the cursor is. The readouts come from a real sample so nothing is
	 * interpolated that should not be — a prayer boundary, a phase — while the
	 * sun's own position is interpolated, because a marker hopping a whole day at
	 * a time is exactly the stutter this is meant to replace.
	 */
	const n = fig.points.length;
	const at = walk ?? fig.today.day;
	const t = fig.points[Math.round(at) % n];
	const lo = fig.points[Math.floor(at) % n];
	const hi = fig.points[(Math.floor(at) + 1) % n];
	const frac = at - Math.floor(at);
	const sunAt = { dx: lo.dx + (hi.dx - lo.dx) * frac, alt: lo.alt + (hi.alt - lo.alt) * frac };

	const lines = PRAYER_LINES.filter(L => (L.side === 'am') === fig.morning);
	const phase = PHASES[phaseAt(lat, t.solarHour, t.decRad)];

	/**
	 * How near the cursor is to a crossing, 0–1, for lighting it as it passes.
	 *
	 * The distance is circular — the year has no ends, so 31 December and
	 * 1 January are a day apart. Take the shorter way round, which is what the
	 * `min` is for: without it the measure is inverted and every mark lights when
	 * the sun is *half a year* from it.
	 */
	const nearness = (dayOfYear: number) => {
		const raw = Math.abs(at - dayOfYear) % n;
		const days = Math.min(raw, n - raw);
		return Math.max(0, 1 - days / 6);
	};

	/*
	 * The same fact from the other side: every prayer's clock time across the
	 * year, with the hour drawn as a flat line through them. Each place that line
	 * meets a curve is one of the crossings marked on the plate — so the two
	 * views can be checked against each other by eye.
	 */
	const strip = useMemo(() => {
		const w = 266;
		const h = 138;
		// Room at the foot for the month initials, which is what tells the reader
		// this axis is a year at all.
		const pad = { l: 22, r: 6, t: 6, b: 22 };
		const X = (i: number) => pad.l + (i / (fig.points.length - 1)) * (w - pad.l - pad.r);
		const Y = (m: number) => pad.t + (m / 1440) * (h - pad.t - pad.b);

		// Named as well as coloured: six unlabelled lines are a texture, not a chart.
		const curves = [
			{ key: 'fajr', c: '#b5abfc', label: 'Fajr' },
			{ key: 'rise', c: '#cfd3e5', label: 'Shuruq' },
			{ key: 'dhuhr', c: '#f5f4ff', label: 'Dhuhr' },
			{ key: 'asr', c: '#d2cefd', label: 'Asr' },
			{ key: 'set', c: '#968ae0', label: 'Maghrib' },
			{ key: 'isha', c: '#6f63ad', label: 'Isha' }
		].map(({ key, c, label }) => {
			let d = '';
			let open = false;
			fig.table.forEach((row, i) => {
				const v = row[key];
				// A boundary that does not happen leaves a gap rather than a line
				// drawn to nowhere — which is the polar summer, told honestly.
				if (!isFinite(v) || v < 0 || v > 1440) {
					open = false;
					return;
				}
				d += (open ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
				open = true;
			});
			return { key, c, d, label };
		});

		/*
		 * Keyed on the figure alone, because that is all the curves depend on.
		 *
		 * They used to be rebuilt whenever the clock line or the cursor moved,
		 * which is every render — several a second at rest and every frame while
		 * the year is isPlaying. That is 22KB of path string thrown away and
		 * rewritten each time for two lines that could be positioned in two
		 * multiplications. Those two are computed below instead, where they are
		 * cheap.
		 */
		return { w, h, pad, X, Y, curves };
	}, [fig]);

	const clockY = strip.pad.t + (clockMin / 1440) * (strip.h - strip.pad.t - strip.pad.b);
	const todayX = strip.pad.l + (t.day / (fig.points.length - 1)) * (strip.w - strip.pad.l - strip.pad.r);

	const eots = fig.points.map(p => p.eot);
	const decs = fig.points.map(p => p.dec);
	const eotSpan = Math.max(...eots.map(Math.abs));

	// One entry per prayer, even where a boundary is met twice in a year.
	const seen = new Set<string>();
	const crossings = fig.crossings.filter(c => {
		const k = c.key + Math.round(c.at);
		if (seen.has(k)) {
			return false;
		}
		seen.add(k);
		return true;
	});

	return (
		<Modal label={`The sun's year from ${place}`} onClose={onClose} className='ana'>
			<div className='ana-plot'>
				<header className='ana-head'>
					<div>
						<Label size='xs' className='ana-kicker'>
							The sun at {hhmm(clockMin)}, every day of the year
						</Label>
						<div className='ana-place'>{place}</div>
					</div>
					<button
						type='button'
						disabled={isReducedMotion}
						className={'ana-play' + (isPlaying ? ' ana-play-on' : '')}
						aria-pressed={isPlaying}
						onClick={() => setPlaying(v => !v)}
						data-tip='Send the sun round the year'
					>
						<span className='ana-play-glyph' aria-hidden='true' />
						{isPlaying && !isReducedMotion ? 'Pause' : 'Play the year'}
					</button>

					{walk !== null && !isPlaying && (
						<button
							type='button'
							className='ana-play'
							onClick={() => setWalk(null)}
							data-tip='Back to today'
						>
							Today
						</button>
					)}

					<div className='ana-seg' role='group' aria-label='Analemma view'>
						<button type='button' aria-pressed={isSkyView} onClick={() => setIsSkyView(true)}>
							3D sky
						</button>
						<button type='button' aria-pressed={!isSkyView} onClick={() => setIsSkyView(false)}>
							Chart
						</button>
					</div>
					{!isSkyView && (
						<div className='ana-seg' role='group' aria-label='Sideways scale'>
							{[1, 2, 3].map(v => (
								<button
									key={v}
									type='button'
									aria-pressed={v === ex}
									onClick={() => setEx(v)}
									data-tip={
										v === 1
											? 'The real proportions'
											: `Widen it ${v} times, so the two loops come apart`
									}
								>
									{v === 1 ? 'True' : `×${v}`}
								</button>
							))}
						</div>
					)}
				</header>

				{isSkyView ? (
					<AnalemmaSky figure={fig} day={at} isPlaying={isPlaying} isReducedMotion={isReducedMotion} />
				) : (
					<svg
						viewBox={`0 0 ${W} ${H}`}
						className='ana-svg'
						role='img'
						aria-label={`The analemma seen from ${place}`}
					>
						<defs>
							<linearGradient id='ana-season' x1='0' y1='0' x2='0' y2='1'>
								<stop offset='0' stopColor='#f4c56a' />
								<stop offset='0.5' stopColor='#b5abfc' />
								<stop offset='1' stopColor='#6f63ad' />
							</linearGradient>
							<linearGradient id='ana-dawn' x1='0' y1='0' x2='0' y2='1'>
								<stop offset='0' stopColor='#f4c56a' />
								<stop offset='1' stopColor='#f0925e' />
							</linearGradient>
						</defs>

						{/* Below the line the sun is not up. */}
						{plate.horizonY > PAD.t && plate.horizonY < H - PAD.b && (
							<>
								<rect
									x='0'
									y={plate.horizonY}
									width={W}
									height={H - plate.horizonY}
									fill='rgba(6,8,14,0.5)'
								/>
								<line
									x1='0'
									y1={plate.horizonY}
									x2={W}
									y2={plate.horizonY}
									stroke='rgba(181,171,252,0.4)'
									strokeWidth='1'
									strokeDasharray='5 5'
								/>
								<text
									x={W - PAD.r - 4}
									y={plate.horizonY - 8}
									textAnchor='end'
									className='ana-ax ana-ax-lit'
								>
									HORIZON
								</text>
							</>
						)}

						<g className='ana-grid'>
							{plate.rows.map(r => (
								<g key={r.v}>
									<line x1={PAD.l} y1={r.y} x2={W - PAD.r} y2={r.y} stroke='rgba(233,233,237,0.07)' />
									<text x={PAD.l - 9} y={r.y + 3} textAnchor='end' className='ana-ax'>
										{r.v}°
									</text>
								</g>
							))}
							{plate.cols.map(c => (
								<g key={c.v}>
									<line x1={c.x} y1={PAD.t} x2={c.x} y2={H - PAD.b} stroke='rgba(233,233,237,0.07)' />
									<text
										x={c.x}
										y={H - PAD.b + 14}
										textAnchor='middle'
										className={'ana-ax' + (c.v === 0 ? ' ana-ax-lit' : '')}
									>
										{c.v === 0
											? `${compassPoint(fig.azRef)} ${fig.azRef.toFixed(0)}°`
											: `${c.v > 0 ? '+' : '−'}${Math.abs(c.v)}°`}
									</text>
								</g>
							))}
						</g>

						{/*
						The prayers, as the flat lines they are on an altitude axis.
						Asr spans a band because its angle follows the season.
					*/}
						<g className='ana-prayers'>
							{!fig.morning && plate.asr[0] > PAD.t && plate.asr[1] < H - PAD.b && (
								<>
									<rect
										x={PAD.l}
										y={plate.asr[0]}
										width={W - PAD.l - PAD.r}
										height={Math.max(1, plate.asr[1] - plate.asr[0])}
										fill='rgba(210,206,253,0.07)'
									/>
									<text
										x={PAD.l + 6}
										y={(plate.asr[0] + plate.asr[1]) / 2 + 3}
										className='ana-pray-txt'
										fill='#d2cefd'
									>
										ASR {fig.asrRange[0].toFixed(0)}–{fig.asrRange[1].toFixed(0)}°
									</text>
								</>
							)}
							{lines.map(L => {
								if (L.alt === null) {
									return null;
								}
								const y = plate.Y(L.alt);
								if (y < PAD.t || y > H - PAD.b) {
									return null;
								}
								return (
									<g key={L.key}>
										<line
											x1={PAD.l}
											y1={y}
											x2={W - PAD.r}
											y2={y}
											stroke={L.color}
											strokeWidth='1'
											strokeDasharray='2 4'
											opacity='0.5'
										/>
										<text x={PAD.l + 6} y={y - 5} className='ana-pray-txt' fill={L.color}>
											{/*
											The two twilight edges are set at −0.833°, which is the
											sun's upper limb allowing for refraction — a precision
											nobody reads a chart for. They are the horizon, so they
											say so.
										*/}
											{L.label.toUpperCase()} {L.alt === SUN_EDGE_DEG ? '0°' : `${L.alt}°`}
										</text>
									</g>
								);
							})}
						</g>

						<path
							d={plate.below}
							fill='none'
							stroke='rgba(150,138,224,0.32)'
							strokeWidth='2'
							strokeDasharray='3 4'
							strokeLinecap='round'
						/>
						<path
							className='ana-line'
							d={plate.above}
							fill='none'
							stroke='url(#ana-season)'
							strokeWidth='2.25'
							strokeLinecap='round'
							pathLength={1}
						/>

						<g className='ana-months'>
							{plate.months.map(m => (
								<g key={m.m}>
									<circle
										cx={m.x}
										cy={m.y}
										r='2.8'
										fill='#0b1017'
										stroke='rgba(233,233,237,0.6)'
										strokeWidth='1.2'
									/>
									{m.label && (
										<text
											x={m.x + (m.x < W / 2 ? -9 : 9)}
											y={m.y + 3}
											textAnchor={m.x < W / 2 ? 'end' : 'start'}
											className='ana-mon'
											fill='rgba(233,233,237,0.5)'
										>
											{MONTH.format(Date.UTC(2026, m.m, 1)).toUpperCase()}
										</text>
									)}
								</g>
							))}
						</g>

						{/*
						The payoff: the dates this clock time IS a prayer time. Each one
						swells as the sun reaches it, so walking the year is also a way of
						watching the prayers arrive.
					*/}
						<g className='ana-cross'>
							{fig.crossings.map((c, i) => {
								const near = nearness(c.at);
								return (
									<g key={c.key + i}>
										<circle
											cx={plate.X(c.dx)}
											cy={plate.Y(c.alt)}
											r={8 + near * 9}
											fill='none'
											stroke={c.color}
											strokeWidth='1.25'
											opacity={0.85 - near * 0.6}
										/>
										<circle
											cx={plate.X(c.dx)}
											cy={plate.Y(c.alt)}
											r={3 + near * 1.8}
											fill={c.color}
										/>
									</g>
								);
							})}
							{/* The date, so the mark and the list are visibly one fact. */}
							{plate.crossLabels.map(
								(l, i) =>
									l.show && (
										<text
											key={i}
											x={l.x}
											y={l.y + 3}
											textAnchor={l.anchor}
											className='ana-mon'
											fill={l.c.color}
										>
											{DATE.format(l.c.ms)}
										</text>
									)
							)}
						</g>

						<g className='ana-sun'>
							<circle
								cx={plate.X(sunAt.dx)}
								cy={plate.Y(sunAt.alt)}
								r='16'
								fill='rgba(244,197,106,0.12)'
							/>
							<circle
								cx={plate.X(sunAt.dx)}
								cy={plate.Y(sunAt.alt)}
								r='8.5'
								fill='rgba(244,197,106,0.22)'
							/>
							<circle cx={plate.X(sunAt.dx)} cy={plate.Y(sunAt.alt)} r='5' fill='url(#ana-dawn)' />
						</g>

						<text x='14' y='16' className='ana-ax'>
							{plate.exFit < 1.05
								? 'REAL PROPORTIONS'
								: `WIDENED ${plate.exFit.toFixed(1).replace(/\.0$/, '')}× SO IT CAN BE READ`}
						</text>
					</svg>
				)}
				<label className='ana-scrubber'>
					<span>
						Explore the year <b>{DATE.format(t.dateMs)}</b>
					</span>
					<input
						type='range'
						min={0}
						max={n - 1}
						step={1}
						value={Math.min(n - 1, Math.round(at))}
						aria-label='Day of the year'
						aria-valuetext={DATE.format(t.dateMs)}
						onChange={event => {
							setPlaying(false);
							setWalk(Number(event.target.value));
						}}
					/>
					<span>
						<small>January</small>
						<small>December</small>
					</span>
					{isReducedMotion && <small>Reduced motion is on. Use the slider to explore each date.</small>}
				</label>
			</div>

			<aside className='ana-rail'>
				<div className='ana-rail-head'>
					{/*
						The offset is named because it is held fixed all year, and that
						is doing real work: the winter dates below are the dates for a
						clock that never went back an hour. Without saying so, a reader
						in summer time would take a January crossing at face value and
						be an hour out.
					*/}
					<Label size='xs'>
						{hhmm(clockMin)} · {DATE.format(t.dateMs)} · UTC
						{offsetHours >= 0 ? '+' : '−'}
						{Number.isInteger(offsetHours) ? Math.abs(offsetHours) : Math.abs(offsetHours).toFixed(1)} all
						year
					</Label>
				</div>

				{/*
					What the picture is, before anything is said about what is on it.
					Nobody arrives knowing what an analemma is, and a reader who does not
					know the loop is a year of positions cannot make sense of a single
					mark on it.
				*/}
				<section className='ana-sec'>
					<Label size='xs' className='ana-sec-title ana-sec-title-pale'>
						What you are looking at
					</Label>
					<p className='ana-sec-note'>
						If you looked up at {hhmm(clockMin)} every day for a year, the sun would not be in the same
						place: higher in summer, lower in winter, and drifting a little from side to side. Join up all{' '}
						{fig.points.length} positions and you get this loop.
					</p>
					{/*
						The question every reader asks on opening a second city: why does
						this one look nothing like the last. Almost always the answer is
						the hour rather than the place, so it is said before they have to
						ask.
					*/}
					<p className='ana-sec-note'>
						Change the time and the whole loop moves with it — tall and narrow around midday, low and
						sprawling near dawn and dusk, and it swings east to west across the day. Two cities look
						different mostly because you are watching them at different hours.
					</p>
					{/* Two kinds of dot, so both are named. */}
					<ul className='ana-key ana-key-block'>
						<li>
							<span className='ana-key-dot' style={{ background: 'rgba(233,233,237,0.6)' }} />
							the first of each month
						</li>
						<li>
							<span className='ana-key-dot' style={{ background: '#ffd98a' }} />
							the sun on the selected date
						</li>
					</ul>
				</section>

				{/* Which prayer is in force at this clock time, by the app's own rule. */}
				<div className='ana-now' style={{ '--ph': phase.c } as CSSProperties}>
					<span className='ana-now-dot' />
					<span className='ana-now-name'>
						{phase.tr}
						{/* Names the date rather than saying "today", which stops being true
						    the moment the sun is sent walking round the year. */}
						<span className='ana-now-hint'>
							the prayer at {hhmm(clockMin)} on {DATE.format(t.dateMs)}
						</span>
					</span>
					<Arabic size='lg' className='ana-now-ar'>
						{phase.ar}
					</Arabic>
				</div>

				<section className='ana-sec'>
					<Label size='xs' className='ana-sec-title'>
						Prayers that begin at exactly {hhmm(clockMin)}
					</Label>
					{/*
						Three short paragraphs rather than one long one: what the levels
						are, what touching one means, and why it happens twice. Every
						reader who has asked about this plate has asked those three things
						in that order.
					*/}
					<p className='ana-sec-note'>
						A prayer does not begin at a fixed clock time — it begins when the sun reaches a certain height.
						Fajr starts when the sun is 18° below the horizon. In Chart view, that is the dotted <b>FAJR</b>{' '}
						line: the height that begins it.
					</p>
					<p className='ana-sec-note'>
						So wherever the loop <b>touches</b> a line, the sun was at exactly that height at exactly{' '}
						{hhmm(clockMin)} — which means the prayer began at {hhmm(clockMin)} that day.
					</p>
					<p className='ana-sec-note'>
						Twice a year, usually. The sun climbs past each height in spring and falls back through it in
						autumn, the way a thermometer passes 15° twice.
					</p>
					{/*
						Measured, not guessed: against Diyanet's own published table this
						model matches Fajr and Isha to under a minute below 45°, but is
						late to Shuruq and early to Maghrib by about seven minutes each —
						an equal-and-opposite pair, which is the signature of their safety
						margin rather than of an error here. Seven minutes is two to four
						days' worth of movement, so the dates are the sun's own rather
						than the ones the panel prints.
					*/}
					<p className='ana-sec-note'>
						Worked out from the sun itself. Diyanet leaves a few minutes’ margin either side, so the dates
						it prints can be two or three days from these.
					</p>
					{crossings.length ? (
						<ul className='ana-cross-list'>
							{/* A row lights as the sun reaches it, so the list and the picture
							    are plainly the same two facts. */}
							{crossings.map((c, i) => (
								<li key={c.key + i} className={nearness(c.at) > 0.35 ? 'is-near' : undefined}>
									<span className='ana-cross-dot' style={{ background: c.color }} />
									{/* Reads as the sentence it is: Fajr begins 11 Apr. */}
									<span className='ana-cross-name'>{c.label}</span>
									<span className='ana-cross-verb'>begins</span>
									<span className='ana-cross-date' style={{ color: c.color }}>
										{DATE.format(c.ms)}
									</span>
								</li>
							))}
						</ul>
					) : (
						/*
						 * Says why, not just that. An empty list otherwise reads as a
						 * failure to find something rather than as the answer it is: at
						 * this hour the sun is never at a height that starts a prayer,
						 * which is also why no level is drawn on the plate.
						 */
						<p className='ana-sec-note'>
							None. At {hhmm(clockMin)} the sun is never at a height that begins a prayer here — which is
							why no dotted level is drawn on the picture. Move the clock and the loop moves with it.
						</p>
					)}
				</section>

				<dl className='ana-rows'>
					{[
						[
							'How high',
							t.alt >= 0 ? 'above the horizon' : 'below the horizon — not yet up',
							`${t.alt.toFixed(1)}°`,
							t.alt >= 0 ? '#f4c56a' : 'rgba(150,138,224,0.85)'
						],
						['Which way', 'where to look for it', `${t.az.toFixed(0)}° ${compassPoint(t.az)}`, '#f5f4ff'],
						[
							'Sun vs clock',
							t.eot > 0 ? 'the sun is running early' : 'the sun is running late',
							eotWords(t.eot),
							'#b5abfc'
						],
						[
							'Overhead at',
							'the latitude the sun is above today',
							`${Math.abs(t.dec).toFixed(1)}° ${t.dec >= 0 ? 'N' : 'S'}`,
							'#f0925e'
						],
						['Sun highest', 'the real middle of the day', hhmm(t.noonMin), '#f5f4ff'],
						[
							'Size of the loop',
							'tall by wide, across the sky',
							/*
								Measured from the figure's own extremes, not from the June
								solstice minus the December one. South of the equator that
								pair is the wrong way round — Sydney reported a loop −47°
								tall.
							*/
							`${(
								Math.max(...fig.points.map(p => p.alt)) - Math.min(...fig.points.map(p => p.alt))
							).toFixed(0)}° × ${(
								Math.max(...fig.points.map(p => p.dx)) - Math.min(...fig.points.map(p => p.dx))
							).toFixed(0)}°`,
							'rgba(233,233,237,0.72)'
						]
					].map(([k, hint, v, colour]) => (
						<div key={k as string} className='ana-row'>
							<dt>
								<b>{k}</b>
								<span>{hint}</span>
							</dt>
							<Value as='dd' size='sm' style={{ color: colour as string }}>
								{v}
							</Value>
						</div>
					))}
				</dl>

				<section className='ana-sec'>
					<div className='ana-sec-row'>
						<Label size='xs' className='ana-sec-title ana-sec-title-pale'>
							Every prayer, all year
						</Label>
						<Label size='2xs' className='ana-sec-aside'>
							clock time
						</Label>
					</div>
					<p className='ana-sec-note'>
						Each line is one prayer, from January to December. The gold line is the time you are looking at,
						and every dot on it is a day that prayer lands there — the same days marked on the picture
						above.
					</p>
					<svg viewBox={`0 0 ${strip.w} ${strip.h}`} className='ana-strip' aria-hidden='true'>
						{[0, 6, 12, 18, 24].map(hr => (
							<g key={hr}>
								<line
									x1={strip.pad.l}
									y1={strip.Y(hr * 60)}
									x2={strip.w - strip.pad.r}
									y2={strip.Y(hr * 60)}
									stroke='rgba(233,233,237,0.08)'
								/>
								<text
									x={strip.pad.l - 5}
									y={strip.Y(hr * 60) + 3}
									textAnchor='end'
									className='ana-tick'
								>
									{String(hr).padStart(2, '0')}
								</text>
							</g>
						))}
						{strip.curves.map(c => (
							<path key={c.key} d={c.d} fill='none' stroke={c.c} strokeWidth='1.3' opacity='0.85' />
						))}
						<line
							x1={strip.pad.l}
							y1={clockY}
							x2={strip.w - strip.pad.r}
							y2={clockY}
							stroke='#f4c56a'
							strokeDasharray='3 3'
						/>
						{fig.crossings.map((c, i) => (
							<circle key={c.key + i} cx={strip.X(c.at)} cy={clockY} r='2.6' fill={c.color} />
						))}
						<line
							x1={todayX}
							y1={strip.pad.t}
							x2={todayX}
							y2={strip.h - strip.pad.b}
							stroke='rgba(233,233,237,0.22)'
						/>
						<MonthAxis
							x0={strip.pad.l}
							x1={strip.w - strip.pad.r}
							y={strip.h - 2}
							days={fig.points.length}
						/>
					</svg>

					{/* Which line is which. Six colours with no key is a texture. */}
					<ul className='ana-key'>
						{strip.curves.map(c => (
							<li key={c.key}>
								<span className='ana-key-dot' style={{ background: c.c }} />
								{c.label}
							</li>
						))}
					</ul>
				</section>

				{/*
					The two causes named in the note below, drawn. The equation of time
					is the sideways wobble and declination the up-and-down one; together
					they are the whole figure, and seeing them apart is what makes the
					eight stop looking arbitrary.
				*/}
				<section className='ana-sec'>
					<Wobble
						title='How early or late the sun runs'
						aside='the sideways part'
						hint='Against a steady clock, in minutes. This is what makes the loop wide.'
						color='#b5abfc'
						values={eots}
						span={eotSpan}
						at={t.day}
						fmt={v => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}m`}
					/>
					<Wobble
						title='How far north or south it is'
						aside='the up and down part'
						hint='The latitude the sun stands over. This is what makes the loop tall.'
						color='#f0925e'
						values={decs}
						span={23.44}
						at={t.day}
						fmt={v => `${Math.abs(v).toFixed(0)}°${v >= 0 ? 'N' : 'S'}`}
					/>
				</section>

				<p className='ana-note'>
					A clock ticks evenly. The earth does not — it leans over, and it swings round the sun in an oval
					rather than a circle. So the sun runs a little early some months and a little late in others, and by
					midday it is never quite where the clock says it should be. That drift is what draws this shape, and
					it is why prayer times keep moving through the year.
					{fig.clipped && ' Where the line is dotted the sun is not up yet, or has already set.'}
				</p>
			</aside>
		</Modal>
	);
}
