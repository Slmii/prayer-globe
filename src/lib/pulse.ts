// Showing which button a key just pressed.
//
// A shortcut fires something the reader cannot see happening — Space starts a
// run, S turns the spin on — and without feedback the key feels like it may not
// have registered. So the control the key stands for ripples, exactly as if it
// had been clicked, and the shortcut stops being invisible.
//
// This reaches for the DOM rather than threading state through React, and that
// is deliberate: the buttons live in three different places, one of which
// (MapLibre's control stack) is built imperatively and has no React tree to
// thread anything through. A data attribute is the one thing all three share.
//
// It marks the element with an attribute rather than a class, and that detail is
// load-bearing. Every one of these keys changes state, so React re-renders the
// button immediately afterwards and rewrites the `className` it owns — which
// silently swept the ripple class off again a frame after it was added. React
// diffs against its own previous props and leaves attributes it never set alone,
// so `data-pulse` survives the re-render that a class did not.
//
// Purely decorative. Nothing depends on the element existing.

/** Marks a control as the visible face of a shortcut. */
export const HOTKEY_ATTR = 'data-hotkey';

export function pulse(name: string) {
	const el = document.querySelector(`[${HOTKEY_ATTR}="${name}"]`);
	if (!(el instanceof HTMLElement)) {
		return;
	}

	// Restarting a running animation needs the attribute gone, a reflow read to
	// commit the removal, and then it back — without the read the browser
	// coalesces both changes and nothing replays. This is what makes a held key
	// ripple on every repeat rather than once.
	el.removeAttribute('data-pulse');
	void el.offsetWidth;
	el.setAttribute('data-pulse', '');

	el.addEventListener('animationend', () => el.removeAttribute('data-pulse'), { once: true });
}
