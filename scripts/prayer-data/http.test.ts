import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBlockPage, mapPool } from './http.ts';

const here = dirname(fileURLToPath(import.meta.url));
const wafBlockPage = readFileSync(join(here, '__fixtures__', 'waf-block-page.html'), 'utf8');
const fullSizePage = readFileSync(join(here, '__fixtures__', 'emmen-tables.html'), 'utf8');

describe('isBlockPage', () => {
	it('flags the real captured WAF block page', () => {
		expect(isBlockPage(wafBlockPage)).toBe(true);
	});

	it('does not flag a full-size real page', () => {
		expect(fullSizePage.length).toBeGreaterThan(2000);
		expect(isBlockPage(fullSizePage)).toBe(false);
	});

	it('flags a short body even without the WAF phrase (new behaviour)', () => {
		const shortBody = '<html><body>Service Unavailable</body></html>';
		expect(shortBody.length).toBeLessThan(2000);
		expect(isBlockPage(shortBody)).toBe(true);
	});

	it('flags the WAF phrase whatever the body size', () => {
		const padding = 'x'.repeat(2000);
		const large = `<html>${padding}güvenlik kurallarına takılmıştır${padding}</html>`;
		expect(large.length).toBeGreaterThanOrEqual(2000);
		expect(isBlockPage(large)).toBe(true);
	});

	// GetRegList answers legitimately with payloads as small as 90 bytes, so the
	// html length rule must not be applied to them. Treating these as blocks is
	// what stalled the first discovery run, five minutes at a time.
	describe('json endpoints', () => {
		it('accepts a small but valid district list', () => {
			const small = '{"Result":null,"StateRegionList":[],"HasStateList":true}';
			expect(small.length).toBeLessThan(2000);
			expect(isBlockPage(small, 'json')).toBe(false);
		});

		it('accepts the real 1258-byte Alabama district payload shape', () => {
			const body =
				'{"Result":null,"CountryList":null,"StateList":null,"StateRegionList":[' +
				'{"IlceUrl":"/en-US/8573/prayer-time-for-auburn","IlceAdi":"AUBURN",' +
				'"IlceAdiEn":"AUBURN","IlceID":"8573"}]}';
			expect(isBlockPage(body, 'json')).toBe(false);
		});

		it('flags HTML served where JSON was expected', () => {
			expect(isBlockPage('<html><head><title>nope</title></head></html>', 'json')).toBe(true);
		});

		it('flags a real block page on a json endpoint', () => {
			expect(isBlockPage(wafBlockPage, 'json')).toBe(true);
		});
	});
});

describe('mapPool', () => {
	it('preserves input order when workers finish out of order', async () => {
		const items = [1, 2, 3, 4, 5];
		const delays = [50, 10, 40, 5, 30];
		const result = await mapPool(items, 3, (item, i) => {
			return new Promise<number>(resolve => {
				setTimeout(() => resolve(item * 10), delays[i]);
			});
		});
		expect(result).toEqual([10, 20, 30, 40, 50]);
	});

	it('returns an empty array for empty input', async () => {
		const fn = async (item: number) => item;
		const result = await mapPool([], 3, fn);
		expect(result).toEqual([]);
	});

	it('handles a limit greater than the input length', async () => {
		const items = [1, 2, 3];
		const result = await mapPool(items, 10, async item => item * 2);
		expect(result).toEqual([2, 4, 6]);
	});

	it('clamps a limit of 0 to 1, rather than returning undefined entries', async () => {
		const items = [1, 2, 3];
		const result = await mapPool(items, 0, async item => item * 2);
		expect(result).toEqual([2, 4, 6]);
	});

	it('clamps a negative limit to 1', async () => {
		const items = [1, 2, 3];
		const result = await mapPool(items, -5, async item => item * 2);
		expect(result).toEqual([2, 4, 6]);
	});

	it('stops starting new work once one item rejects', async () => {
		const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		let started = 0;
		const fn = async (item: number) => {
			started++;
			// Let every worker get a chance to race ahead before the failing item settles.
			await new Promise(r => setTimeout(r, 20));
			if (item === 3) throw new Error('boom');
			return item;
		};

		await expect(mapPool(items, 4, fn)).rejects.toThrow('boom');

		const startedAtFailure = started;
		// Give any worker that ignored the latch time to start more work, if it were going to.
		await new Promise(r => setTimeout(r, 100));
		expect(started).toBe(startedAtFailure);
		// Not all 10 items should have started — the pool stopped short.
		expect(started).toBeLessThan(items.length);
	});
});
