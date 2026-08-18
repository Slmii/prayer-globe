// Every tooltip in the app, rendered once at the top of the document.
//
// `data-tip` stays exactly as it was — thirty-odd call sites keep their
// attribute and nothing else changes — but the bubble is no longer a
// pseudo-element on the trigger. It is one node in a portal on `document.body`,
// positioned on hover.
//
// The pseudo-element was cheap and it worked until the app grew boxes:
//
//   - it was clipped by any scrolling ancestor. The side panel sets
//     `overflow-x: clip`, so a tip on the leftmost chip in a row lost its first
//     words off the edge of the window, and no amount of `data-tip-start` could
//     fix the ones that wanted to open leftwards.
//   - it was painted by its ancestor's stacking order, not its own. A control
//     lower in the map's stack covered the tip of the one above it, which took a
//     `z-index` rule per case to unpick.
//   - it took part in layout. Even at zero opacity an absolutely positioned
//     `::after` counts toward an ancestor's `scrollWidth`, which is what gave
//     the panel a horizontal scrollbar for nine invisible labels — worked around
//     by giving the idle tip no box at all.
//
// A portal removes all three at once: nothing above it can clip it, nothing can
// paint over it, and it contributes to no layout but its own. It also lets the
// bubble decide where to go, so it flips off the viewport edges by measurement
// rather than by an author remembering to add `data-tip-start`.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** Gap between the trigger and the bubble. */
const GAP = 7;
/** Closest the bubble may come to the window's edge. */
const EDGE = 8;

interface Tip {
	text: string;
	/** Viewport coordinates, already flipped and clamped. */
	x: number;
	y: number;
	/** Which side of the trigger it ended up on, for the reveal direction. */
	above: boolean;
}

export default function TipLayer() {
	const [tip, setTip] = useState<Tip | null>(null);

	useEffect(() => {
		let node: HTMLElement | null = null;

		/** Measure and place, once the bubble has been laid out. */
		const place = (el: HTMLElement, text: string) => {
			const r = el.getBoundingClientRect();
			// Measured off-screen first: the bubble's size depends on its text, and
			// its text is only known now.
			const probe = document.createElement('div');
			probe.className = 'tip tip-probe';
			probe.textContent = text;
			document.body.append(probe);
			const w = probe.offsetWidth;
			const h = probe.offsetHeight;
			probe.remove();

			// Below unless there is no room, then above. The author's own
			// `data-tip-above` is a preference, not a rule — it loses to the edge.
			const wantsAbove = el.hasAttribute('data-tip-above');
			const roomBelow = window.innerHeight - r.bottom - GAP - EDGE >= h;
			const roomAbove = r.top - GAP - EDGE >= h;
			const above = wantsAbove ? roomAbove || !roomBelow : !roomBelow && roomAbove;

			const x = Math.min(Math.max(r.left + r.width / 2 - w / 2, EDGE), window.innerWidth - w - EDGE);
			const y = above ? r.top - GAP - h : r.bottom + GAP;
			setTip({ text, x, y, above });
		};

		const show = (e: Event) => {
			const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
			if (!el || el === node) return;
			const text = el.dataset.tip;
			if (!text) return;
			node = el;
			place(el, text);
		};

		const hide = (e: Event) => {
			const to = (e as MouseEvent).relatedTarget as HTMLElement | null;
			if (node && to?.closest?.('[data-tip]') === node) return;
			node = null;
			setTip(null);
		};

		// Delegated, so nothing has to register itself and controls that come and
		// go — map controls, chips, records rows — are covered the moment they
		// exist. `focusin` carries the keyboard, which `title` never did.
		document.addEventListener('pointerover', show);
		document.addEventListener('pointerout', hide);
		document.addEventListener('focusin', show);
		document.addEventListener('focusout', hide);
		// A tip pinned to a screen position is wrong the instant anything moves.
		const drop = () => {
			node = null;
			setTip(null);
		};
		window.addEventListener('scroll', drop, true);
		window.addEventListener('resize', drop);
		window.addEventListener('pointerdown', drop);

		return () => {
			document.removeEventListener('pointerover', show);
			document.removeEventListener('pointerout', hide);
			document.removeEventListener('focusin', show);
			document.removeEventListener('focusout', hide);
			window.removeEventListener('scroll', drop, true);
			window.removeEventListener('resize', drop);
			window.removeEventListener('pointerdown', drop);
		};
	}, []);

	if (!tip) {
		return null;
	}
	return createPortal(
		<div
			className={'tip tip-on' + (tip.above ? ' tip-above' : '')}
			style={{ left: tip.x, top: tip.y }}
			role='tooltip'
		>
			{tip.text}
		</div>,
		document.body
	);
}
