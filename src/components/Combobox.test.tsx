import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Combobox, { fold, filterOptions, groupOptions, highlightParts, layout } from './Combobox';
import type { ComboboxOption } from './Combobox';

const CITIES: ComboboxOption[] = [
	{ value: 'mecca', label: 'Mecca', meta: '21.4°N', group: 'Middle East' },
	{ value: 'istanbul', label: 'Istanbul', meta: '41.0°N', group: 'Europe' },
	{ value: 'tromso', label: 'Tromsø', meta: '69.6°N', group: 'Europe' },
	{ value: 'jakarta', label: 'Jakarta', meta: '6.2°S', group: 'Asia' }
];

describe('fold', () => {
	it('ignores case and accents', () => {
		expect(fold('MÉXICO')).toBe('mexico');
		expect(fold('Köln')).toBe('koln');
		expect(fold('İzmir').startsWith('i')).toBe(true);
	});

	it('flattens letters that decomposition cannot take apart', () => {
		// ø is not o-plus-a-mark, it is its own character, so NFD leaves it whole
		// and a reader without a Norwegian keyboard finds nothing.
		expect(fold('Tromsø')).toBe('tromso');
		expect(fold('Łódź')).toBe('lodz');
		expect(fold('Đà Nẵng')).toBe('da nang');
	});

	it('leaves the length alone, which is what makes offsets reusable', () => {
		// highlightParts slices the original label using an index found in the
		// folded one, so any fold that changed the length would light the wrong
		// characters. Combining marks are separate code points, so they go
		// without moving anything before them.
		for (const s of ['Tromsø', 'Köln', 'Zürich', 'Mecca', 'São Paulo']) {
			expect(fold(s).length, s).toBe(s.length);
		}
	});
});

describe('filterOptions', () => {
	it('returns everything for an empty query', () => {
		expect(filterOptions(CITIES, '')).toHaveLength(4);
	});

	it('matches without the accent the reader did not type', () => {
		expect(filterOptions(CITIES, 'tromso').map(o => o.value)).toEqual(['tromso']);
		expect(filterOptions(CITIES, 'Tromsø').map(o => o.value)).toEqual(['tromso']);
	});

	it('searches the meta as well as the label', () => {
		// "69" is a real way to ask which of these is in the far north.
		expect(filterOptions(CITIES, '69').map(o => o.value)).toEqual(['tromso']);
	});

	it('keeps the original order', () => {
		expect(filterOptions(CITIES, 'a').map(o => o.value)).toEqual(['mecca', 'istanbul', 'jakarta']);
	});

	it('can match nothing', () => {
		expect(filterOptions(CITIES, 'zzz')).toEqual([]);
	});
});

describe('highlightParts', () => {
	it('splits around the match', () => {
		expect(highlightParts('Istanbul', 'stan')).toEqual({ pre: 'I', hit: 'stan', post: 'bul' });
	});

	it('keeps the accent on screen even when it was not typed', () => {
		// Found by the folded string, sliced from the real one.
		expect(highlightParts('Tromsø', 'tromso')).toEqual({ pre: '', hit: 'Tromsø', post: '' });
	});

	it('lights nothing when there is no query or no match', () => {
		expect(highlightParts('Mecca', '')).toEqual({ pre: 'Mecca', hit: '', post: '' });
		expect(highlightParts('Mecca', 'zz')).toEqual({ pre: 'Mecca', hit: '', post: '' });
	});
});

describe('groupOptions', () => {
	it('buckets under headings in first-seen order', () => {
		const groups = groupOptions(CITIES);
		expect(groups.map(g => g.name)).toEqual(['Middle East', 'Europe', 'Asia']);
		expect(groups[1].items.map(i => i.option.value)).toEqual(['istanbul', 'tromso']);
	});

	it('numbers items by their place in the flat list, not within the group', () => {
		// The arrow keys walk the flat list; a heading is not a step. If these
		// were per-group the highlight would jump backwards at every heading.
		const groups = groupOptions(CITIES);
		expect(groups.flatMap(g => g.items.map(i => i.index))).toEqual([0, 1, 2, 3]);
	});

	it('handles options with no group at all', () => {
		const groups = groupOptions([{ value: 'a', label: 'A' }]);
		expect(groups).toHaveLength(1);
		expect(groups[0].name).toBe('');
	});
});

describe('layout', () => {
	it('stacks headings and rows into one column of positions', () => {
		const { rows, height } = layout(groupOptions(CITIES));
		// Middle East heading, Mecca, Europe heading, Istanbul, Tromsø, Asia, Jakarta
		expect(rows.map(r => r.kind)).toEqual(['head', 'option', 'head', 'option', 'option', 'head', 'option']);
		expect(rows.map(r => r.top)).toEqual([0, 26, 58, 84, 116, 148, 174]);
		expect(height).toBe(206);
	});

	it('gives every row the height its own kind occupies', () => {
		// The one invariant virtualisation cannot survive without: a gap or an
		// overlap here and the rows slide out from under the scrollbar.
		const { rows, height } = layout(groupOptions(CITIES));
		for (let i = 1; i < rows.length; i++) {
			const previous = rows[i - 1];
			expect(rows[i].top - previous.top, `row ${i}`).toBe(previous.kind === 'head' ? 26 : 32);
		}
		const last = rows[rows.length - 1];
		expect(height).toBe(last.top + (last.kind === 'head' ? 26 : 32));
	});

	it('keeps the flat index on the rows, so the keyboard still walks in order', () => {
		const rows = layout(groupOptions(CITIES)).rows;
		const options = rows.filter(r => r.kind === 'option');
		expect(options.map(r => (r.kind === 'option' ? r.index : -1))).toEqual([0, 1, 2, 3]);
	});

	it('leaves out the heading when options carry no group', () => {
		const { rows, height } = layout(groupOptions([{ value: 'a', label: 'A' }]));
		expect(rows).toHaveLength(1);
		expect(rows[0].top).toBe(0);
		expect(height).toBe(32);
	});

	it('is empty when nothing matched', () => {
		expect(layout(groupOptions([]))).toEqual({ rows: [], height: 0 });
	});
});

describe('Combobox', () => {
	it('renders a closed combobox showing the chosen label', () => {
		const html = renderToStaticMarkup(<Combobox options={CITIES} value='tromso' label='City' />);
		expect(html).toContain('role="combobox"');
		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain('value="Tromsø"');
		expect(html).toContain('City');
		expect(html).not.toContain('role="listbox"');
	});

	it('offers to clear only once there is something to clear', () => {
		expect(renderToStaticMarkup(<Combobox options={CITIES} />)).not.toContain('aria-label="Clear"');
		expect(renderToStaticMarkup(<Combobox options={CITIES} value='mecca' />)).toContain('aria-label="Clear"');
	});

	it('shows the chosen option’s meta beside the field', () => {
		expect(renderToStaticMarkup(<Combobox options={CITIES} value='mecca' />)).toContain('21.4°N');
	});
});
