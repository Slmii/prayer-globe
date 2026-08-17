import { describe, it, expect } from 'vitest';
import { titleCase } from './locate';

describe('titleCase', () => {
	it('cases a name Diyanet publishes in capitals', () => {
		expect(titleCase('EMMEN')).toBe('Emmen');
		expect(titleCase('SULTANBEYLI')).toBe('Sultanbeyli');
	});

	it('cases every word, not just the first', () => {
		expect(titleCase('KUALA LUMPUR')).toBe('Kuala Lumpur');
	});

	/**
	 * A hyphen separates words rather than joining them. Treating it as part of a
	 * word gave "Berkel-enschot", which is the sort of thing that reads as a bug
	 * in the data rather than in the formatting.
	 */
	it('cases both halves of a hyphenated name', () => {
		expect(titleCase('BERKEL-ENSCHOT')).toBe('Berkel-Enschot');
		expect(titleCase("O'BRIEN")).toBe("O'Brien");
	});

	/**
	 * The reason the first letter of a word is never lowercased: `toLowerCase`
	 * turns `İ` into `i` plus a combining dot, so a naive pass returned "İzmi̇r".
	 */
	it('keeps the Turkish dotted capital and does not leave a stray dot', () => {
		expect(titleCase('İZMİR')).toBe('İzmir');
		expect(titleCase('İSTANBUL')).toBe('İstanbul');
	});

	/**
	 * Only a shouting name is touched. A name someone has already cased is left
	 * exactly as it is, rather than re-cased into something worse — "McDonald"
	 * would come back "Mcdonald", and that is a loss, not a fix.
	 */
	it('leaves an already-cased name alone', () => {
		expect(titleCase('Emmen')).toBe('Emmen');
		expect(titleCase('McDonald')).toBe('McDonald');
		expect(titleCase("'s-Hertogenbosch")).toBe("'s-Hertogenbosch");
	});

	it('survives a name with no letters at all', () => {
		expect(titleCase('')).toBe('');
		expect(titleCase('12')).toBe('12');
	});
});
