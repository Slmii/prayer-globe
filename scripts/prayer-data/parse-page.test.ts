import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCityPage, extractRows } from './parse-page.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, '__fixtures__', 'emmen-tables.html'), 'utf8');

/** Removes the `<table>...</table>` that carries `captionId`, whole. */
function stripTable(html: string, captionId: string): string {
	const anchor = html.indexOf(`id="${captionId}"`);
	if (anchor < 0) throw new Error(`fixture setup: no table with caption ${captionId}`);
	const start = html.lastIndexOf('<table', anchor);
	const end = html.indexOf('</table>', anchor) + '</table>'.length;
	return html.slice(0, start) + html.slice(end);
}

describe('extractRows', () => {
	it('pulls the yearly table including its header row', () => {
		const rows = extractRows(fixture, 'table-caption-yearly');
		expect(rows[0]).toEqual([
			'Gregorian Calendar Date',
			'Hijri Date',
			'Fajr',
			'Sun',
			'Dhuhr',
			'Asr',
			'Maghrib',
			'Isha'
		]);
		expect(rows).toHaveLength(366);
	});

	it('pulls the monthly table including its header row', () => {
		const rows = extractRows(fixture, 'table-caption-monthly');
		expect(rows[0]).toEqual([
			'Gregorian Calendar Date',
			'Hijri Date',
			'Fajr',
			'Sun',
			'Dhuhr',
			'Asr',
			'Maghrib',
			'Isha'
		]);
		expect(rows).toHaveLength(32);
	});

	it('throws when the caption is absent', () => {
		expect(() => extractRows('<html></html>', 'table-caption-yearly')).toThrow(/table-caption-yearly/);
	});
});

describe('parseCityPage', () => {
	const days = parseCityPage(fixture);

	it('returns a full year plus the rolling month, deduped', () => {
		expect(days.length).toBeGreaterThanOrEqual(365);
		const dates = days.map(d => d.date);
		expect(new Set(dates).size).toBe(dates.length);
	});

	it('converts dd.mm.yyyy to ISO and keeps the six times in the published column order', () => {
		// Exact values transcribed from the fixture's yearly table, row "01.01.2027".
		const jan1 = days.find(d => d.date === '2027-01-01');
		expect(jan1).toBeDefined();
		expect(jan1!.times).toEqual(['06:37', '08:38', '12:41', '14:15', '16:34', '18:21']);
		expect(jan1!.hijri).toBe('23 Recep 1448');
	});

	it('pins an exact row from the monthly table', () => {
		// Exact values transcribed from the fixture's monthly table, row "15.08.2026".
		const day = days.find(d => d.date === '2026-08-15');
		expect(day).toBeDefined();
		expect(day!.times).toEqual(['04:11', '06:07', '13:42', '17:42', '21:07', '22:53']);
		expect(day!.hijri).toBe('2 Rebiulevvel 1448');
	});

	it('includes dates that only the monthly table provides', () => {
		// The monthly table covers 15.08.2026–14.09.2026; the yearly table covers
		// all of 2027. This date is 2026, so it can only have come from the
		// monthly table — a fixture with the monthly table deleted would fail
		// this assertion even though the yearly table is untouched.
		const dates = new Set(days.map(d => d.date));
		expect(dates.has('2026-08-15')).toBe(true);
		expect(dates.has('2026-09-14')).toBe(true);
	});

	it('sorts ascending, verified independently of the implementation comparator', () => {
		const times = days.map(d => new Date(d.date).getTime());
		for (let i = 1; i < times.length; i++) {
			expect(times[i]).toBeGreaterThan(times[i - 1]);
		}
	});

	it('rejects a row whose times are malformed', () => {
		const broken = fixture.replace('<td>06:37</td>', '<td>oops</td>');
		expect(() => parseCityPage(broken)).toThrow(/malformed/i);
	});

	it('throws when the page has no tables at all', () => {
		expect(() => parseCityPage('<html><body>nothing</body></html>')).toThrow();
	});

	it('throws when the monthly table is missing, even with a full yearly table present', () => {
		const withoutMonthly = stripTable(fixture, 'table-caption-monthly');
		expect(() => parseCityPage(withoutMonthly)).toThrow(/table-caption-monthly/);
	});
});
