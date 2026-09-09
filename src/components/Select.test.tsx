import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Select, { nextIndex } from './Select';
import type { SelectOption } from './Select';

const PRAYERS: SelectOption[] = [
	{ value: 'fajr', label: 'Fajr', meta: '−18°', dot: '#968ae0' },
	{ value: 'duha', label: 'Duha', dot: '#f4c56a' },
	{ value: 'dhuhr', label: 'Dhuhr', meta: 'noon', dot: '#f7dfa2' },
	{ value: 'asr', label: 'Asr', meta: '+1 shadow', dot: '#f0925e' }
];

describe('nextIndex', () => {
	it('wraps at both ends', () => {
		expect(nextIndex(3, 1, 4)).toBe(0);
		expect(nextIndex(0, -1, 4)).toBe(3);
		expect(nextIndex(1, 1, 4)).toBe(2);
		expect(nextIndex(2, -1, 4)).toBe(1);
	});

	it('opens onto the near end when nothing is highlighted yet', () => {
		/*
		 * The correction to the design, and the reason this function is exported.
		 *
		 * It walked from -1 the same way it walked from anywhere else, so arrowing
		 * *up* into a closed select landed on the second-to-last row and the last
		 * one could not be reached without going all the way round. Down should
		 * open on the first row, up on the last.
		 */
		expect(nextIndex(-1, 1, 4)).toBe(0);
		expect(nextIndex(-1, -1, 4)).toBe(3);
	});

	it('has nowhere to go in an empty list', () => {
		expect(nextIndex(-1, 1, 0)).toBe(-1);
		expect(nextIndex(0, -1, 0)).toBe(-1);
	});

	it('stays in range from any starting point, in either direction', () => {
		// A property rather than a case list: the wrap is modular arithmetic and
		// the only thing that must never happen is landing outside the list.
		for (let count = 1; count <= 8; count++) {
			for (let from = -1; from < count; from++) {
				for (const delta of [1, -1]) {
					const got = nextIndex(from, delta, count);
					expect(got, `from ${from} by ${delta} of ${count}`).toBeGreaterThanOrEqual(0);
					expect(got, `from ${from} by ${delta} of ${count}`).toBeLessThan(count);
				}
			}
		}
	});
});

describe('Select', () => {
	it('shows the placeholder until something is chosen', () => {
		const html = renderToStaticMarkup(<Select options={PRAYERS} placeholder='Pick a prayer' />);
		expect(html).toContain('Pick a prayer');
		expect(html).toContain('sel-value-empty');
		// Closed: no listbox in the markup at all, rather than a hidden one.
		expect(html).not.toContain('role="listbox"');
	});

	it('shows the chosen option with its swatch and its number', () => {
		const html = renderToStaticMarkup(<Select options={PRAYERS} value='asr' />);
		expect(html).toContain('Asr');
		expect(html).toContain('+1 shadow');
		expect(html).toContain('#f0925e');
		expect(html).not.toContain('sel-value-empty');
	});

	it('reports itself as a closed listbox trigger', () => {
		const html = renderToStaticMarkup(<Select options={PRAYERS} label='Prayer' />);
		expect(html).toContain('aria-haspopup="listbox"');
		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain('Prayer');
	});

	it('renders no heading when it is not given one', () => {
		const html = renderToStaticMarkup(<Select options={PRAYERS} />);
		expect(html).not.toContain('sel-label');
	});

	it('takes any width it is handed', () => {
		const html = renderToStaticMarkup(<Select options={PRAYERS} width='100%' />);
		expect(html).toContain('width:100%');
	});
});
