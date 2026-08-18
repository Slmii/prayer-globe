import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * `Typography.tsx` builds its class names by hand — `t-${role}-${size}` — which means
 * a role or a size added on one side and forgotten on the other fails silently:
 * the element renders with no typography at all and inherits whatever its
 * parent had. Nothing throws, nothing logs, and it looks *nearly* right.
 *
 * So the two sides are checked against each other here.
 */

const scss = readFileSync('src/styles.scss', 'utf8');
const tsx = readFileSync('src/components/Typography.tsx', 'utf8');

/** The roles `Type.tsx` exports, read from the file rather than restated. */
const ROLES = [...tsx.matchAll(/export const \w+ = role\('([\w-]+)'/g)].map(m => m[1]);
const SIZES = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'];

describe('Typography', () => {
	it('exports the roles the inventory found', () => {
		expect(ROLES.sort()).toEqual(['arabic', 'body', 'caption', 'chip', 'display', 'label', 'title', 'value']);
	});

	it('has a class in the stylesheet for every role and size', () => {
		const missing: string[] = [];
		for (const role of ROLES) {
			for (const size of SIZES) {
				// The selector may stand alone, sit in a comma-separated group, or be
				// the last member of a `:where(...)` — hence the closing paren.
				const cls = `.t-${role}-${size}`;
				if (!new RegExp(`\\${cls}[\\s,{)]`).test(scss)) missing.push(cls);
			}
		}
		expect(missing, `no rule for: ${missing.join(', ')}`).toEqual([]);
	});

	/**
	 * The point of the whole exercise: the stylesheet should carry no bare font
	 * shorthand any more. Three are left on purpose — two `inherit`s, which
	 * name no size at all, and one `!important` rule overriding a third party's
	 * stylesheet, where the shorthand has to stay whole to win.
	 */
	it('leaves no untokenised font declarations behind', () => {
		const raw = [...scss.matchAll(/font:\s*([^;]+);/g)].map(m => m[1].replace(/\s+/g, ' ').trim());
		const unexpected = raw.filter(v => v !== 'inherit' && !v.includes('!important'));
		expect(unexpected, `still literal: ${unexpected.join(' | ')}`).toEqual([]);
	});

	/**
	 * A colour name that points at a variable nobody declared resolves to an
	 * empty string, and the element silently keeps whatever colour it inherited
	 * — the same quiet failure as a missing class, and just as hard to spot.
	 */
	it('backs every named colour with a variable that exists', () => {
		const names = [...tsx.matchAll(/'?([\w-]+)'?:\s*'var\((--[\w-]+)\)'/g)].map(m => ({
			name: m[1],
			cssVar: m[2]
		}));
		expect(names.length, 'no colours found in Typography.tsx').toBeGreaterThan(5);
		const missing = names.filter(c => !new RegExp(`\\${c.cssVar}\\s*:`).test(scss));
		expect(
			missing.map(c => `${c.name} -> ${c.cssVar}`),
			'colour points at an undeclared variable'
		).toEqual([]);
	});

	it('defines every size and leading it uses as a token', () => {
		const tokens = readFileSync('src/styles/_tokens.scss', 'utf8');
		const used = new Set([...scss.matchAll(/t\.\$(fs-[\w-]+|lh-[\w-]+|fw-[\w-]+|ff-[\w-]+)/g)].map(m => m[1]));
		const missing = [...used].filter(name => !new RegExp(`\\$${name}\\s*:`).test(tokens));
		expect(missing, `used but never defined: ${missing.join(', ')}`).toEqual([]);
	});
});
