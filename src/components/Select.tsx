// A select that can carry a colour and a number, not just a word.
//
// The native control cannot show what these menus need to show: a prayer is a
// name, the swatch the globe paints it in, and the angle that defines it —
// "Fajr · −18°" in the accent it is drawn with. An <option> is text and nothing
// else, so the list is rebuilt from buttons and the accessibility that came for
// free has to be put back by hand.
//
// Ported from the design project's Select.dc.html. That file is a template over
// a small runtime; what survives here is its structure, its palette and its
// keyboard, expressed the way the rest of this app is written — classes in the
// stylesheet rather than inline style, and the colours taken from the tokens
// they were already matching.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Label } from './Typography';

export interface SelectOption {
	value: string;
	label: string;
	/** A number or unit shown dimmed on the right — an angle, a count, a time. */
	meta?: string;
	/** Swatch colour. Omitted leaves the space, so labels still line up. */
	dot?: string;
}

interface Props {
	options: SelectOption[];
	/** Controlled value. Leave undefined to let the component hold its own. */
	value?: string;
	/** Starting value when uncontrolled. */
	defaultValue?: string;
	onChange?(value: string): void;
	/** Small caps heading above the control. Omitted renders no heading. */
	label?: string;
	/** Shown until something is chosen. */
	placeholder?: string;
	/** Any CSS width. The menu always matches the button. */
	width?: string;
}

/**
 * Where the highlight lands when an arrow key moves it, wrapping at both ends.
 *
 * Exported because it is the one piece of this worth testing directly: the
 * component's own behaviour needs a DOM, and the wrap is where the mistakes
 * live. `from` is -1 when nothing is highlighted or selected yet — and the
 * design walked *backwards* from -1 to the second-to-last item, skipping the
 * last one entirely. Opening upwards should land on the end of the list, so
 * that case is corrected here rather than reproduced.
 */
export function nextIndex(from: number, delta: number, count: number): number {
	if (count <= 0) {
		return -1;
	}
	if (from < 0) {
		return delta > 0 ? 0 : count - 1;
	}
	return (((from + delta) % count) + count) % count;
}

export default function Select({
	options,
	value,
	defaultValue,
	onChange,
	label,
	placeholder = 'Select…',
	width = '260px'
}: Props) {
	const rootRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	/** Which row the keyboard or pointer is resting on; -1 for none. */
	const [highlight, setHighlight] = useState(-1);
	const [internal, setInternal] = useState<string | undefined>(defaultValue);

	// Controlled the moment a `value` prop is passed, and uncontrolled otherwise
	// — the same bargain the native element makes.
	const current = value ?? internal;
	const selectedIndex = useMemo(() => options.findIndex(o => o.value === current), [options, current]);
	const chosen = selectedIndex >= 0 ? options[selectedIndex] : null;

	const pick = useCallback(
		(next: string) => {
			setInternal(next);
			setOpen(false);
			setHighlight(-1);
			onChange?.(next);
		},
		[onChange]
	);

	/*
	 * A press anywhere else closes it.
	 *
	 * On `pointerdown` rather than `click` so the menu is gone before the press
	 * lands on whatever is underneath — closing on click meant the first press
	 * outside was spent dismissing the menu instead of pressing the thing.
	 */
	useEffect(() => {
		if (!open) {
			return;
		}
		const onDown = (e: PointerEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setOpen(false);
				setHighlight(-1);
			}
		};
		document.addEventListener('pointerdown', onDown);
		return () => document.removeEventListener('pointerdown', onDown);
	}, [open]);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			// From wherever the eye already is: the highlight if there is one,
			// otherwise the current selection, otherwise the end being opened from.
			const from = highlight >= 0 ? highlight : selectedIndex;
			setOpen(true);
			setHighlight(nextIndex(from, e.key === 'ArrowDown' ? 1 : -1, options.length));
			return;
		}
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			if (open && highlight >= 0) {
				pick(options[highlight].value);
			} else {
				setOpen(!open);
				setHighlight(-1);
			}
			return;
		}
		if (e.key === 'Escape' && open) {
			// Only swallowed while the menu is up, so Escape still reaches whatever
			// this sits inside — usually a dialog that also wants to close.
			e.stopPropagation();
			setOpen(false);
			setHighlight(-1);
		}
	};

	return (
		<div className='sel' ref={rootRef} style={{ width }}>
			{label && (
				<Label as='div' size='xs' className='sel-label'>
					{label}
				</Label>
			)}

			<button
				type='button'
				className={'sel-btn' + (open ? ' sel-btn-open' : '')}
				aria-haspopup='listbox'
				aria-expanded={open}
				onClick={() => {
					setOpen(!open);
					setHighlight(-1);
				}}
				onKeyDown={onKeyDown}
			>
				<span className='sel-face'>
					{chosen?.dot && <span className='sel-dot' style={{ background: chosen.dot }} />}
					<span className={'sel-value' + (chosen ? '' : ' sel-value-empty')}>
						{chosen ? chosen.label : placeholder}
					</span>
				</span>
				<span className='sel-tail'>
					{chosen?.meta && <span className='sel-meta'>{chosen.meta}</span>}
					<svg className='sel-chev' width='12' height='12' viewBox='0 0 12 12' aria-hidden='true'>
						<path
							d='M2.5 4.5 6 8l3.5-3.5'
							fill='none'
							stroke='currentColor'
							strokeWidth='1.5'
							strokeLinecap='round'
							strokeLinejoin='round'
						/>
					</svg>
				</span>
			</button>

			{open && (
				<div className='sel-menu' role='listbox'>
					{options.map((o, i) => (
						<button
							type='button'
							key={o.value}
							role='option'
							aria-selected={i === selectedIndex}
							className={
								'sel-opt' +
								(i === highlight ? ' sel-opt-hi' : '') +
								(i === selectedIndex ? ' sel-opt-on' : '')
							}
							onClick={() => pick(o.value)}
							onMouseEnter={() => setHighlight(i)}
						>
							<span
								className='sel-dot'
								style={{ background: o.dot ?? 'transparent', visibility: o.dot ? 'visible' : 'hidden' }}
							/>
							<span className='sel-opt-label'>{o.label}</span>
							<span className='sel-tail'>
								{o.meta && <span className='sel-meta'>{o.meta}</span>}
								<svg
									className='sel-check'
									width='12'
									height='12'
									viewBox='0 0 12 12'
									aria-hidden='true'
									style={{ visibility: i === selectedIndex ? 'visible' : 'hidden' }}
								>
									<path
										d='M2.5 6.2 5 8.6l4.5-5'
										fill='none'
										stroke='currentColor'
										strokeWidth='1.6'
										strokeLinecap='round'
										strokeLinejoin='round'
									/>
								</svg>
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
