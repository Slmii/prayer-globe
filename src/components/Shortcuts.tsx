// The keyboard shortcuts, written down.
//
// Every one of these is a shortcut over a control that is already on screen —
// nothing here is the only way to reach anything — so this sheet is a reminder
// rather than documentation, and it is grouped the way the controls are: the
// clock first, then the strip.
//
// The keys themselves live in `useTransportKeys`. This list is written out by
// hand rather than derived from the bindings: a generated table would name the
// key without saying what it is for, and the second column is the whole point.

import Modal from './Modal';
import { Label, Title } from './Typography';

/** True on a Mac, where the modifier is ⌘ rather than Ctrl. */
const MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent) && !/iphone|ipad|ipod/i.test(navigator.userAgent);

interface Row {
	keys: string[];
	what: string;
}

const GROUPS: { title: string; rows: Row[] }[] = [
	{
		title: 'The clock',
		rows: [
			{ keys: ['Space'], what: 'Run the clock, or stop it' },
			{ keys: ['←', '→'], what: 'Step back or forward an hour' },
			{ keys: ['Shift', '←', '→'], what: 'Step a whole day' },
			{ keys: ['N'], what: 'Back to now' },
			{ keys: ['[', ']'], what: 'Slower, faster' },
			{ keys: ['1', '–', '5'], what: 'How far a run goes' }
		]
	},
	{
		title: 'The earth',
		rows: [
			{ keys: ['S'], what: 'Spin' },
			{ keys: [MAC ? '⌘' : 'Ctrl', 'K'], what: 'This list' },
			{ keys: ['Esc'], what: 'Close whatever is open' }
		]
	}
];

export default function Shortcuts({ onClose }: { onClose(): void }) {
	return (
		<Modal label='Keyboard shortcuts' onClose={onClose} className='sc'>
			<div className='sc-body'>
				<Title size='lg' as='h1' className='sc-head'>
					Keyboard shortcuts
				</Title>

				{GROUPS.map(g => (
					<section key={g.title} className='sc-group'>
						<Label size='sm' as='h2'>
							{g.title}
						</Label>
						<dl className='sc-list'>
							{g.rows.map(r => (
								<div key={r.what} className='sc-row'>
									<dt>
										{r.keys.map((k, i) =>
											// The dash between 1 and 5 is a range, not a key.
											k === '–' ? (
												<span key={i} className='sc-range'>
													–
												</span>
											) : (
												<kbd key={i}>{k}</kbd>
											)
										)}
									</dt>
									<dd>{r.what}</dd>
								</div>
							))}
						</dl>
					</section>
				))}

				<p className='sc-note'>
					Every one of these presses a button that is already on screen. Keys are ignored while you are typing,
					and while a window like this one is open.
				</p>
			</div>
		</Modal>
	);
}
