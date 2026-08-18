// Builds public/world.json — the country outlines the globe draws.
//
//   npm run build:world
//
// The app used to fetch this straight from jsDelivr at
// `nvkelso/natural-earth-vector@master`, which was two problems in one. It put
// a third-party CDN on the critical render path, and `@master` is a moving ref,
// so the outlines could change under us without a commit.
//
// It was also the single largest payload the page loaded: 839 KB of JSON,
// 194 KB over the wire, ahead of any individual chunk of the JS bundle. Almost
// all of that is metadata the globe never reads — 177 features carrying 168
// properties each, including every country's name in a dozen scripts, its
// population estimate, and its ISO codes.
//
// Stripping every property and rounding coordinates to three decimals leaves
// the same outlines at a fraction of the size, with the error held below half a
// pixel at the map's maxZoom of 8.

import { writeFileSync } from 'node:fs';

const SRC = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson';
const OUT = 'public/world.json';

/**
 * Coordinate precision, decimal places.
 *
 * MapLibre's world is 512·2^zoom pixels wide, so at this map's maxZoom of 8
 * one degree is 364 px and 0.01° — two decimals — is 3.6 CSS px, roughly 7
 * device pixels. That is a visible staircase along coastlines and on the 1.5 px
 * border line, not the sub-pixel rounding it looks like on paper. Three
 * decimals bring it to 0.36 px for 8 KB more brotli.
 */
const DP = 3;

const round = (n: number): number => Math.round(n * 10 ** DP) / 10 ** DP;

/** Coordinates nest to arbitrary depth: Position | Position[] | Position[][]… */
function roundCoords(c: unknown): unknown {
	if (typeof c === 'number') {
		return round(c);
	}
	return Array.isArray(c) ? c.map(roundCoords) : c;
}

interface Feature {
	type: string;
	properties?: unknown;
	geometry: { type: string; coordinates: unknown } | null;
}

async function main() {
	console.log('downloading Natural Earth 110m admin 0 …');
	const res = await fetch(SRC);
	if (!res.ok) throw new Error(`Natural Earth → HTTP ${res.status}`);

	const raw = await res.text();
	const src = JSON.parse(raw) as { type: string; features: Feature[] };

	const out = {
		type: 'FeatureCollection',
		features: src.features
			.filter(f => f.geometry)
			.map(f => ({
				type: 'Feature',
				// The globe draws outlines and nothing else — no labels, no lookups.
				properties: {},
				geometry: {
					type: f.geometry!.type,
					coordinates: roundCoords(f.geometry!.coordinates)
				}
			}))
	};

	const json = JSON.stringify(out);
	writeFileSync(OUT, json);

	const pct = (1 - json.length / raw.length) * 100;
	console.log(
		`${OUT}: ${out.features.length} features, ` +
			`${(raw.length / 1024).toFixed(0)} KB → ${(json.length / 1024).toFixed(0)} KB ` +
			`(${pct.toFixed(0)}% smaller)`
	);
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
