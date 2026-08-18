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

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { AppIcon } from './AppIcon';

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
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			previous?.focus?.();
		};
	}, [onClose]);

	return (
		// The backdrop closes on a press, but only on one that started on it — a
		// press that began inside the panel and drifted out is a drag that
		// overshot, not a decision to leave.
		<div className='modal-back' onPointerDown={e => e.target === e.currentTarget && onClose()}>
			<div className={'modal' + (className ? ' ' + className : '')} role='dialog' aria-modal='true' aria-label={label}>
				{children}
				<button type='button' className='modal-close' ref={closeRef} onClick={onClose} aria-label='Close'>
					<AppIcon name='x' size='small' />
				</button>
			</div>
		</div>
	);
}
