// Every passing message the globe can show, in one shape.
//
// From the design's own spec: four kinds, one toast on screen at a time, a title
// in the reader's terms and an optional mono line under it carrying the
// coordinates, distances and keys. It auto-dismisses in 2.6s, drawn down by the
// hairline at its foot, and can be closed early.
//
// The rule the spec is strictest about is the failure pattern: every `warn`
// names the way out — pick a city, allow the permission, edit the URL — so a
// message that reports a dead end is never the whole message.

import { toast } from 'react-toastify';
import type { Id, ToastOptions } from 'react-toastify';

/**
 * ok — something is now true. link — something left the page. off — something
 * switched off. warn — blocked, with a way out.
 */
export type ToastKind = 'ok' | 'link' | 'off' | 'warn';

/**
 * How long a message stays, in milliseconds.
 *
 * The countdown hairline is a CSS animation and cannot read this, so
 * `--toast-life` in `styles.css` carries the same number — change both together
 * or the bar stops agreeing with the timer it is drawing.
 */
export const TOAST_MS = 5000;

/** One glyph each, so the kind is readable before the words are. */
const GLYPH: Record<ToastKind, string> = { ok: '★', link: '↗', off: '☆', warn: '!' };

export interface Note {
	kind: ToastKind;
	title: string;
	/** The mono line. Omitted entirely when there is nothing to add — an empty
	 *  one would leave a gap that reads as a message that failed to load. */
	detail?: string;
}

function Body({ note, closeToast }: { note: Note; closeToast?: () => void }) {
	return (
		<>
			<span className='pg-toast-rail' aria-hidden='true' />
			<span className='pg-toast-glyph' aria-hidden='true'>
				{GLYPH[note.kind]}
			</span>
			<span className='pg-toast-text'>
				<span className='pg-toast-title'>{note.title}</span>
				{note.detail && <span className='pg-toast-detail'>{note.detail}</span>}
			</span>
			<button type='button' className='pg-toast-x' aria-label='Dismiss' onClick={closeToast}>
				×
			</button>
			<span className='pg-toast-bar' aria-hidden='true' />
		</>
	);
}

/**
 * Raise one. Returns the id, so a message can be filled in once more is known.
 *
 * Whatever is on screen goes first. The spec asks for one message at a time, and
 * react-toastify's own `limit` does that by *queueing* — press share three times
 * and the second and third wait their turn, so you sit through fifteen seconds
 * of notes about something you did once. Dismissing makes the newest message the
 * one you see, which is what "replaces" meant.
 */
export function say(note: Note, opts?: ToastOptions): Id {
	toast.dismiss();
	return toast(({ closeToast }) => <Body note={note} closeToast={closeToast} />, {
		className: `pg-toast pg-toast-${note.kind}`,
		...opts
	});
}

/**
 * Replace what a toast says without raising a second one.
 *
 * Locating is the case this exists for: the coordinates are known at once but
 * whose timetable they fall under takes a round trip, and showing two toasts a
 * second apart for one button press reads as a stutter. `autoClose` is passed
 * again deliberately — the fuller message has just arrived and deserves its own
 * 2.6 seconds rather than the remainder of the first one's.
 */
export function amend(id: Id, note: Note, autoClose = TOAST_MS) {
	toast.update(id, {
		render: ({ closeToast }) => <Body note={note} closeToast={closeToast} />,
		className: `pg-toast pg-toast-${note.kind}`,
		autoClose
	});
}
