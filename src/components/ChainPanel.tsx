// "Follow one prayer around the earth. It never stops — it only moves."
//
// The globe already knows which prayer every city is in; this is the mode that
// makes the consequence visible. Pick a prayer, and the panel stops being about
// one city and becomes about the band itself — how many places are standing in
// it, which one just entered, which is about to leave, and how far round the
// circuit the leading edge has come.

import { PHASES } from '../lib/astro';
import { chainState } from '../lib/chain';
import type { PhaseTable } from '../lib/phases';
import type { City } from '../lib/cities';
import { AppIcon } from './AppIcon';
import { Arabic, Display, Label, Title } from './Typography';

/**
 * The prayers worth following, as PHASES indices.
 *
 * Duha (1) is left out on purpose. It is the long stretch between sunrise and
 * dhuhr rather than a prayer with a call, so a band of it would cover a third of
 * the earth and never read as a moving edge.
 */
const FOLLOWABLE = [0, 2, 3, 4, 5];

interface Props {
	phases: PhaseTable | null;
	nowMs: number;
	/** Which prayer is being followed, a PHASES index. */
	chain: number;
	onChain(phase: number): void;
	onGoTo(city: City): void;
	/** The one-day sweep is running. */
	sweeping: boolean;
	onSweep(): void;
}

/** "in 6m" / "3m ago" — the edges are always within minutes of now. */
function relative(ms: number, nowMs: number): string {
	const mins = Math.round((ms - nowMs) / 60000);
	if (mins === 0) {
		return 'now';
	}
	const abs = Math.abs(mins);
	const text = abs >= 60 ? `${Math.floor(abs / 60)}h ${abs % 60}m` : `${abs}m`;
	return mins > 0 ? `in ${text}` : `${text} ago`;
}

export default function ChainPanel({ phases, nowMs, chain, onChain, onGoTo, sweeping, onSweep }: Props) {
	const state = phases ? chainState(phases, chain, nowMs) : null;
	const phase = PHASES[chain];

	return (
		<div className='chain'>
			<p className='chain-lede'>Follow one prayer around the earth. It never stops — it only moves.</p>

			<div className='chain-chips'>
				{FOLLOWABLE.map(p => (
					<button
						key={p}
						type='button'
						className={'chain-chip' + (p === chain ? ' chain-chip-on' : '')}
						aria-pressed={p === chain}
						onClick={() => onChain(p)}
					>
						<span className='chain-chip-dot' style={{ background: PHASES[p].c }} />
						{PHASES[p].tr}
					</button>
				))}
			</div>

			<div className='chain-head'>
				<div className='chain-head-l'>
					<Label as='div' size='sm' className='chain-label'>
						STANDING IN
					</Label>
					<div className='chain-name-row'>
						<Display size='md' className='chain-name'>
							{phase.tr}
						</Display>
						<Arabic size='lg' className='chain-ar'>
							{phase.ar}
						</Arabic>
					</div>
				</div>
				<div className='chain-head-r'>
					<div className='chain-count'>{state ? state.count : '—'}</div>
					<div className='chain-of'>of {state ? state.total : '—'} cities</div>
				</div>
			</div>

			<div className='chain-edges'>
				{state?.edges.map(e => (
					<button
						key={e.kind}
						type='button'
						className='chain-edge'
						onClick={() => onGoTo(e.city)}
						data-tip={`Fly to ${e.city.n}`}
					>
						<span className='chain-edge-glyph' style={{ color: phase.c }}>
							<AppIcon name={e.kind === 'entering' ? 'arrow-right' : 'arrow-down-right'} />
						</span>
						<span className='chain-edge-mid'>
							<span className='chain-edge-kind'>
								{e.kind === 'entering' ? 'JUST ENTERED' : 'NEXT TO LEAVE'}
							</span>
							<Title size='md' className='chain-edge-city'>
								{e.city.n}
							</Title>
						</span>
						<span className='chain-edge-when' style={{ color: phase.c }}>
							{relative(e.ms, nowMs)}
						</span>
					</button>
				))}
			</div>

			<div className='chain-foot'>
				<div className='chain-foot-head'>
					<span>CIRCUIT</span>
					<span className='chain-foot-controls'>
						<button
							type='button'
							className={'sweep-btn' + (sweeping ? ' sweep-btn-on' : '')}
							aria-pressed={sweeping}
							data-tip='Run a full 24 hours in about 40 seconds'
							data-tip-above=''
							onClick={onSweep}
						>
							<span className='sweep-dot' />
							{sweeping ? 'Stop' : 'Sweep'}
						</button>
					</span>
					<span>{state ? `${Math.round(state.pct * 100)}%` : '—'}</span>
				</div>
				<div className='chain-bar'>
					<div className='chain-bar-fill' style={{ width: `${(state?.pct ?? 0) * 100}%` }} />
				</div>

				{/* The speed control moved to the time bar. It paces the clock, and the
				    clock has one home that is on screen in every mode — keeping it here
				    put it two clicks away from itself whenever you left this panel. */}
				{/*
          The empty state has to be careful. This panel is built on the claim
          that a prayer never stops, and the count really does reach zero — the
          band is narrow, and a few times a day it crosses the Pacific, where
          this dataset has no cities at all. That is a gap in our sample of 889
          places, not a gap in the world, and saying so is more honest than
          either hiding the zero or letting it look like prayer paused.
        */}
				<p className='chain-note'>
					{!state
						? 'Loading the world’s timetables…'
						: state.count > 0
							? `${phase.tr} is being prayed in ${state.count} of these cities right now, and has not stopped all day.`
							: `No city in this set is at ${phase.tr} this minute — the band is out over the Pacific, where we hold no cities. Scrub on and it comes ashore.`}
				</p>
			</div>
		</div>
	);
}
