// The day's extremes across every city.
//
// These only exist because the app holds all of them at once: no single-city
// prayer app can tell you where today's longest fast is. They recompute as the
// clock scrubs, so the panel is also a way of watching the year turn — the
// longest fast migrates north through summer and back again.

import { dayRecords, WINDOW_MINS } from '../lib/records';
import type { Crossing } from '../lib/records';
import type { PhaseTable } from '../lib/phases';
import type { City } from '../lib/cities';

interface Props {
	phases: PhaseTable | null;
	nowMs: number;
	/** Gregorian date line for the day these records describe. */
	dateLine: string;
	onGoTo(city: City): void;
}

/**
 * Who else is about to cross, over the next ten minutes.
 *
 * The row above names the winner; this is the queue behind it. Two readings, one
 * object: the rule is ten minutes wide, so where the ticks fall *is* the answer —
 * bunched means a dozen borders go together, strung out means they go one by one
 * — and the codes underneath say exactly who and exactly when. Countries rather
 * than cities because a hundred Russian towns crossing within a minute of each
 * other is one fact, not a hundred.
 *
 * Positioned ticks, but a flowing list: labels pinned to the rule would collide
 * the moment two countries land seconds apart, which the data does routinely
 * (fourteen countries inside the window at its busiest).
 */
function Queue({ crossings, color, onGoTo }: { crossings: Crossing[]; color: string; onGoTo(city: City): void }) {
	return (
		<div className='q'>
			<div className='q-rule' aria-hidden='true'>
				{crossings.map(c => (
					<span
						key={c.iso2}
						className='q-tick'
						style={{ left: `${(c.mins / WINDOW_MINS) * 100}%`, background: color }}
					/>
				))}
			</div>
			<div className='q-list'>
				{/* `data-tip-start` grows the tooltip rightwards from the chip: the panel
				    clips its own overflow, so a centred one on the leftmost chip lost its
				    first words off the edge of the window. */}
				{crossings.map(c => (
					<button
						key={c.iso2}
						type='button'
						className='q-chip'
						onClick={() => onGoTo(c.city)}
						data-tip={`${c.country} — ${c.city.n} first, in ${c.mins}m`}
						data-tip-above=''
						data-tip-start=''
					>
						<span className='q-iso'>{c.iso2}</span>
						<span className='q-min' style={{ color }}>
							{c.mins}m
						</span>
					</button>
				))}
			</div>
		</div>
	);
}

export default function RecordsPanel({ phases, nowMs, dateLine, onGoTo }: Props) {
	const rows = phases ? dayRecords(phases, nowMs) : [];

	return (
		<div className='recs'>
			<div className='recs-head'>
				<span className='recs-title'>RECORDS FOR THIS DAY</span>
				<span className='recs-date'>{dateLine}</span>
			</div>

			<div className='recs-list'>
				{rows.length === 0 && <div className='recs-empty'>Loading the world's timetables…</div>}
				{rows.map(r => (
					<div key={r.key} className={'recs-item' + (r.window?.length ? ' recs-item-queue' : '')}>
						<button
							type='button'
							className='recs-row'
							onClick={() => onGoTo(r.city)}
							data-tip={`Fly to ${r.city.n}`}
						>
							<span className='recs-label'>{r.label}</span>
							<span className='recs-value' style={{ color: r.color }}>
								{r.value}
							</span>
							<span className='recs-city'>{r.city.n}</span>
						</button>
						{!!r.window?.length && <Queue crossings={r.window} color={r.color} onGoTo={onGoTo} />}
					</div>
				))}
			</div>

			<p className='recs-note'>
				Across every city with published times, recomputed as you scrub. Tap a record to fly there.
			</p>
		</div>
	);
}
