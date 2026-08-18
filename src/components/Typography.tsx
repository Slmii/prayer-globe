// The typographic roles, as components.
//
// The stylesheet now names every size, weight and leading (see
// `styles/_tokens.scss`), which fixed the "what size is a label?" problem for
// anyone editing CSS. This fixes the other half: a component that needs a
// caption should not have to know that a caption is 10.5px Inter at leading
// 1.5 — it should ask for a caption.
//
// WHY THESE ROLES AND NOT OTHERS
//
// They are the ones the app already had, found by inventory rather than
// invented. Reading every text-bearing element in all five panel modes turned
// up six jobs that text does here:
//
//   Label    a mono caption over a value — read once, then skipped
//   Value    a mono numeral — a quantity, never tracked, never uppercase
//   Title    a name, in interface text at medium weight
//   Display  the one big thing on a panel
//   Body     the only text that runs past one line, and so the only text with
//            real leading
//   Caption  interface text, single line, quieter than a title
//   Arabic   the prayer names, which have their own face
//
// Each renders a `span` by default and takes `as` for anything else, so a Title
// can be an `h1` where that is what it means without changing how it looks —
// the tag is about the document, the component is about the type.

import type { CSSProperties, ElementType, ReactNode } from 'react';

/**
 * Seven steps, because the app genuinely uses that many.
 *
 * Five was one fiction too few: `caption` alone appears at 10, 10.5, 11, 11.5
 * and 12px, and squeezing those into three slots meant every adoption had to
 * either move a pixel or fall back to hand-written CSS — which is the thing
 * this exists to stop.
 */
type Size = '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/**
 * The colours text is allowed to be, by name.
 *
 * Named rather than open so the palette stays a palette: the stylesheet had
 * fourteen different opacities of the same ink, all hand-picked, none of them
 * meaning anything different from its neighbour. Three muted steps cover every
 * one of them.
 *
 * Any CSS colour still passes through untouched — a zone colour computed at
 * runtime has nowhere else to go — but the named ones are what the app should
 * reach for.
 */
const COLOURS = {
	/** The default. Set on `body`, so passing it is usually redundant. */
	ink: 'var(--ink)',
	/** The brightest text: a city name, a headline value. */
	bright: 'var(--ink-bright)',
	/** Secondary text that is still meant to be read. */
	muted: 'var(--ink-muted)',
	/** Labels and captions — present, not competing. */
	faint: 'var(--ink-faint)',
	/** Barely there: a hint, a watermark, the signature. */
	ghost: 'var(--ink-ghost)',
	accent: 'var(--accent)',
	'accent-soft': 'var(--accent-soft)',
	'accent-mid': 'var(--accent-mid)',
	'accent-deep': 'var(--accent-deep)',
	dim: 'var(--dim)'
} as const;

export type TypographyColour = keyof typeof COLOURS;

/**
 * The two weights this app uses. There is no third — 300 or 700 would be a new
 * decision, not a tweak, and it should be made in the tokens rather than at a
 * call site.
 */
type Weight = 400 | 500;

interface Props {
	children: ReactNode;
	/** The element to render. `span` unless the meaning calls for something else. */
	as?: ElementType;
	size?: Size;
	/** A name from the palette, or any CSS colour for a value computed at runtime. */
	color?: TypographyColour | (string & {});
	/** Override the role's weight. Prefer picking a different role. */
	fontWeight?: Weight;
	/**
	 * Extra classes.
	 *
	 * Note the order of battle: this can override the role's own CSS, because
	 * both are classes and this one comes later — but it cannot override `color`
	 * or `fontWeight`, which are inline and always win. Reach for `className`
	 * for layout and colour-by-class; reach for the props for one-off values.
	 */
	className?: string;
	style?: CSSProperties;
	title?: string;
}

/**
 * Build one role.
 *
 * The class is `t-<role>` plus `t-<role>-<size>`, both defined in
 * `styles.scss`, so the CSS stays the single source of the numbers and this
 * file stays a vocabulary rather than a second copy of the scale.
 */
function role(name: string, fallback: Size) {
	return function Typography({
		children,
		as: As = 'span',
		size = fallback,
		color,
		fontWeight,
		className,
		style,
		...rest
	}: Props) {
		// The caller's class comes first so the element still reads as what it is
		// in devtools — `hil-best-city t t-title …` rather than the other way
		// round. Order in the attribute has no bearing on which rule wins; that
		// is decided by order in the stylesheet, where the `t-` rules come last.
		const cls = [className, 't', `t-${name}`, `t-${name}-${size}`].filter(Boolean).join(' ');
		// A named colour resolves to its variable; anything else is passed as
		// given. `style` is applied last so it remains the final escape hatch.
		const resolved = color ? (COLOURS as Record<string, string>)[color] ?? color : undefined;
		const inline: CSSProperties | undefined =
			resolved || fontWeight || style ? { color: resolved, fontWeight, ...style } : undefined;
		return (
			<As className={cls} style={inline} {...rest}>
				{children}
			</As>
		);
	};
}

/** A mono caption over a value. Tracked wide, quiet, read once. */
export const Label = role('label', 'md');

/** A mono numeral. Never tracked — tracking a number hurts reading it. */
export const Value = role('value', 'md');

/** A name, in interface text at medium weight. */
export const Title = role('title', 'md');

/** The one big thing on a panel. */
export const Display = role('display', 'md');

/** The only text here that wraps, and so the only text with real leading. */
export const Body = role('body', 'md');

/** Interface text, single line, quieter than a title. */
export const Caption = role('caption', 'md');

/** Interface text set as a small uppercase control. */
export const Chip = role('chip', 'md');

/** A prayer name in Arabic. */
export const Arabic = role('arabic', 'md');
