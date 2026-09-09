// The select, with the list narrowed by typing.
//
// Same menu, same palette, same keyboard as `Select` — and it deliberately
// reuses that component's classes for the parts that are genuinely the same
// thing, so the two cannot drift into looking like different controls. What is
// new here is the field: a text input that filters, headings that group what
// survives, and the matched run of characters lit in the accent so a reader can
// see *why* a row is still on screen.
//
// Ported from the design project's Combobox.dc.html.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Label } from './Typography';
import { nextIndex } from './Select';

export interface ComboboxOption {
	value: string;
	label: string;
	/** A number shown dimmed on the right, and searched along with the label. */
	meta?: string;
	/** Heading this option sits under. Options with no group come first. */
	group?: string;
}

interface Props {
	options: ComboboxOption[];
	value?: string;
	defaultValue?: string;
	onChange?(value: string | undefined): void;
	label?: string;
	placeholder?: string;
	width?: string;
}

/*
 * Row geometry, kept in step with `.sel-opt` and `.cbx-group-name`.
 *
 * The menu draws only the rows on screen, so it has to know their size without
 * measuring: 891 cities is 891 buttons with an svg each, and building them all
 * to show twelve is work nobody sees. Fixed heights are what make that cheap —
 * a row's position is arithmetic rather than a layout pass — which is why the
 * stylesheet pins these two rather than letting content decide.
 */
const ROW_H = 32;
const HEAD_H = 26;
/** `.sel-menu`'s own max-height, the window rows are measured against. */
const VIEWPORT_H = 300;
/** Rows drawn beyond each edge, so a fast scroll does not show blank space. */
const OVERSCAN = 4;

type Row =
	| { kind: 'head'; name: string; top: number }
	| { kind: 'option'; option: ComboboxOption; index: number; top: number };

/** The grouped list flattened into positioned rows, headings included. */
export function layout(groups: ReturnType<typeof groupOptions>): { rows: Row[]; height: number } {
	const rows: Row[] = [];
	let top = 0;
	for (const group of groups) {
		if (group.name) {
			rows.push({ kind: 'head', name: group.name, top });
			top += HEAD_H;
		}
		for (const { option, index } of group.items) {
			rows.push({ kind: 'option', option, index, top });
			top += ROW_H;
		}
	}
	return { rows, height: top };
}

/**
 * Letters NFD cannot take apart, mapped to the key a reader would reach for.
 *
 * Decomposition only helps where the accent is a separate mark sitting over a
 * plain letter — ö really is o plus a diaeresis. A stroked letter is its own
 * character with nothing to strip, so ø survived the fold and Tromsø could not
 * be found by typing "tromso", which is exactly how anyone without a Norwegian
 * keyboard types it.
 *
 * Every entry is one character for one character. Æ and ß expand to two, which
 * would slide every offset after them and light the wrong run of the label, so
 * they are left for a day when the highlight can carry a mapping alongside it.
 */
const STROKED: Record<string, string> = { ø: 'o', đ: 'd', ð: 'd', ł: 'l', ħ: 'h', ŧ: 't', ı: 'i' };

/**
 * A string flattened for comparison: no case, no accents, no strokes.
 *
 * Someone hunting for Tromsø types "tromso", and someone who knows the ø types
 * it. Both should find the city, so both sides of the comparison are put
 * through this first.
 */
export function fold(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[øđðłħŧı]/g, c => STROKED[c] ?? c);
}

/** The options a query leaves standing, in their original order. */
export function filterOptions(options: ComboboxOption[], query: string): ComboboxOption[] {
	const q = fold(query);
	if (!q) {
		return options;
	}
	// The meta is searchable too: for a list of cities carrying latitudes, "69"
	// is a perfectly good way to ask which of them are in the far north.
	return options.filter(o => fold(o.label).includes(q) || fold(o.meta ?? '').includes(q));
}

/**
 * A label split around the run the query matched, for lighting the middle part.
 *
 * Sliced from the *original* label rather than the folded one, so the accents
 * survive on screen — the fold is only ever used to find the position. Both
 * strings fold to the same length here because stripping marks removes whole
 * code points, which is what keeps the offsets usable.
 */
export function highlightParts(label: string, query: string): { pre: string; hit: string; post: string } {
	const q = fold(query);
	const at = q ? fold(label).indexOf(q) : -1;
	if (at < 0) {
		return { pre: label, hit: '', post: '' };
	}
	return { pre: label.slice(0, at), hit: label.slice(at, at + q.length), post: label.slice(at + q.length) };
}

/** The surviving options bucketed under their headings, order preserved. */
export function groupOptions(
	options: ComboboxOption[]
): { name: string; items: { option: ComboboxOption; index: number }[] }[] {
	const groups = new Map<string, { option: ComboboxOption; index: number }[]>();
	options.forEach((option, index) => {
		const name = option.group ?? '';
		if (!groups.has(name)) {
			groups.set(name, []);
		}
		// The index carried here is the position in the *flat* filtered list, which
		// is what the arrow keys walk — the headings must not be steps of their own.
		groups.get(name)!.push({ option, index });
	});
	return [...groups].map(([name, items]) => ({ name, items }));
}

export default function Combobox({
	options,
	value,
	defaultValue,
	onChange,
	label,
	placeholder = 'Search…',
	width = '280px'
}: Props) {
	const rootRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const [open, setOpen] = useState(false);
	const [highlight, setHighlight] = useState(0);
	const [internal, setInternal] = useState<string | undefined>(defaultValue);
	/*
	 * Whether the field is showing a query or the chosen label.
	 *
	 * One input has to be both. Until you type it reads back what is selected;
	 * the moment you do, it is a search box and the selection is only still there
	 * because nothing has replaced it yet.
	 */
	const [typing, setTyping] = useState(false);
	const [query, setQuery] = useState('');

	const current = value ?? internal;
	const chosen = useMemo(() => options.find(o => o.value === current) ?? null, [options, current]);
	const matches = useMemo(() => filterOptions(options, typing ? query : ''), [options, typing, query]);
	const groups = useMemo(() => groupOptions(matches), [matches]);
	const { rows, height } = useMemo(() => layout(groups), [groups]);

	/*
	 * The slice of rows the window is actually over.
	 *
	 * A linear walk rather than a binary search: the list is under a thousand
	 * rows and this runs on scroll, where a loop that plainly does what it says
	 * is worth more than the handful of microseconds a bisect would save.
	 */
	const [first, last] = useMemo(() => {
		let start = 0;
		while (start < rows.length && rows[start].top + (rows[start].kind === 'head' ? HEAD_H : ROW_H) <= scrollTop) {
			start++;
		}
		let end = start;
		while (end < rows.length && rows[end].top < scrollTop + VIEWPORT_H) {
			end++;
		}
		return [Math.max(0, start - OVERSCAN), Math.min(rows.length, end + OVERSCAN)];
	}, [rows, scrollTop]);

	const close = useCallback(() => {
		setOpen(false);
		setTyping(false);
		setQuery('');
		setHighlight(0);
	}, []);

	const pick = useCallback(
		(option: ComboboxOption) => {
			setInternal(option.value);
			close();
			onChange?.(option.value);
		},
		[close, onChange]
	);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onDown = (e: PointerEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				close();
			}
		};
		document.addEventListener('pointerdown', onDown);
		return () => document.removeEventListener('pointerdown', onDown);
	}, [open, close]);

	/*
	 * Carry the window to the highlight.
	 *
	 * `scrollIntoView` on the element is the usual move and is not available
	 * here: past the first dozen rows the highlighted one has not been drawn, so
	 * there is nothing to call it on. Its position is known arithmetic though,
	 * so the menu is scrolled by the shortest distance that brings it inside —
	 * which also keeps arrowing down from feeling like the list jumps.
	 */
	useEffect(() => {
		const el = menuRef.current;
		if (!el || !open) {
			return;
		}
		const row = rows.find(r => r.kind === 'option' && r.index === highlight);
		if (!row) {
			return;
		}
		if (row.top < el.scrollTop) {
			el.scrollTop = row.top;
		} else if (row.top + ROW_H > el.scrollTop + el.clientHeight) {
			el.scrollTop = row.top + ROW_H - el.clientHeight;
		}
	}, [highlight, open, rows]);

	// A new query is a new list, so it is read from the top.
	useEffect(() => {
		if (menuRef.current) {
			menuRef.current.scrollTop = 0;
		}
		setScrollTop(0);
	}, [query, typing]);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			setOpen(true);
			setHighlight(matches.length ? nextIndex(highlight, e.key === 'ArrowDown' ? 1 : -1, matches.length) : 0);
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			if (open && matches[highlight]) {
				pick(matches[highlight]);
			} else {
				setOpen(true);
			}
			return;
		}
		if (e.key === 'Escape') {
			if (open) {
				e.stopPropagation();
			}
			close();
			inputRef.current?.blur();
			return;
		}
		if (e.key === 'Tab') {
			// Leaving by keyboard commits nothing and takes the menu with it.
			close();
		}
	};

	return (
		<div className='cbx' ref={rootRef} style={{ width }}>
			{label && (
				<Label as='div' size='xs' className='sel-label'>
					{label}
				</Label>
			)}

			<div className={'cbx-field' + (open ? ' cbx-field-open' : '')}>
				<svg className='cbx-icon' width='13' height='13' viewBox='0 0 13 13' aria-hidden='true'>
					<circle cx='5.5' cy='5.5' r='4' fill='none' stroke='currentColor' strokeWidth='1.5' />
					<path d='M8.6 8.6 12 12' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
				</svg>

				<input
					ref={inputRef}
					className='cbx-input'
					role='combobox'
					aria-expanded={open}
					aria-autocomplete='list'
					spellCheck={false}
					placeholder={placeholder}
					value={typing ? query : (chosen?.label ?? '')}
					onChange={e => {
						setQuery(e.target.value);
						setTyping(true);
						setOpen(true);
						setHighlight(0);
					}}
					onFocus={() => {
						// Focusing clears to an empty query rather than pre-filling with the
						// selection: the common next move is to search for something else,
						// and having to erase the old answer first is a small tax on it.
						setOpen(true);
						setTyping(true);
						setQuery('');
						setHighlight(0);
					}}
					onKeyDown={onKeyDown}
				/>

				<span className='cbx-tools'>
					{(typing ? query : (chosen?.label ?? '')) && (
						<button
							type='button'
							className='cbx-clear'
							aria-label='Clear'
							onClick={() => {
								setInternal(undefined);
								setQuery('');
								setTyping(true);
								setOpen(true);
								setHighlight(0);
								onChange?.(undefined);
								inputRef.current?.focus();
							}}
						>
							<svg width='10' height='10' viewBox='0 0 10 10' aria-hidden='true'>
								<path d='M2 2l6 6M8 2l-6 6' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
							</svg>
						</button>
					)}

					{chosen?.meta && !typing && <span className='sel-meta'>{chosen.meta}</span>}

					{/* Out of the tab order on purpose: the input is already the control,
					    and a second stop that only opens what typing opens is noise. */}
					<button
						type='button'
						className='cbx-toggle'
						aria-label='Toggle'
						tabIndex={-1}
						onClick={() => {
							if (open) {
								close();
							} else {
								setOpen(true);
								inputRef.current?.focus();
							}
						}}
					>
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
					</button>
				</span>
			</div>

			{open && (
				<div
					className='sel-menu sel-menu-virtual'
					role='listbox'
					ref={menuRef}
					onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
				>
					{matches.length > 0 && (
						// One tall spacer holding the true height, so the scrollbar is
						// honest about the whole list while only a screenful exists.
						<div className='cbx-rows' style={{ height }}>
							{rows.slice(first, last).map(row => {
								if (row.kind === 'head') {
									return (
										<div className='cbx-group-name' key={'h:' + row.name} style={{ top: row.top }}>
											{row.name}
										</div>
									);
								}
								const { option, index } = row;
								const parts = highlightParts(option.label, typing ? query : '');
								const selected = option.value === current;
								return (
									<button
										type='button'
										key={option.value}
										role='option'
										aria-selected={selected}
										style={{ top: row.top }}
										className={
											'sel-opt sel-opt-nodot' +
											(index === highlight ? ' sel-opt-hi' : '') +
											(selected ? ' sel-opt-on' : '')
										}
										// Pressed on mousedown, before the input can lose focus and
										// take the menu down with it on the way to the click.
										onMouseDown={e => {
											e.preventDefault();
											pick(option);
										}}
										onMouseEnter={() => setHighlight(index)}
									>
										<span className='sel-opt-label'>
											{parts.pre}
											<span className='cbx-hit'>{parts.hit}</span>
											{parts.post}
										</span>
										<span className='sel-tail'>
											{option.meta && <span className='sel-meta'>{option.meta}</span>}
											<svg
												className='sel-check'
												width='12'
												height='12'
												viewBox='0 0 12 12'
												aria-hidden='true'
												style={{ visibility: selected ? 'visible' : 'hidden' }}
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
								);
							})}
						</div>
					)}

					{matches.length === 0 && <div className='cbx-empty'>No matches for “{query}”</div>}
				</div>
			)}
		</div>
	);
}
