// Driving the clock from the keyboard.
//
// The strip and the time bar already carry every transport control; this binds
// the same actions to keys, so a run can be started, paced and stepped without
// going to find the button. Nothing here is reachable only by keyboard — it is
// a shortcut over existing controls, and each one names its key in its tooltip.
//
//   Space          play / stop
//   ← →            step an hour (gliding), or a day with Shift (at once)
//   N              back to now
//   [ ]            slower / faster
//   1 … 5          how far a run goes
//   S              spin
//   ⌘K / Ctrl+K    this list
//
// WHAT IT REFUSES TO DO
//
// A bare-letter shortcut on the window is a rude thing to install, so this one
// steps back wherever a key could plausibly mean something else:
//
//   * anything typed into a field, or into contenteditable — `react-hotkeys-hook`
//     declines form tags by default, which is most of the reason to use it
//   * any chord carrying Meta, Control or Alt — those belong to the browser, and
//     strict modifier matching means `left` alone will not answer for `⌘←`
//   * Space while a button or link has focus, because Space is how you press it
//   * everything, while a modal is open — the qibla finder binds the arrows to
//     turning the compass, and the clock must not also move underneath it
//
// The last is why `enabled` is a parameter rather than something worked out
// here: only the caller knows what is open.
//
// Keys are matched on the physical key rather than the produced character
// (the library's default), so the bracket pair stays where the fingers expect
// it and a digit row keeps its numbers whatever the layout.

import { useHotkeys } from 'react-hotkeys-hook';
import type { Options } from 'react-hotkeys-hook';

export interface Transport {
	/** False while a modal owns the keyboard. */
	enabled: boolean;
	/** Space. */
	playToggle(): void;
	/**
	 * ← → by an hour, shifted by a day.
	 *
	 * `glide` is false for the day steps. An hour is a short enough hop that
	 * easing it reads as the clock moving; a day is far enough that the same
	 * easing just makes you wait, so those land at once.
	 */
	step(minutes: number, glide: boolean): void;
	/** N, or Home. */
	now(): void;
	/** [ slower, ] faster. */
	speed(dir: -1 | 1): void;
	/** 1…5, the span buttons in order. */
	span(index: number): void;
	/** S. */
	spin(): void;
	/** ⌘K, or Ctrl+K. Opens the sheet listing all of this. */
	shortcuts(): void;
}

/** In span order, matching the strip's own buttons. */
const SPAN_KEYS = ['1', '2', '3', '4', '5'] as const;

export function useTransportKeys(t: Transport) {
	const opts: Options = { enabled: t.enabled, preventDefault: true };

	useHotkeys(
		'space',
		t.playToggle,
		{
			...opts,
			// Let the focused control have it — Space is how a button is pressed,
			// and stealing it would break the strip for keyboard users.
			ignoreEventWhen: () => {
				const el = document.activeElement;
				return !!el && /^(BUTTON|A|SUMMARY)$/.test(el.tagName);
			}
		},
		[t.playToggle, t.enabled]
	);

	useHotkeys('left', () => t.step(-60, true), opts, [t.step, t.enabled]);
	useHotkeys('right', () => t.step(60, true), opts, [t.step, t.enabled]);
	useHotkeys('shift+left', () => t.step(-1440, false), opts, [t.step, t.enabled]);
	useHotkeys('shift+right', () => t.step(1440, false), opts, [t.step, t.enabled]);

	useHotkeys(['n', 'home'], t.now, opts, [t.now, t.enabled]);

	useHotkeys('bracketleft', () => t.speed(-1), opts, [t.speed, t.enabled]);
	useHotkeys('bracketright', () => t.speed(1), opts, [t.speed, t.enabled]);

	useHotkeys('s', t.spin, opts, [t.spin, t.enabled]);

	/*
	 * The one chord here, and the one binding that stays live while a modal is
	 * open — it is how the sheet is reached from anywhere, and a modifier cannot
	 * be mistaken for typing.
	 */
	useHotkeys('mod+k', t.shortcuts, { preventDefault: true, enableOnFormTags: true }, [t.shortcuts]);

	// One binding for the row rather than five, so the digits cannot drift out of
	// step with the spans they stand for.
	useHotkeys(
		SPAN_KEYS,
		(_e, hk) => {
			const i = SPAN_KEYS.indexOf((hk.keys?.[0] ?? '') as (typeof SPAN_KEYS)[number]);
			if (i >= 0) t.span(i);
		},
		opts,
		[t.span, t.enabled]
	);
}
