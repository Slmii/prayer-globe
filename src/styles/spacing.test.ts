import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * The stylesheet's spacing should be spent from a named set, not typed by hand.
 *
 * These tests are what stop it drifting back. Nothing here checks that the
 * *design* is right — 9px and 10px both being steps is a real question, and one
 * for a person — only that every value has a name, so the question can be asked
 * at all.
 */

const scss = readFileSync('src/styles.scss', 'utf8');
const tokens = readFileSync('src/styles/_spacing.scss', 'utf8');

/** Everything that positions a box relative to its neighbours. */
const PROPS = [
	'padding',
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
	'margin',
	'margin-top',
	'margin-right',
	'margin-bottom',
	'margin-left',
	'gap',
	'row-gap',
	'column-gap'
];

/** Declarations, with comments stripped so an example in prose is not a finding. */
function declarations(prop: string): string[] {
	const bare = scss.replace(/\/\*[\s\S]*?\*\//g, '');
	return [...bare.matchAll(new RegExp(`(?<![\\w-])${prop}:\\s*([^;{}]+);`, 'g'))].map(m =>
		m[1].replace(/\s+/g, ' ').trim()
	);
}

describe('spacing', () => {
	it('spends every spacing value from a token', () => {
		const literals: string[] = [];
		for (const prop of PROPS) {
			for (const value of declarations(prop)) {
				// `4vmin` is the crescent viewer's backdrop inset — a proportion of
				// the window, not a step on any scale, so it has no token.
				if (value.includes('vmin')) continue;
				if (/(?<![\w.$-])-?\d*\.?\d+px/.test(value)) literals.push(`${prop}: ${value}`);
			}
		}
		expect(literals, `hand-written spacing: ${literals.join(' | ')}`).toEqual([]);
	});

	it('defines every spacing token it uses', () => {
		const used = new Set([...scss.matchAll(/sp\.\$([\w-]+)/g)].map(m => m[1]));
		expect(used.size, 'no spacing tokens in use').toBeGreaterThan(10);
		const missing = [...used].filter(name => !new RegExp(`\\$${name}\\s*:`).test(tokens));
		expect(missing, `used but never defined: ${missing.join(', ')}`).toEqual([]);
	});

	it('uses every token it defines', () => {
		// A token nobody spends is a step in a scale that does not exist, which is
		// how the list starts growing again.
		const defined = [...tokens.matchAll(/^\$([\w-]+):/gm)].map(m => m[1]);
		const unused = defined.filter(name => !scss.includes(`sp.$${name}`));
		expect(unused, `defined but never used: ${unused.join(', ')}`).toEqual([]);
	});
});
