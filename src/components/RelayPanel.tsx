// The relay board: the adhan handed across the earth, live.
//
// Built as a departures board, because that is the shape of the data rather
// than a costume put on it — a row at the top always about to go, a queue
// behind it that never empties, and the whole thing reshuffling as the earth
// turns. See `lib/relay.ts` for what a row is and why it is a wave of countries
// rather than a single city.
//
// Two readings, one board. Glance and you get the next call and how long you
// have. Watch for a minute and you get the thing no single-city app can show:
// the handover itself, one band of the earth to the next, without a gap.
//
// The countdowns run from the clock's exact instant while the board's
// composition is recomputed only when the minute changes — the pass over 891
// cities is far too expensive for every frame, and the numbers would look
// stepped if they waited for it.

import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { relayBoard, countdown, BOARD_MINS, LINGER_MINS } from '../lib/relay';
import type { Wave } from '../lib/relay';
import type { PhaseTable } from '../lib/phases';
import type { City } from '../lib/cities';
import { Label, Value, Arabic } from './Typography';

interface Props {
	phases: PhaseTable | null;
	/** The clock's instant, scrubbed — the board answers for wherever it is parked. */
	nowMs: number;
	onGoTo(city: City): void;
}

/**
 * The places in a wave, named until the room runs out.
 *
 * Named rather than counted because "Genoa, Salzburg, Gdańsk" is a picture of a
 * band of the earth and "3 countries" is not. The overflow is counted, since
 * past three the list stops being a picture and becomes a paragraph.
 */
function Places({ wave, max, onGoTo }: { wave: Wave; max: number; onGoTo(city: City): void }) {
	const shown = wave.places.slice(0, max);
	const rest = wave.places.length - shown.length;
	return (
		<span className='rly-places'>
			{shown.map((p, i) => (
				<span key={p.iso2}>
					{i > 0 && <span className='rly-sep'> · </span>}
					<button
						type='button'
						className='rly-place'
						onClick={e => {
							e.stopPropagation();
							onGoTo(p.city);
						}}
						data-tip={`Fly to ${p.city.n}, ${p.country}`}
					>
						{p.city.n}
					</button>
				</span>
			))}
			{rest > 0 && <span className='rly-more'> +{rest}</span>}
		</span>
	);
}

/** The wave at the front: the one about to break. */
function Lead({ w, nowMs, onGoTo }: { w: Wave; nowMs: number; onGoTo(city: City): void }) {
	const left = w.atMs - nowMs;
	const gone = left <= 0;
	return (
		<div className={'rly-lead' + (gone ? ' rly-lead-now' : '')} style={{ '--rly-c': w.color } as CSSProperties}>
			<div className='rly-lead-top'>
				<Label size='xs' className='rly-lead-kicker'>
					{gone ? 'Being called' : 'Next call'}
				</Label>
				<Label size='xs' className='rly-lead-n'>
					{w.places.length === 1 ? '1 country' : `${w.places.length} countries`}
				</Label>
			</div>

			{/*
				The prayer is the headline, not the countdown.
				
				It was a small chip in the corner while `now` filled the card, which
				answered when but never what — and what is the question the card
				exists for. The two now share a line at the same weight: which
				prayer, and how long.
			*/}
			<div className='rly-lead-body'>
				<span className='rly-lead-prayer'>
					{w.prayer}
					<Arabic size='md' className='rly-lead-ar'>
						{w.ar}
					</Arabic>
				</span>
				<span className='rly-lead-count'>{countdown(left)}</span>
			</div>

			<Places wave={w} max={4} onGoTo={onGoTo} />
		</div>
	);
}

/** One wave still waiting. */
function Row({ w, nowMs, i, onGoTo }: { w: Wave; nowMs: number; i: number; onGoTo(city: City): void }) {
	const left = w.atMs - nowMs;
	return (
		<div
			className={'rly-row' + (left <= 0 ? ' rly-row-now' : '')}
			style={{ '--rly-c': w.color, '--i': i } as CSSProperties}
		>
			{/* The baton: a dot on a thread, one per handover. */}
			<span className='rly-dot' aria-hidden='true' />
			<span className='rly-count'>{countdown(left)}</span>
			<span className='rly-prayer'>{w.prayer}</span>
			<Places wave={w} max={2} onGoTo={onGoTo} />
		</div>
	);
}

export default function RelayPanel({ phases, nowMs, onGoTo }: Props) {
	/*
	 * Recomputed on the minute, not on the frame.
	 *
	 * Which crossings exist can only change when the minute does — the table is
	 * minute-resolution — so the 891-city pass is keyed to that. Everything the
	 * eye sees moving is derived from `nowMs` further down, for free.
	 */
	const minuteKey = Math.floor(nowMs / 60000);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const board = useMemo(() => relayBoard(phases, nowMs), [phases, minuteKey]);

	// The linger is cut here rather than in the memo, so a wave leaves at the
	// second it is due to and not whenever the minute happens to turn.
	const live = board.filter(w => w.atMs > nowMs - LINGER_MINS * 60000);
	const [lead, ...rest] = live;

	if (!phases) {
		return <div className='rly rly-empty'>Loading the world's timetables…</div>;
	}

	const countries = live.reduce((n, w) => n + w.places.length, 0);

	return (
		<div className='rly'>
			<div className='rly-head'>
				<Label size='md' className='rly-title'>
					THE RELAY
				</Label>
				<Value size='2xs' className='rly-tally'>
					{countries} in {BOARD_MINS} min
				</Value>
			</div>

			{lead ? (
				<Lead w={lead} nowMs={nowMs} onGoTo={onGoTo} />
			) : (
				<div className='rly-gap'>Nothing crosses in the next {BOARD_MINS} minutes.</div>
			)}

			{rest.length > 0 && (
				<div className='rly-list'>
					{/* One thread through every dot, so the handovers read as a line
					    rather than as a stack of unrelated rows. */}
					<span className='rly-thread' aria-hidden='true' />
					{rest.map((w, i) => (
						<Row key={w.key} w={w} nowMs={nowMs} i={i} onGoTo={onGoTo} />
					))}
				</div>
			)}

			<p className='rly-note'>
				Each row is one instant: everywhere crossing into that prayer together, one city per country. From the
				published Diyanet times — tap a name to fly there.
			</p>
		</div>
	);
}
