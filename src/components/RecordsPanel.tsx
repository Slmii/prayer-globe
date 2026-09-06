// The day's extremes across every city.
//
// These only exist because the app holds all of them at once: no single-city
// prayer app can tell you where today's longest fast is. They recompute as the
// clock scrubs, so the panel is also a way of watching the year turn — the
// longest fast migrates north through summer and back again.

import { useMemo } from 'react';
import { dayRecords, WINDOW_MINS } from '../lib/records';
import type { Crossing } from '../lib/records';
import { rulesBreak } from '../lib/unresolved';
import type { PhaseTable } from '../lib/phases';
import type { City } from '../lib/cities';
import { Label } from './Typography';

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
	/*
	 * Keyed to the day rather than the instant: which cities the sun fails can
	 * only change when the date does, and the pass reads a timezone offset per
	 * city, which is the one expensive thing here.
	 */
	const dayKey = Math.floor(nowMs / 86400000);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const edge = useMemo(() => rulesBreak(phases, nowMs), [phases, dayKey]);
	// The longest-held of them, which is the one worth naming in the explanation.
	const held = edge.rows.filter(r => r.held).sort((a, b) => b.heldDays - a.heldDays)[0];

	return (
		<div className='recs'>
			<div className='recs-head'>
				<Label size='md' className='recs-title'>
					RECORDS FOR THIS DAY
				</Label>
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
							<Label size='sm' className='recs-label'>
								{r.label}
							</Label>
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

			{/*
				The other kind of extreme: not the largest value but the absent one.
				Only rendered when it is happening, so the panel does not carry an
				empty box through the winter.
			*/}
			{!!edge.total && (
				<section className='edge'>
					<div className='edge-head'>
						<Label size='md' className='edge-title'>
							WHERE THE RULES BREAK
						</Label>
						<span className='edge-count'>{edge.total} cities</span>
					</div>

					<p className='edge-note'>
						Every prayer time is set by the sun reaching a certain angle — 18° below the horizon for Fajr,
						the horizon itself for sunrise and sunset. This far north it sometimes never gets there: in
						summer it stays too high for Fajr and Isha, and in deep winter it never comes up at all, so
						sunrise and sunset are the ones with no answer. A timetable cannot print a blank, so these are
						the times Diyanet gives instead.
					</p>

					{/*
						The column heading exists because the numbers were being read as a
						denial of the line beneath them — "no Fajr" directly beside a Fajr
						time. Saying "published" once, above the column, is what makes the
						two readable together: the sun has no answer, and this is what was
						printed anyway.
					*/}

					<ul className='edge-list'>
						{edge.rows.map(r => (
							<li key={r.city.ilceID}>
								<button type='button' onClick={() => onGoTo(r.city)} data-tip={`Fly to ${r.city.n}`}>
									<span className='edge-city'>{r.city.n}</span>
									<span className='edge-lat'>
										{Math.abs(r.city.la).toFixed(1)}°{r.city.la < 0 ? 'S' : 'N'}
									</span>
									<span className='edge-times'>
										{r.fajr} · {r.isha}
									</span>
								</button>
								<span className='edge-why'>
									{r.why}
									{r.held && ' · timetable held'}
								</span>
							</li>
						))}
					</ul>

					{edge.total > edge.rows.length && (
						<p className='edge-note'>and {edge.total - edge.rows.length} more, further south.</p>
					)}

					{/*
						The strongest evidence in the whole panel that a rule has run out —
						and a fact about the data rather than a claim about it.

						Said with the city and the number rather than in the abstract:
						"the times have stopped moving" is something to take on trust,
						while "the same 02:34 for sixteen days" is something the reader can
						check against any other row in the list.
					*/}
					{held && (
						<p className='edge-note edge-note-lit'>
							<b>Held</b> means those times have stopped being worked out. {held.city.n} has had the same{' '}
							{held.fajr} and {held.isha} for {held.heldDays} days running, while its{' '}
							{held.moving.join(' and ')} keep moving by a minute or two daily like everywhere else. The
							sun can still settle {held.moving.length > 1 ? 'those' : 'that one'} up here — so Diyanet
							freezes only what it cannot work out, and goes on computing the rest.
						</p>
					)}
				</section>
			)}
		</div>
	);
}
