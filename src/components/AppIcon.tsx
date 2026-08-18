// The app's one source of icons, backed by `@tabler/icons-react`.
//
// Before this, every icon was whatever the call site felt like: a '↗' in a
// button's textContent, a '▾' in JSX, a hand-drawn `<svg>` for sunrise, two
// nested spans with CSS for the sun. They shared no size, no stroke weight and
// no optical style, and a glyph in text content inherits the font's metrics —
// which is why the share arrow sat a pixel high in its button and the pin dot
// did not line up with its own label.
//
// Everything now comes from here, and every icon:
//   - takes `color="currentColor"`, so it inherits the colour of its context
//     rather than carrying one of its own,
//   - takes a named size, so there are three icon sizes in the app and not
//     eleven,
//   - pairs an outline with a filled variant, so an active state has somewhere
//     to go. Tabler ships no filled twin for some glyphs; where that is so the
//     outline fills both slots, decided once here rather than at each call.

import {
	IconArrowDownRight,
	IconArrowLeft,
	IconArrowRight,
	IconChevronDown,
	IconCurrentLocation,
	IconCurrentLocationFilled,
	IconDownload,
	IconMinus,
	IconMoon,
	IconMoonFilled,
	IconPin,
	IconPinFilled,
	IconPlus,
	IconShare,
	IconSun,
	IconSunFilled,
	IconSunrise,
	IconSunriseFilled,
	IconSunset,
	IconSunsetFilled,
	IconX,
	IconKeyboard,
	IconKeyboardFilled
} from '@tabler/icons-react';
import type { CSSProperties } from 'react';

export type AppIconName =
	| 'share'
	| 'chevron-down'
	| 'arrow-right'
	| 'arrow-down-right'
	| 'arrow-left'
	| 'pin'
	| 'sunrise'
	| 'sunset'
	| 'sun'
	| 'moon'
	| 'download'
	| 'plus'
	| 'minus'
	| 'x'
	| 'locate'
	| 'keyboard';

type TablerGlyph = typeof IconSun;

interface IconPair {
	outline: TablerGlyph;
	filled: TablerGlyph;
}

const ICONS: Record<AppIconName, IconPair> = {
	// Tabler ships no filled share / chevron / arrows / plus / minus / download —
	// the outline doubles as the filled slot.
	share: { outline: IconShare, filled: IconShare },
	'chevron-down': { outline: IconChevronDown, filled: IconChevronDown },
	'arrow-right': { outline: IconArrowRight, filled: IconArrowRight },
	'arrow-down-right': { outline: IconArrowDownRight, filled: IconArrowDownRight },
	'arrow-left': { outline: IconArrowLeft, filled: IconArrowLeft },
	pin: { outline: IconPin, filled: IconPinFilled },
	sunrise: { outline: IconSunrise, filled: IconSunriseFilled },
	sunset: { outline: IconSunset, filled: IconSunsetFilled },
	sun: { outline: IconSun, filled: IconSunFilled },
	moon: { outline: IconMoon, filled: IconMoonFilled },
	download: { outline: IconDownload, filled: IconDownload },
	plus: { outline: IconPlus, filled: IconPlus },
	minus: { outline: IconMinus, filled: IconMinus },
	x: { outline: IconX, filled: IconX },
	locate: { outline: IconCurrentLocation, filled: IconCurrentLocationFilled },
	keyboard: { outline: IconKeyboard, filled: IconKeyboardFilled }
};

/** Named icon sizes (no free pixel values) — keeps icon sizing consistent across the app. */
export type AppIconSize = 'small' | 'medium' | 'large';

const ICON_SIZE_PX: Record<AppIconSize, number> = {
	small: 14,
	medium: 18,
	large: 24
};

interface AppIconProps {
	name: AppIconName;
	size?: AppIconSize;
	strokeWidth?: number;
	/** Render the filled variant — use for active/selected state. */
	filled?: boolean;
	style?: CSSProperties;
	className?: string;
}

export function AppIcon({ name, size = 'medium', strokeWidth = 1.5, filled = false, style, className }: AppIconProps) {
	const pair = ICONS[name];
	const Glyph = filled ? pair.filled : pair.outline;
	return (
		<Glyph
			size={ICON_SIZE_PX[size]}
			stroke={strokeWidth}
			color='currentColor'
			style={style}
			className={className}
			aria-hidden='true'
		/>
	);
}
