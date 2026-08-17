// Stage 3: one plain GET per city, parsed into public/times/.
//
//   npm run prayer:fetch                  # every selected city
//   npm run prayer:fetch -- --only London # just these
//   npm run prayer:fetch -- --prune       # also drop days older than 2 days
//   npm run prayer:fetch -- --fresh       # ignore/clear resume state, refetch everything
//
// A run yields the rolling ~31-day window plus all 365 days of the published
// next year. Writes MERGE: each run contributes a different 30 days, and
// Diyanet serves no archive, so overwriting would permanently narrow the
// snapshot to whatever the last run happened to see.
//
// Progress is checkpointed to data/fetch-state.json as each city finishes, so
// a crashed or interrupted run resumes from where it left off on the next
// invocation. That file is deleted once a run completes successfully, so the
// following run starts fresh without needing --fresh. Pass --fresh to discard
// an existing checkpoint instead of resuming from it (e.g. after the selected
// cities changed).

import { mkdirSync, writeFileSync, renameSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getText, mapPool, BlockedError } from './http.ts';
import { parseCityPage } from './parse-page.ts';
import { CITIES } from '../../src/lib/cities.ts';
import type { City } from '../../src/lib/cities.ts';

export type SnapshotDay = [string, string, string, string, string, string, string];

export interface SnapshotFile {
	ilceID: string;
	name: string;
	tz: string;
	/** ISO date -> [fajr, sunrise, dhuhr, asr, maghrib, isha, hijri] */
	days: Record<string, SnapshotDay>;
}

const OUT = 'public/times';
const STATE = 'data/fetch-state.json';
/** Yesterday is still needed: a city at UTC-11 is on the previous local date. */
const KEEP_DAYS_BACK = 2;

const args = process.argv.slice(2);
const prune = args.includes('--prune');
const indexOnly = args.includes('--index-only');
const freshStart = args.includes('--fresh');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx > -1 ? args.slice(onlyIdx + 1).filter(a => !a.startsWith('--')) : [];

interface RunState {
	done: string[];
}

/** Write to a sibling .tmp file then rename over the target, so a crash
 * mid-write can never leave a truncated, unparseable file in its place. */
function atomicWrite(path: string, data: string) {
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, data);
	renameSync(tmp, path);
}

function loadState(): RunState {
	if (freshStart) {
		if (existsSync(STATE)) rmSync(STATE);
		return { done: [] };
	}
	if (!existsSync(STATE)) return { done: [] };
	return JSON.parse(readFileSync(STATE, 'utf8')) as RunState;
}

function isoDaysAgo(n: number): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
}

function merge(city: City, fresh: SnapshotFile['days']): SnapshotFile {
	const path = join(OUT, `${city.ilceID}.json`);
	let days: SnapshotFile['days'] = {};
	if (existsSync(path)) {
		let existing: SnapshotFile;
		try {
			existing = JSON.parse(readFileSync(path, 'utf8')) as SnapshotFile;
		} catch (err) {
			// Diyanet serves no archive: silently resetting to {} here would
			// permanently discard every earlier day this snapshot ever captured.
			// Fail loudly instead so a crashed write is fixed, not compounded.
			throw new Error(`${path} exists but is not valid JSON — refusing to merge over it: ${err}`);
		}
		days = existing.days ?? {};
	}

	// Fresh wins, so a Diyanet correction propagates.
	Object.assign(days, fresh);

	if (prune) {
		const floor = isoDaysAgo(KEEP_DAYS_BACK);
		for (const date of Object.keys(days)) if (date < floor) delete days[date];
	}

	const sorted: SnapshotFile['days'] = {};
	for (const date of Object.keys(days).sort()) sorted[date] = days[date];

	return { ilceID: city.ilceID, name: city.n, tz: city.tz, days: sorted };
}

/**
 * Diyanet serves Turkey time (UTC+3), so between 21:00 and 24:00 UTC the site's
 * rolling window already starts on tomorrow's UTC date. A snapshot built in that
 * window has no row for today-in-UTC, and cities at negative offsets — which are
 * genuinely still on that date — fall through to the solar model. The scheduled
 * refresh runs at 03:00 UTC precisely to stay clear of this.
 */
function warnIfNearUtcMidnight() {
	const utcHour = new Date().getUTCHours();
	if (utcHour >= 21) {
		console.warn(
			`\n  ⚠ ${utcHour}:00 UTC — Diyanet (UTC+3) has already rolled to tomorrow.\n` +
				`    This snapshot will not contain today's UTC date, and prayer:check\n` +
				`    will fail until UTC midnight. Re-run after 00:00 UTC to be clean.\n`
		);
	}
}

/**
 * The index the app uses to go from city name to snapshot file.
 *
 * Keyed by display name, which is why prayer:select guarantees those names are
 * unique — five were shared across countries, and the collision silently gave
 * one city another's prayer times. Throws rather than writing a lossy index.
 */
function writeIndex(): number {
	const index: Record<string, { ilceID: string; districtName: string; provinceName: string }> = {};
	let expected = 0;
	for (const c of CITIES) {
		if (!existsSync(join(OUT, `${c.ilceID}.json`))) continue;
		expected++;
		index[c.n] = { ilceID: c.ilceID, districtName: c.d[0], provinceName: c.p ?? '' };
	}
	const got = Object.keys(index).length;
	if (got !== expected) {
		throw new Error(
			`index would lose ${expected - got} cities to duplicate display names — ` +
				`re-run prayer:select, which disambiguates them`
		);
	}
	atomicWrite(join(OUT, 'index.json'), JSON.stringify(index, null, 2));
	return got;
}

async function main() {
	mkdirSync(OUT, { recursive: true });
	mkdirSync('data', { recursive: true });
	warnIfNearUtcMidnight();

	const state = loadState();
	const done = new Set(state.done);
	const targets = (only.length ? CITIES.filter(c => only.includes(c.n)) : CITIES).filter(c => !done.has(c.ilceID));

	if (only.length && !targets.length && !done.size) {
		throw new Error(`no city matched ${only.join(', ')}`);
	}
	console.log(
		`${targets.length} cities to fetch` + (done.size ? ` (${done.size} already done, resumed from ${STATE})` : '')
	);

	const failures: { city: string; reason: string }[] = [];
	let n = 0;

	// Rebuild index.json (and the display names inside existing snapshots) from
	// the current cities.json without re-fetching. Needed after prayer:select
	// changes a name, since the snapshot files themselves are keyed by ilceID and
	// do not otherwise need touching.
	if (indexOnly) {
		for (const c of CITIES) {
			const path = join(OUT, `${c.ilceID}.json`);
			if (!existsSync(path)) continue;
			const file = JSON.parse(readFileSync(path, 'utf8')) as SnapshotFile;
			if (file.name !== c.n) {
				file.name = c.n;
				atomicWrite(path, JSON.stringify(file));
			}
		}
		writeIndex();
		return;
	}

	await mapPool(targets, 3, async city => {
		try {
			const html = await getText(city.ilceUrl);
			const parsed = parseCityPage(html);

			const fresh: SnapshotFile['days'] = {};
			for (const day of parsed) {
				fresh[day.date] = [...day.times, day.hijri] as SnapshotDay;
			}

			atomicWrite(join(OUT, `${city.ilceID}.json`), JSON.stringify(merge(city, fresh)));

			done.add(city.ilceID);
			atomicWrite(STATE, JSON.stringify({ done: [...done] }));
		} catch (err) {
			if (err instanceof BlockedError) throw err;
			failures.push({ city: city.n, reason: String(err) });
		}
		if (++n % 50 === 0) console.log(`  ${n}/${targets.length}`);
	});

	const written = writeIndex();
	console.log(`\n${written} cities in the snapshot`);

	// A completed run — even one with some per-city failures logged below —
	// means the next invocation should start fresh rather than resume, since
	// every city was already attempted this pass.
	if (existsSync(STATE)) rmSync(STATE);

	if (failures.length) {
		console.log(`${failures.length} failures:`);
		for (const f of failures.slice(0, 20)) console.log(`  ${f.city}: ${f.reason}`);
	}
}

// Only crawl when run as a script; importing the module must not fire ~724
// requests as a side effect.
if (process.argv[1] && import.meta.filename === process.argv[1]) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
