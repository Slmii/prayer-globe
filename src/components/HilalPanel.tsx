// Whether tonight's crescent can be seen, here and everywhere.
//
// The globe carries the map; this carries the numbers behind it for one place,
// the choice of criterion, and the legend that says what the colours mean.
//
// The honesty line at the foot is not decoration. This is geometry: it knows
// where the moon will be and how wide the lit limb will be, and it knows
// nothing about cloud, haze, dust, or a hill on the western horizon. People
// decide when to fast on this question, so the map must never be read as a
// forecast of what will be seen.

import { useMemo } from 'react';
import { ZONES, ZONES_OF, sighting, nextConjunction, toJD, fromJD } from '../lib/hilal';
import type { Criterion } from '../lib/hilal';
import { CITIES } from '../lib/cities';
import type { City } from '../lib/cities';
import { monthStarts, startNear } from '../lib/hijri';
import type { TimetableDay } from '../lib/diyanet';
import type { CitySummary } from '../lib/hilal-field';
import { Body, Caption, Title, Value } from './Typography';

interface Props {
	/** The evening being asked about, ms. */
	eveningMs: number;
	criterion: Criterion;
	/** The selected city, for the local verdict. Null shows the legend alone. */
	city: City | null;
	/** A field is being computed for the globe. */
	busy: boolean;
	/** Move the evening by whole days. */
	onStep(days: number): void;
	/** Go to the evening after the next new moon — where the map gets interesting. */
	onNextCrescent(): void;
	/** Back to tonight. */
	onTonight(): void;
	/** The evening shown is not tonight. */
	shifted: boolean;
	/** Tonight's evening, ms — the offset the header shows is measured from it. */
	tonightMs: number;
	/** Cities per zone, and the best-placed one. */
	summary: CitySummary;
	/** Fly to and select a city — the best-sighting card is a way in. */
	onGoToCity(city: City): void;
	/**
	 * The selected city's timetable, for Diyanet's own month boundaries.
	 *
	 * Read from the shipped snapshot rather than fetched: every day already
	 * carries a Hijri date, so their decision costs nothing to show.
	 */
	days: TimetableDay[] | null;
}

const ZONE_BY_ID = new Map(ZONES.map(z => [z.id, z]));

const hhmm = (ms: number, lon: number) => {
	// Local mean time at the place, which is what "sunset" means to whoever is
	// standing there — no timezone table needed for a single clock reading.
	const t = new Date(ms + (lon / 15) * 3600000);
	return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
};

export default function HilalPanel({
	eveningMs,
	criterion,
	city,
	busy,
	onStep,
	onNextCrescent,
	onTonight,
	shifted,
	tonightMs,
	days,
	summary,
	onGoToCity
}: Props) {
	const local = city ? sighting(city.la, city.lo, eveningMs, criterion) : null;
	const zone = local ? ZONE_BY_ID.get(local.zone) : null;
	const bestZone = summary.best ? ZONE_BY_ID.get(summary.best.zone) : null;
	// Only the zones this rule draws — see ZONES_OF.
	const shownZones = ZONES.filter(z => ZONES_OF[criterion].includes(z.id));

	/** "Mon 12 Sep", the shape a date takes when you are stepping through days. */
	const dayLabel = new Date(eveningMs).toLocaleDateString('en-GB', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	});
	const offsetDays = Math.round((eveningMs - tonightMs) / 86400000);
	const offsetLabel = `${offsetDays > 0 ? '+' : '−'}${Math.abs(offsetDays)} d`;

	/**
	 * When the next crescent is, named on the button that goes there.
	 *
	 * Memoised because finding it walks a month of the ephemeris, and this
	 * component re-renders on every clock tick behind it.
	 */
	const nextLabel = useMemo(() => {
		const evening = fromJD(nextConjunction(toJD(eveningMs))) + 86400000;
		return new Date(evening).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
	}, [eveningMs]);

	// The best-sighting card is a way into that city, like every other city name
	// in this app.
	const goBest = () => {
		const b = summary.best;
		if (!b) return;
		const shipped = CITIES.find(c => c.n === b.name);
		if (shipped) onGoToCity(shipped);
	};

	// An Islamic day begins at sunset, so the month this evening could start is
	// the one dated to the following day.
	const diyanetStart = startNear(monthStarts(days ?? []), eveningMs + 86400000);
	const diyanetLabel = diyanetStart
		? new Date(diyanetStart.ms).toLocaleDateString('en-GB', {
				day: 'numeric',
				month: 'short',
				timeZone: 'UTC'
		  })
		: '';

	return (
		<div className='hil'>
			{/*
				The evening, and the two ways off it.
				Its own control rather than the app's scrubber: that one reaches ten
				days, which is the window Diyanet publishes times for, and a new moon
				can be four weeks out — so the one evening anyone opens this panel to
				see was the one it could not reach. Whole days only, because the map
				is an evening and not an instant.
			*/}
			<div className='hil-nav'>
				<button type='button' className='hil-nav-btn' onClick={() => onStep(-1)} aria-label='Previous evening'>
					‹
				</button>
				<span className='hil-nav-date'>
					{dayLabel}
					{shifted && (
						<Value size='2xs' className='hil-nav-off'>
							{offsetLabel}
						</Value>
					)}
				</span>
				{shifted && (
					<button type='button' className='hil-nav-now' onClick={onTonight}>
						Tonight
					</button>
				)}
				<button type='button' className='hil-nav-btn' onClick={() => onStep(1)} aria-label='Next evening'>
					›
				</button>
			</div>

			<button type='button' className='hil-jump' onClick={onNextCrescent}>
				<span className='hil-jump-moon' aria-hidden='true'>
					☾
				</span>
				Next crescent · {nextLabel}
				<span className='hil-jump-go' aria-hidden='true'>
					→
				</span>
			</button>

			{/*
				Where on earth it is best seen this evening.
				The map answers "where", but only if you read a whole globe of colour.
				This answers it in one line, and it is the line people actually want on
				an evening a month might turn. Clicking it goes there.
			*/}
			{summary.best && bestZone && (
				<button type='button' className='hil-best' onClick={goBest}>
					<span className='hil-best-dot' style={{ background: bestZone.colour }} />
					<span className='hil-best-main'>
						<span className='hil-best-tag'>BEST SIGHTING {shifted ? 'THIS EVENING' : 'TONIGHT'}</span>
						<Title className='hil-best-city'>{summary.best.name}</Title>
					</span>
					<Caption size='lg' className='hil-best-zone' color={bestZone.colour}>
						{bestZone.label}
					</Caption>
				</button>
			)}

			{/*
				Diyanet's own decision, next to the geometry rather than merged with
				it. Their calendar is one determination for the whole world, worked
				out in advance — so it can turn a month over on an evening when the
				crescent is nowhere near visible from where you stand. Showing both,
				and saying which is which, is the only honest way to put them on the
				same screen.
			*/}
			{diyanetStart && (
				<div className='hil-diyanet'>
					<span className='hil-diyanet-tag'>DIYANET CALENDAR</span>
					<span className='hil-diyanet-val'>
						{diyanetStart.month} begins {diyanetLabel}
					</span>
				</div>
			)}

			{city && local && zone ? (
				<div className='hil-local'>
					<div className='hil-verdict' style={{ color: zone.colour }}>
						<span className='hil-swatch' style={{ background: zone.colour }} />
						{zone.label}
						<Value size='2xs' className='hil-where'>
							in {city.n}
						</Value>
					</div>
					<dl className='hil-facts'>
						<div>
							<dt>Elongation</dt>
							<dd>{local.arcl.toFixed(1)}°</dd>
						</div>
						<div>
							<dt>Altitude over sun</dt>
							<dd>{local.arcv.toFixed(1)}°</dd>
						</div>
						<div>
							<dt>Crescent width</dt>
							<dd>{local.width.toFixed(2)}′</dd>
						</div>
						<div>
							<dt>Sets after sun</dt>
							<dd>{Math.round(local.lag)} min</dd>
						</div>
						<div>
							<dt>Moon age</dt>
							<dd>{local.age.toFixed(1)} h</dd>
						</div>
						<div>
							<dt>Sunset</dt>
							<dd>{hhmm(local.sunsetMs, city.lo)}</dd>
						</div>
					</dl>
				</div>
			) : (
				<p className='hil-empty'>
					{city
						? 'No sunset here on this date, so there is nothing to reckon a crescent from.'
						: 'Pick a city to read the geometry where you are.'}
				</p>
			)}

			{/*
				The legend, counted.
				A key tells you what a colour means; the tally tells you how much of
				the inhabited world it covers, which is the thing anyone actually
				wants to know from a visibility map. Counted over the cities the app
				ships — the same set the prayer tally uses, so the two numbers on
				screen are about the same world. The row for the zone this city is
				in is marked, so the local verdict and the global picture line up.
			*/}
			<div className='hil-legend'>
				{shownZones.map(z => (
					<span key={z.id} className={'hil-key' + (local?.zone === z.id ? ' hil-key-on' : '')}>
						<span className='hil-swatch' style={{ background: z.colour }} />
						<span className='hil-key-label'>{z.label}</span>
						<Value size='2xs' className='hil-key-count'>
							{summary.counts[z.id] ?? 0} cities
						</Value>
					</span>
				))}
			</div>

			<Body as='p' className='hil-note'>
				{busy ? 'Working out the whole earth…' : 'Geometry only.'} This map knows where the moon will be and how
				thin it will be. It knows nothing of cloud, haze or the horizon in front of you — a colour here means
				the sky permits a sighting, never that one was made.
			</Body>
		</div>
	);
}
