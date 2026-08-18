// The offer that comes before the browser's own.
//
// WHY THERE IS A CARD AT ALL
//
// The browser's permission dialog can only be spent once. A refusal is
// remembered by the origin, cannot be asked for again, and leaves the reader
// having to go into site settings to undo it — so a cold prompt does not risk
// one session, it risks the qibla finder for good.
//
// This card is the part we control. It can be shown, dismissed and offered
// again; nothing is spent by it. Only a reader who presses the first button
// ever reaches the real dialog, which means the one irreversible prompt is
// spent almost entirely on people who have already said yes — and it arrives
// with the reason still on screen behind it rather than as a bare demand.
//
// The cost is one press for someone who would have allowed it anyway. That is
// the trade.
//
// Not shown when a link already names a city, when a previous visit was located
// (there is a home to open on), or when permission has already been granted —
// in that last case there is nothing to ask and the app simply goes there.

import Modal from './Modal';
import { Title } from './Typography';

interface Props {
	/** Ask the browser. The real dialog opens from this press. */
	onLocate(): void;
	/** Dismiss without spending the prompt. */
	onDismiss(): void;
}

export default function LocationAsk({ onLocate, onDismiss }: Props) {
	return (
		<Modal label='Use your location?' onClose={onDismiss} className='ask'>
			<div className='ask-body'>
				<Title size='xl' as='h1' className='ask-head'>
					Prayer times where you are
				</Title>

				<p className='ask-copy'>
					The qibla finder needs to know where you are standing, and the panel opens on your own timetable
					rather than on an arbitrary city. Nothing leaves your device.
				</p>

				<div className='ask-row'>
					<button type='button' className='ask-go' onClick={onLocate}>
						Use my location
					</button>
					<button type='button' className='ask-alt' onClick={onDismiss}>
						Browse the globe
					</button>
				</div>

				<p className='ask-fine'>You can do this later from “My location” in the toolbar.</p>
			</div>
		</Modal>
	);
}
