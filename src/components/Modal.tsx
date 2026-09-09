// A dialog over the globe.
//
// Extracted from the mosque viewer when a second one was needed, because the
// parts worth getting right are the parts nobody thinks about twice: the press
// that closes it must have *started* on the backdrop, Escape must work, and
// focus has to be parked somewhere sensible and handed back afterwards.
//
// Everything else — what the dialog contains, how wide it is, how it lays out
// inside — belongs to the caller. This owns the frame and the behaviour, and
// nothing else.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppIcon } from './AppIcon';

/**
 * How long the closing animation is given before the dialog is really gone.
 *
 * Kept in step with `mv-sink` in the stylesheet. A timer rather than an
 * `animationend` listener because the animation is switched off entirely under
 * `prefers-reduced-motion`, and an event that never fires would leave the modal
 * on screen for good.
 */
const CLOSE_MS = 160;

interface Props {
	/** Names the dialog for assistive tech. Not shown. */
	label: string;
	onClose(): void;
	children: ReactNode;
	/** Extra class on the panel, for its own size and inner layout. */
	className?: string;
}

export default function Modal({ label, onClose, children, className }: Props) {
	const closeRef = useRef<HTMLButtonElement>(null);

	/*
	 * Closing is a state, not an event.
	 *
	 * The panel rises on the way in, and used to vanish on the way out, because
	 * calling `onClose` unmounts it on the same frame and there is nothing left
	 * to animate. So every route out — Escape, the backdrop, the button — only
	 * marks the dialog as closing; the caller is told once the animation has had
	 * its time.
	 */
	const [closing, setClosing] = useState(false);
	const beginClose = useCallback(() => setClosing(true), []);

	useEffect(() => {
		if (!closing) {
			return;
		}
		const id = window.setTimeout(onClose, CLOSE_MS);
		return () => window.clearTimeout(id);
	}, [closing, onClose]);

	/*
	 * Escape closes, and focus is borrowed rather than taken.
	 *
	 * Whatever opened this may well be gone by the time it closes — a card on a
	 * marker, a row that has since re-rendered — so focus is parked on the close
	 * button while the dialog is up and handed back to whatever held it before,
	 * which leaves the keyboard somewhere sensible either way.
	 */
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		closeRef.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				beginClose();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			previous?.focus?.();
		};
	}, [beginClose]);

	return (
		// The backdrop closes on a press, but only on one that started on it — a
		// press that began inside the panel and drifted out is a drag that
		// overshot, not a decision to leave.
		<div
			className={'modal-back' + (closing ? ' modal-back-closing' : '')}
			onPointerDown={e => e.target === e.currentTarget && beginClose()}
		>
			<div className={'modal' + (className ? ' ' + className : '')} role='dialog' aria-modal='true' aria-label={label}>
				{children}
				<button type='button' className='modal-close' ref={closeRef} onClick={beginClose} aria-label='Close'>
					<AppIcon name='x' size='small' />
				</button>
			</div>
		</div>
	);
}
