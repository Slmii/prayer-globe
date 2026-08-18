// The qibla, in a modal: which way do I turn, right now.
//
// The design's `Qibla Finder 3D` — the world rotates under a fixed camera by
// your heading, and it locks green when the Kaaba is straight ahead. This shell
// owns the dialog and the one piece of state the finder must not lose when it
// re-renders: whether the permission gate has already been answered.

import { useState } from 'react';
import Modal from './Modal';
import QiblaFinder from './QiblaFinder';
import type { Source } from './QiblaFinder';

interface Props {
	/** Where the reader is — a selected city, or a located point. */
	lat: number;
	lon: number;
	/** Named for the plate, so the answer is attached to a place. */
	place: string;
	onClose(): void;
}

export default function QiblaViewer({ lat, lon, place, onClose }: Props) {
	const [source, setSource] = useState<Source>('gate');

	return (
		<Modal label={`The direction to the Kaaba from ${place}`} onClose={onClose} className='qv'>
			<QiblaFinder lat={lat} lon={lon} place={place} source={source} setSource={setSource} />
		</Modal>
	);
}
