# Prayer Times Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rate-limited `ezanvakti` API crawl with a scrape of the Diyanet website, growing the globe from 143 hand-curated cities to ~1,200 population-selected cities worldwide, with every displayed prayer time coming from Diyanet.

**Architecture:** Three independently re-runnable stages under `scripts/prayer-data/`. `discover` walks an undocumented JSON endpoint to build the country/state/district tree. `select` cross-references GeoNames `cities15000` against that tree to pick cities and supply the coordinates and IANA timezones Diyanet lacks. `fetch` makes one plain GET per city and parses the 365-row yearly table straight out of the page HTML. The app side changes as little as possible: `snapshot.ts` expands the compact on-disk format back into `VakitRow[]`, so `buildTimetable`, `readout.ts` and every component stay untouched.

**Tech Stack:** TypeScript, Node 22 (`--experimental-strip-types`), Vitest, GitHub Actions, Vercel.

## Global Constraints

- **GET only, no query strings.** A POST and a `?year=2026` both return an identical 385-byte WAF block page. Detect it by content and back off 5 minutes.
- **Concurrency 3, ~2 requests/second.** Realistic `User-Agent`.
- **Writes merge, never replace.** Each run unions its days into the existing file; newly parsed dates win on conflict.
- **Resume is per-run**, tracked in `data/fetch-state.json` by run id — never inferred from "the output file exists".
- **Base URL:** `https://namazvakitleri.diyanet.gov.tr`
- **Prayer order everywhere:** `fajr, sunrise, dhuhr, asr, maghrib, isha` — matching Diyanet's `Imsak, Gunes, Ogle, Ikindi, Aksam, Yatsi`.
- **Coverage requirement:** forward `today → today+25` unbroken (hard); backward `today−1` present unless it precedes the snapshot's earliest captured date.
- Reuse `normalize()` from `src/lib/diyanet.ts` for all name folding. Do not write a second one.

---

## File Structure

**Created:**
- `scripts/prayer-data/http.ts` — polite GET, WAF detection, backoff, concurrency pool. The only file that talks to the network.
- `scripts/prayer-data/parse-page.ts` — pure: city page HTML → day rows.
- `scripts/prayer-data/parse-page.test.ts`
- `scripts/prayer-data/__fixtures__/emmen-tables.html` — trimmed real markup.
- `scripts/prayer-data/discover.ts` — stage 1 driver.
- `scripts/prayer-data/geonames.ts` — download and parse `cities15000`.
- `scripts/prayer-data/match.ts` — pure: country→ISO2 and city→district matching.
- `scripts/prayer-data/match.test.ts`
- `scripts/prayer-data/select-cities.ts` — stage 2 driver.
- `scripts/prayer-data/fetch-times.ts` — stage 3 driver.
- `scripts/prayer-data/coverage.ts` — pure: the coverage gate.
- `scripts/prayer-data/coverage.test.ts`
- `scripts/prayer-data/check-coverage.ts` — CI entry point for the gate.
- `src/data/cities.json` — generated, committed.
- `src/lib/snapshot.test.ts`
- `.github/workflows/refresh-prayer-times.yml`

**Modified:**
- `src/lib/cities.ts` — becomes a thin re-export of the generated JSON.
- `src/lib/snapshot.ts` — expands the compact format into `VakitRow[]`.
- `package.json` — new scripts, `@types/node`.
- `tsconfig.json` — add `scripts` to `include`.
- `.gitignore` — ignore `data/`.
- `README.md` — rewrite the data-source section.
- `src/hooks/queries.ts:71` — stale comment.

**Deleted:**
- `scripts/fetch-times.ts` — superseded by `scripts/prayer-data/fetch-times.ts`.

**Not touched:** `src/lib/diyanet.ts`, `src/lib/readout.ts`, `src/lib/astro.ts`, every component. `src/hooks/util.ts` already has `SCRUB_MIN = 0` / `SCRUB_MAX = 10 * 24 * 60`.

---

### Task 1: Toolchain — typecheck the scripts directory

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json:23`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run typecheck` covers `scripts/`; Node types available to every later task.

- [ ] **Step 1: Install Node types**

```bash
npm install -D @types/node@^22
```

- [ ] **Step 2: Add `scripts` to the typecheck include**

In `tsconfig.json`, replace line 23:

```json
  "include": ["src", "scripts", "vite.config.ts"]
```

- [ ] **Step 3: Verify the existing crawler still typechecks**

Run: `npm run typecheck`
Expected: PASS. If `scripts/fetch-times.ts` reports errors, do not fix them — it is deleted in Task 9. Instead confirm the errors are confined to that file and move on.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "build: typecheck the scripts directory"
```

---

### Task 2: HTTP client — polite, block-aware fetching

**Files:**
- Create: `scripts/prayer-data/http.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SITE: string`
  - `class BlockedError extends Error`
  - `isBlockPage(body: string): boolean`
  - `getText(path: string): Promise<string>`
  - `getJson<T>(path: string): Promise<T>`
  - `mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>`

- [ ] **Step 1: Write the client**

Create `scripts/prayer-data/http.ts`:

```ts
// The only file that talks to namazvakitleri.diyanet.gov.tr.
//
// Two hard rules, both learned by probing the live site:
//   1. GET only. A POST returns a 385-byte WAF block page.
//   2. No query strings on city pages. `?year=2026` returns the same block.
// The block page comes back with HTTP 200, so it must be detected by content.

export const SITE = 'https://namazvakitleri.diyanet.gov.tr'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/** Politeness gap between requests, per worker. */
const GAP_MS = 500
/** How long to stand down once the WAF has objected. */
const BACKOFF_MS = 5 * 60 * 1000

export class BlockedError extends Error {
  constructor(path: string) {
    super(`WAF block page for ${path}`)
    this.name = 'BlockedError'
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The block page is short and titled "İsteğiniz güvenlik kurallarına
 * takılmıştır". Real pages are hundreds of kilobytes, so length alone is a
 * strong signal, but match the title too so a truncated response is not
 * mistaken for a block.
 */
export function isBlockPage(body: string): boolean {
  return body.length < 2000 && body.includes('güvenlik kurallarına takılmıştır')
}

async function request(path: string, attempt = 0): Promise<string> {
  const res = await fetch(SITE + path, { headers: { 'User-Agent': UA } })
  const body = await res.text()

  if (isBlockPage(body) || res.status === 429 || res.status === 403) {
    if (attempt >= 2) throw new BlockedError(path)
    console.warn(`  blocked on ${path}, standing down 5 min`)
    await sleep(BACKOFF_MS)
    return request(path, attempt + 1)
  }

  if (!res.ok) {
    if (attempt >= 2) throw new Error(`${path} → HTTP ${res.status}`)
    await sleep(2000 * (attempt + 1))
    return request(path, attempt + 1)
  }

  await sleep(GAP_MS)
  return body
}

export const getText = (path: string): Promise<string> => request(path)

export async function getJson<T>(path: string): Promise<T> {
  return JSON.parse(await getText(path)) as T
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (ignoring pre-existing `scripts/fetch-times.ts` errors).

- [ ] **Step 3: Commit**

```bash
git add scripts/prayer-data/http.ts
git commit -m "feat: block-aware HTTP client for the Diyanet site"
```

---

### Task 3: Page parser — HTML tables to day rows

The yearly table is 365 rows of real data sitting in the page HTML. This task extracts it. Pure function, no network, fully tested against real markup.

**Files:**
- Create: `scripts/prayer-data/parse-page.ts`
- Create: `scripts/prayer-data/parse-page.test.ts`
- Create: `scripts/prayer-data/__fixtures__/emmen-tables.html`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ParsedDay { date: string; times: [string, string, string, string, string, string]; hijri: string }` — `date` is ISO `YYYY-MM-DD`.
  - `parseCityPage(html: string): ParsedDay[]` — monthly and yearly merged, deduped by date, sorted ascending. Throws if neither table is present.
  - `extractRows(html: string, captionId: string): string[][]`

- [ ] **Step 1: Save the fixture**

Download a real page and trim it to just the two tables, keeping the file small enough to read:

```bash
mkdir -p scripts/prayer-data/__fixtures__
curl -sL -A "Mozilla/5.0" \
  "https://namazvakitleri.diyanet.gov.tr/en-US/13880/prayer-time-for-emmen" \
  -o /tmp/emmen-full.html

node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs"
const h = readFileSync("/tmp/emmen-full.html", "utf8")
const slice = (id) => {
  const a = h.indexOf(`id="${id}"`)
  const start = h.lastIndexOf("<table", a)
  const end = h.indexOf("</table>", a) + "</table>".length
  return h.slice(start, end)
}
writeFileSync(
  "scripts/prayer-data/__fixtures__/emmen-tables.html",
  slice("table-caption-monthly") + "\n" + slice("table-caption-yearly"),
)
'
```

Verify it looks right:

Run: `grep -c '<tr' scripts/prayer-data/__fixtures__/emmen-tables.html`
Expected: `398` (1 monthly header + 31 monthly rows + 1 yearly header + 365 yearly rows)

If the count differs because the calendar has moved on, that is fine — the tests below assert on the yearly table's own first and last dates, read from the fixture, not on hardcoded values. Only the 365 assertion is fixed, and it holds for any non-leap year. If you captured a leap year, use 366 in the test.

- [ ] **Step 2: Write the failing tests**

Create `scripts/prayer-data/parse-page.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCityPage, extractRows } from './parse-page.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = readFileSync(join(here, '__fixtures__', 'emmen-tables.html'), 'utf8')

describe('extractRows', () => {
  it('pulls the yearly table including its header row', () => {
    const rows = extractRows(fixture, 'table-caption-yearly')
    expect(rows[0]).toEqual([
      'Gregorian Calendar Date',
      'Hijri Date',
      'Fajr',
      'Sun',
      'Dhuhr',
      'Asr',
      'Maghrib',
      'Isha',
    ])
    expect(rows).toHaveLength(366)
  })

  it('throws when the caption is absent', () => {
    expect(() => extractRows('<html></html>', 'table-caption-yearly')).toThrow(
      /table-caption-yearly/,
    )
  })
})

describe('parseCityPage', () => {
  const days = parseCityPage(fixture)

  it('returns a full year plus the rolling month, deduped', () => {
    expect(days.length).toBeGreaterThanOrEqual(365)
    const dates = days.map((d) => d.date)
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('converts dd.mm.yyyy to ISO and keeps the six times in order', () => {
    const jan1 = days.find((d) => d.date.endsWith('-01-01'))
    expect(jan1).toBeDefined()
    expect(jan1!.times).toHaveLength(6)
    for (const t of jan1!.times) expect(t).toMatch(/^\d{1,2}:\d{2}$/)
    expect(jan1!.hijri).toMatch(/\d{4}$/)
  })

  it('sorts ascending', () => {
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
    expect(days.map((d) => d.date)).toEqual(sorted.map((d) => d.date))
  })

  it('rejects a row whose times are malformed', () => {
    const broken = fixture.replace('<td>06:37</td>', '<td>oops</td>')
    expect(() => parseCityPage(broken)).toThrow(/malformed/i)
  })

  it('throws when the page has no tables at all', () => {
    expect(() => parseCityPage('<html><body>nothing</body></html>')).toThrow()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run scripts/prayer-data/parse-page.test.ts`
Expected: FAIL — `Failed to resolve import "./parse-page.ts"`

- [ ] **Step 4: Write the parser**

Create `scripts/prayer-data/parse-page.ts`:

```ts
// The Diyanet city page ships its weekly, monthly and yearly tables as plain
// HTML. The yearly one holds 365 rows, so a single GET is a full calendar year
// — the PDF and Excel buttons are DataTables client-side exports of rows that
// are already here, and there is no server-side export to call.

export interface ParsedDay {
  /** ISO YYYY-MM-DD. */
  date: string
  /** fajr, sunrise, dhuhr, asr, maghrib, isha — wall-clock, as published. */
  times: [string, string, string, string, string, string]
  /** e.g. "23 Recep 1448". */
  hijri: string
}

const DDMMYYYY = /^(\d{2})\.(\d{2})\.(\d{4})$/
const HHMM = /^\d{1,2}:\d{2}$/

/** All `<tr>`s of the table carrying `captionId`, as arrays of cell text. */
export function extractRows(html: string, captionId: string): string[][] {
  const anchor = html.indexOf(`id="${captionId}"`)
  if (anchor < 0) throw new Error(`no table with caption ${captionId}`)
  const end = html.indexOf('</table>', anchor)
  if (end < 0) throw new Error(`unterminated table for ${captionId}`)

  const segment = html.slice(anchor, end)
  const rows: string[][] = []
  for (const tr of segment.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
      c[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim(),
    )
    if (cells.length) rows.push(cells)
  }
  return rows
}

function toDays(rows: string[][], captionId: string): ParsedDay[] {
  const days: ParsedDay[] = []
  for (const cells of rows) {
    // Skip the header, which carries no date.
    if (cells.length !== 8 || !DDMMYYYY.test(cells[0])) continue

    const [, d, mo, y] = DDMMYYYY.exec(cells[0])!
    const times = cells.slice(2, 8)
    for (const t of times) {
      if (!HHMM.test(t)) {
        throw new Error(`malformed time "${t}" on ${cells[0]} in ${captionId}`)
      }
    }
    days.push({
      date: `${y}-${mo}-${d}`,
      times: times as ParsedDay['times'],
      hijri: cells[1],
    })
  }
  return days
}

/**
 * Monthly and yearly merged. They overlap once the calendar reaches the
 * published year; the yearly table is applied second and wins, since both come
 * from the same source and disagreement would mean a mid-page correction.
 */
export function parseCityPage(html: string): ParsedDay[] {
  const byDate = new Map<string, ParsedDay>()
  let found = 0

  for (const caption of ['table-caption-monthly', 'table-caption-yearly']) {
    let rows: string[][]
    try {
      rows = extractRows(html, caption)
    } catch {
      continue
    }
    found++
    for (const day of toDays(rows, caption)) byDate.set(day.date, day)
  }

  if (!found) throw new Error('page contained neither a monthly nor a yearly table')
  if (!byDate.size) throw new Error('tables present but no parseable day rows')

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run scripts/prayer-data/parse-page.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/prayer-data/parse-page.ts scripts/prayer-data/parse-page.test.ts \
        scripts/prayer-data/__fixtures__/emmen-tables.html
git commit -m "feat: parse prayer-time tables out of Diyanet city pages"
```

---

### Task 4: Stage 1 — discover the country/state/district tree

**Files:**
- Create: `scripts/prayer-data/discover.ts`
- Modify: `package.json` (scripts)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `getText`, `getJson`, `mapPool`, `SITE` from `./http.ts`.
- Produces:
  - `interface DiyanetDistrict { ilceID: string; name: string; nameEn: string; url: string }`
  - `interface DiyanetState { sehirID: string; name: string; nameEn: string; districts: DiyanetDistrict[] }`
  - `interface DiyanetCountry { countryId: string; name: string; states: DiyanetState[] }`
  - `type DiyanetTree = DiyanetCountry[]`
  - Writes `data/diyanet-tree.json`.

- [ ] **Step 1: Ignore the generated data directory**

Append to `.gitignore`:

```
data
```

`data/` holds the tree, the unmatched report and the per-run fetch state. All three are regenerable, and the tree alone is several megabytes. `src/data/cities.json` and `public/times/` are the generated artefacts that *are* committed; they live outside `data/` for exactly that reason.

- [ ] **Step 2: Write the discoverer**

Create `scripts/prayer-data/discover.ts`:

```ts
// Stage 1: build the full country -> state -> district tree.
//
//   npm run prayer:discover
//
// The dropdowns on the site are backed by an undocumented JSON endpoint:
//   /en-US/home/GetRegList?ChangeType=country&CountryId=13   -> states
//   /en-US/home/GetRegList?ChangeType=state&CountryId=13&StateId=850 -> districts
// The district payload includes IlceUrl, so no slug construction is needed.
//
// ~1,300 requests, ~11 minutes. IDs are stable, so this is run rarely; every
// later stage reads the cached tree.

import { mkdirSync, writeFileSync } from 'node:fs'
import { getText, getJson, mapPool } from './http.ts'

export interface DiyanetDistrict {
  ilceID: string
  name: string
  nameEn: string
  url: string
}

export interface DiyanetState {
  sehirID: string
  name: string
  nameEn: string
  districts: DiyanetDistrict[]
}

export interface DiyanetCountry {
  countryId: string
  name: string
  states: DiyanetState[]
}

export type DiyanetTree = DiyanetCountry[]

interface RegList {
  StateList: { SehirAdi: string; SehirAdiEn: string; SehirID: string }[] | null
  StateRegionList:
    | { IlceAdi: string; IlceAdiEn: string; IlceID: string; IlceUrl: string }[]
    | null
}

/** Any city page carries the full country dropdown. */
const SEED = '/en-US/9206/prayer-time-for-ankara'

function parseCountries(html: string): { countryId: string; name: string }[] {
  const select = /<select[^>]*name="country"[\s\S]*?<\/select>/.exec(html)
  if (!select) throw new Error('country dropdown not found on the seed page')
  return [...select[0].matchAll(/<option value="(\d+)"[^>]*>([^<]+)<\/option>/g)].map((m) => ({
    countryId: m[1],
    name: m[2].trim(),
  }))
}

async function statesOf(countryId: string): Promise<RegList['StateList']> {
  const res = await getJson<RegList>(
    `/en-US/home/GetRegList?ChangeType=country&CountryId=${countryId}`,
  )
  return res.StateList
}

async function districtsOf(countryId: string, stateId: string) {
  const res = await getJson<RegList>(
    `/en-US/home/GetRegList?ChangeType=state&CountryId=${countryId}&StateId=${stateId}`,
  )
  return res.StateRegionList ?? []
}

async function main() {
  const countries = parseCountries(await getText(SEED))
  console.log(`${countries.length} countries`)

  const tree: DiyanetTree = []
  for (const [i, country] of countries.entries()) {
    const states = (await statesOf(country.countryId)) ?? []
    const built = await mapPool(states, 3, async (s) => ({
      sehirID: s.SehirID,
      name: s.SehirAdi,
      nameEn: s.SehirAdiEn,
      districts: (await districtsOf(country.countryId, s.SehirID)).map((d) => ({
        ilceID: d.IlceID,
        name: d.IlceAdi,
        nameEn: d.IlceAdiEn,
        url: d.IlceUrl,
      })),
    }))
    tree.push({ ...country, states: built })

    const n = built.reduce((sum, s) => sum + s.districts.length, 0)
    console.log(`[${i + 1}/${countries.length}] ${country.name}: ${n} districts`)
  }

  mkdirSync('data', { recursive: true })
  writeFileSync('data/diyanet-tree.json', JSON.stringify(tree))

  const districts = tree.reduce(
    (sum, c) => sum + c.states.reduce((s, st) => s + st.districts.length, 0),
    0,
  )
  console.log(`\nwrote data/diyanet-tree.json — ${tree.length} countries, ${districts} districts`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 3: Register the script**

In `package.json`, add to `"scripts"`:

```json
    "prayer:discover": "node --experimental-strip-types scripts/prayer-data/discover.ts",
```

- [ ] **Step 4: Run it**

Run: `npm run prayer:discover`
Expected: roughly 11 minutes of per-country progress lines, ending with a summary naming 300+ countries and tens of thousands of districts. It is safe to let this run while reviewing the next task.

Sanity-check the output:

Run: `node -e "const t=require('./data/diyanet-tree.json'); const nl=t.find(c=>c.name==='NETHERLANDS'); console.log(nl.states[0].districts.find(d=>d.nameEn==='EMMEN'))"`
Expected: an object with `ilceID: '13880'` and `url: '/en-US/13880/prayer-time-for-emmen'`.

- [ ] **Step 5: Commit**

```bash
git add scripts/prayer-data/discover.ts package.json .gitignore
git commit -m "feat: discover the Diyanet country/state/district tree"
```

---

### Task 5: GeoNames loader

**Files:**
- Create: `scripts/prayer-data/geonames.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface GeoCity { name: string; ascii: string; alt: string[]; lat: number; lon: number; featureCode: string; iso2: string; pop: number; tz: string }`
  - `loadGeoNames(): Promise<GeoCity[]>` — downloads and caches `data/cities15000.txt`.

**Requires `unzip` on PATH.** Present by default on macOS and on GitHub's `ubuntu-latest`. This stage runs locally and rarely; CI runs only stage 3, so this is not a CI dependency.

- [ ] **Step 1: Write the loader**

Create `scripts/prayer-data/geonames.ts`:

```ts
// GeoNames supplies the three things Diyanet does not publish: coordinates,
// population, and the IANA timezone. cities15000 is every city over 15,000
// people — about 30,000 rows.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'

const URL = 'https://download.geonames.org/export/dump/cities15000.zip'
const ZIP = 'data/cities15000.zip'
const TXT = 'data/cities15000.txt'

export interface GeoCity {
  name: string
  ascii: string
  alt: string[]
  lat: number
  lon: number
  /** PPLC marks a national capital. */
  featureCode: string
  iso2: string
  pop: number
  tz: string
}

export async function loadGeoNames(): Promise<GeoCity[]> {
  mkdirSync('data', { recursive: true })

  if (!existsSync(TXT)) {
    console.log('downloading cities15000.zip …')
    const res = await fetch(URL)
    if (!res.ok) throw new Error(`GeoNames → HTTP ${res.status}`)
    writeFileSync(ZIP, Buffer.from(await res.arrayBuffer()))
    writeFileSync(TXT, execFileSync('unzip', ['-p', ZIP, 'cities15000.txt'], {
      maxBuffer: 128 * 1024 * 1024,
    }))
  }

  const cities: GeoCity[] = []
  for (const line of readFileSync(TXT, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const f = line.split('\t')
    cities.push({
      name: f[1],
      ascii: f[2],
      alt: f[3] ? f[3].split(',') : [],
      lat: Number(f[4]),
      lon: Number(f[5]),
      featureCode: f[7],
      iso2: f[8],
      pop: Number(f[14]),
      tz: f[17],
    })
  }
  console.log(`${cities.length} GeoNames cities`)
  return cities
}
```

- [ ] **Step 2: Verify it loads**

Run: `node --experimental-strip-types -e "import('./scripts/prayer-data/geonames.ts').then(async m => { const c = await m.loadGeoNames(); const e = c.find(x => x.ascii === 'Emmen' && x.iso2 === 'NL'); console.log(e) })"`
Expected: an object for Emmen with `tz: 'Europe/Amsterdam'` and a non-zero `pop`.

- [ ] **Step 3: Commit**

```bash
git add scripts/prayer-data/geonames.ts
git commit -m "feat: load GeoNames cities15000 for coordinates and timezones"
```

---

### Task 6: Matching — countries to ISO2, cities to districts

The trap this guards against: a name-only match sends "Los Angeles" to Los Angeles, **Chile**. Matching is always scoped inside one country.

**Files:**
- Create: `scripts/prayer-data/match.ts`
- Create: `scripts/prayer-data/match.test.ts`

**Interfaces:**
- Consumes: `normalize` from `../../src/lib/diyanet.ts`; `DiyanetDistrict` from `./discover.ts`; `GeoCity` from `./geonames.ts`.
- Produces:
  - `countryIso2(diyanetName: string): string | null`
  - `matchDistrict(city: GeoCity, districts: DiyanetDistrict[]): DiyanetDistrict | null`

- [ ] **Step 1: Write the failing tests**

Create `scripts/prayer-data/match.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { countryIso2, matchDistrict } from './match.ts'
import type { DiyanetDistrict } from './discover.ts'
import type { GeoCity } from './geonames.ts'

const district = (nameEn: string, name = nameEn, ilceID = '1'): DiyanetDistrict => ({
  ilceID,
  name,
  nameEn,
  url: `/en-US/${ilceID}/x`,
})

const city = (over: Partial<GeoCity>): GeoCity => ({
  name: 'X',
  ascii: 'X',
  alt: [],
  lat: 0,
  lon: 0,
  featureCode: 'PPL',
  iso2: 'XX',
  pop: 1,
  tz: 'UTC',
  ...over,
})

describe('countryIso2', () => {
  it('resolves plain English names', () => {
    expect(countryIso2('NETHERLANDS')).toBe('NL')
    expect(countryIso2('GERMANY')).toBe('DE')
  })

  it('resolves the Turkish-flavoured names in the dropdown', () => {
    expect(countryIso2('HOLLANDA')).toBe('NL')
    expect(countryIso2('USA')).toBe('US')
    expect(countryIso2('S. ARABISTAN')).toBe('SA')
  })

  it('returns null for entries that are not countries', () => {
    expect(countryIso2('ATLANTIC OCEAN')).toBeNull()
  })
})

describe('matchDistrict', () => {
  it('matches on the English name', () => {
    const d = [district('EMMEN')]
    expect(matchDistrict(city({ ascii: 'Emmen' }), d)?.ilceID).toBe('1')
  })

  it('folds diacritics and Turkish dotted I', () => {
    const d = [district('ISTANBUL', 'İSTANBUL')]
    expect(matchDistrict(city({ ascii: 'Istanbul', name: 'İstanbul' }), d)).not.toBeNull()
  })

  it('bridges transliterations through GeoNames alternate names', () => {
    const d = [district('MECCA', 'MEKKE')]
    const c = city({ ascii: 'Mecca', alt: ['Makkah', 'Mekke'] })
    expect(matchDistrict(c, d)?.ilceID).toBe('1')
  })

  it('prefers an exact name match over an alternate-name match', () => {
    const d = [district('MAKKAH', 'MAKKAH', 'alt'), district('MECCA', 'MEKKE', 'exact')]
    expect(matchDistrict(city({ ascii: 'Mecca', alt: ['Makkah'] }), d)?.ilceID).toBe('exact')
  })

  it('returns null rather than guessing', () => {
    expect(matchDistrict(city({ ascii: 'Nowhere' }), [district('EMMEN')])).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/prayer-data/match.test.ts`
Expected: FAIL — cannot resolve `./match.ts`.

- [ ] **Step 3: Write the matcher**

Create `scripts/prayer-data/match.ts`:

```ts
// Diyanet names cities in a mix of English and Turkish transliteration; the
// dropdown holds "NETHERLANDS" but the state under it is "HOLLANDA", and Mecca
// appears as MECCA, MEKKE or MAKKAH depending on where you look.
//
// normalize() already folds diacritics and the Turkish dotted I for the live
// app, so it is reused here rather than reimplemented.

import { normalize } from '../../src/lib/diyanet.ts'
import type { DiyanetDistrict } from './discover.ts'
import type { GeoCity } from './geonames.ts'

/** Diyanet spellings that Intl.DisplayNames will never produce. */
const COUNTRY_OVERRIDES: Record<string, string> = {
  USA: 'US',
  HOLLANDA: 'NL',
  INGILTERE: 'GB',
  ALMANYA: 'DE',
  'S ARABISTAN': 'SA',
  'SUUDI ARABISTAN': 'SA',
  KKTC: 'CY',
  BOLIVYA: 'BO',
  'ANTIGUA VE BARBUDA': 'AG',
  'BOSNIAHERZEGOVINA': 'BA',
  'BOSNAHERSEK': 'BA',
  MACARISTAN: 'HU',
  YUNANISTAN: 'GR',
  ISVICRE: 'CH',
  ISVEC: 'SE',
  RUSYA: 'RU',
  MISIR: 'EG',
  URDUN: 'JO',
  IRAK: 'IQ',
  IRAN: 'IR',
  CIN: 'CN',
  HINDISTAN: 'IN',
  JAPONYA: 'JP',
  KANADA: 'CA',
  BREZILYA: 'BR',
  ARJANTIN: 'AR',
  'GUNEY AFRIKA': 'ZA',
  'CEK CUMHURIYETI': 'CZ',
  TURKIYE: 'TR',
}

/** ISO2 -> normalised English name, built once from the runtime's own data. */
const BY_ENGLISH_NAME: Map<string, string> = (() => {
  const display = new Intl.DisplayNames(['en'], { type: 'region' })
  const map = new Map<string, string>()
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const iso2 = String.fromCharCode(a, b)
      let name: string | undefined
      try {
        name = display.of(iso2)
      } catch {
        continue
      }
      // Unknown codes echo themselves back.
      if (!name || name === iso2) continue
      map.set(normalize(name), iso2)
    }
  }
  return map
})()

export function countryIso2(diyanetName: string): string | null {
  const key = normalize(diyanetName)
  return COUNTRY_OVERRIDES[key] ?? BY_ENGLISH_NAME.get(key) ?? null
}

/**
 * Match one GeoNames city to a district from the *same country's* list. Exact
 * names are tried across every district before alternate names are considered,
 * so "Mecca" prefers a district actually called MECCA over one called MAKKAH.
 */
export function matchDistrict(
  city: GeoCity,
  districts: DiyanetDistrict[],
): DiyanetDistrict | null {
  const exact = new Set([normalize(city.name), normalize(city.ascii)])
  exact.delete('')

  for (const d of districts) {
    if (exact.has(normalize(d.nameEn)) || exact.has(normalize(d.name))) return d
  }

  const alt = new Set(city.alt.map(normalize))
  alt.delete('')
  if (!alt.size) return null

  for (const d of districts) {
    if (alt.has(normalize(d.nameEn)) || alt.has(normalize(d.name))) return d
  }
  return null
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run scripts/prayer-data/match.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/prayer-data/match.ts scripts/prayer-data/match.test.ts
git commit -m "feat: match GeoNames cities to Diyanet districts within a country"
```

---

### Task 7: Stage 2 — select the cities

**Files:**
- Create: `scripts/prayer-data/select-cities.ts`
- Create: `src/data/cities.json` (generated)
- Modify: `package.json`

**Interfaces:**
- Consumes: `loadGeoNames`, `countryIso2`, `matchDistrict`, `DiyanetTree`.
- Produces:
  - `interface SelectedCity { n: string; la: number; lo: number; tz: string; iso2: string; country: string; pop: number; ilceID: string; ilceUrl: string; u: number; p: string; d: string[] }`
  - Writes `src/data/cities.json` and `data/unmatched.json`.

`u`, `p` and `d` are carried so the existing live-API fallback in `src/lib/diyanet.ts` keeps compiling and working unchanged. `u` is Diyanet's `CountryId`, `p` the state name, `d` the matched district name.

- [ ] **Step 1: Write the selector**

Create `scripts/prayer-data/select-cities.ts`:

```ts
// Stage 2: decide which cities the globe shows. Touches no Diyanet endpoint —
// it reads the cached tree from stage 1.
//
//   npm run prayer:select              # capital + top 5 per country
//   npm run prayer:select -- --per 10  # capital + top 10
//
// Everything that fails to match is written to data/unmatched.json rather than
// guessed at. A city with no Diyanet district must not reach the globe: the app
// promises Diyanet times for every dot it draws.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { loadGeoNames } from './geonames.ts'
import type { GeoCity } from './geonames.ts'
import { countryIso2, matchDistrict } from './match.ts'
import type { DiyanetTree, DiyanetDistrict } from './discover.ts'

export interface SelectedCity {
  n: string
  la: number
  lo: number
  tz: string
  iso2: string
  country: string
  pop: number
  ilceID: string
  ilceUrl: string
  /** Diyanet CountryId — kept so the live-API fallback still resolves. */
  u: number
  p: string
  d: string[]
}

const perCountryArg = process.argv.indexOf('--per')
const PER_COUNTRY = perCountryArg > -1 ? Number(process.argv[perCountryArg + 1]) : 5

function pick(cities: GeoCity[]): GeoCity[] {
  const byPop = [...cities].sort((a, b) => b.pop - a.pop)
  const chosen = byPop.filter((c) => c.featureCode === 'PPLC').slice(0, 1)
  for (const c of byPop) {
    if (chosen.length >= PER_COUNTRY + 1) break
    if (!chosen.includes(c)) chosen.push(c)
  }
  return chosen
}

async function main() {
  const tree = JSON.parse(readFileSync('data/diyanet-tree.json', 'utf8')) as DiyanetTree
  const geo = await loadGeoNames()

  // Diyanet country -> ISO2, and the flattened district list for that country.
  const byIso2 = new Map<string, { country: DiyanetTree[number]; districts: DiyanetDistrict[]; stateOf: Map<string, string> }>()
  const unresolvedCountries: string[] = []

  for (const country of tree) {
    const iso2 = countryIso2(country.name)
    if (!iso2) {
      unresolvedCountries.push(country.name)
      continue
    }
    const districts: DiyanetDistrict[] = []
    const stateOf = new Map<string, string>()
    for (const state of country.states) {
      for (const d of state.districts) {
        districts.push(d)
        stateOf.set(d.ilceID, state.name)
      }
    }
    byIso2.set(iso2, { country, districts, stateOf })
  }

  const geoByIso2 = new Map<string, GeoCity[]>()
  for (const c of geo) {
    if (!geoByIso2.has(c.iso2)) geoByIso2.set(c.iso2, [])
    geoByIso2.get(c.iso2)!.push(c)
  }

  const selected: SelectedCity[] = []
  const unmatchedCities: { name: string; iso2: string; pop: number }[] = []

  for (const [iso2, cities] of geoByIso2) {
    const entry = byIso2.get(iso2)
    if (!entry) continue

    for (const city of pick(cities)) {
      const district = matchDistrict(city, entry.districts)
      if (!district) {
        unmatchedCities.push({ name: city.ascii, iso2, pop: city.pop })
        continue
      }
      selected.push({
        n: city.ascii,
        la: Number(city.lat.toFixed(4)),
        lo: Number(city.lon.toFixed(4)),
        tz: city.tz,
        iso2,
        country: entry.country.name,
        pop: city.pop,
        ilceID: district.ilceID,
        ilceUrl: district.url,
        u: Number(entry.country.countryId),
        p: entry.stateOf.get(district.ilceID) ?? '',
        d: [district.nameEn || district.name],
      })
    }
  }

  // A district serving two selected cities would fetch the same page twice and
  // draw two dots on one timetable. Keep the larger city.
  const byIlceID = new Map<string, SelectedCity>()
  for (const c of selected.sort((a, b) => b.pop - a.pop)) {
    if (!byIlceID.has(c.ilceID)) byIlceID.set(c.ilceID, c)
  }
  const final = [...byIlceID.values()].sort((a, b) => a.n.localeCompare(b.n))

  mkdirSync('src/data', { recursive: true })
  writeFileSync('src/data/cities.json', JSON.stringify(final, null, 2))
  writeFileSync(
    'data/unmatched.json',
    JSON.stringify({ countries: unresolvedCountries, cities: unmatchedCities }, null, 2),
  )

  console.log(`selected ${final.length} cities across ${byIso2.size} countries`)
  console.log(`unmatched: ${unresolvedCountries.length} countries, ${unmatchedCities.length} cities`)
  console.log('review data/unmatched.json')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Register the script**

In `package.json`, add:

```json
    "prayer:select": "node --experimental-strip-types scripts/prayer-data/select-cities.ts",
```

- [ ] **Step 3: Run it**

Run: `npm run prayer:select`
Expected: `selected 1000–1400 cities across 190+ countries`, plus an unmatched count.

- [ ] **Step 4: Review the unmatched report and extend the overrides**

Run: `node -e "const u=require('./data/unmatched.json'); console.log(u.countries); console.log(u.cities.filter(c=>c.pop>1e6))"`

Expected: the country list should contain only genuine non-countries (`ATLANTIC OCEAN`, `ASCENSION`, ocean and territory entries). **Any real country in that list is a bug** — add it to `COUNTRY_OVERRIDES` in `match.ts` and re-run `npm run prayer:select`.

Done-criterion: no country with a population over 1 million appears in `unmatched.countries`, and every unmatched city over 1 million is one you have looked at and confirmed Diyanet genuinely does not publish.

- [ ] **Step 5: Spot-check known cities**

Run: `node -e "const c=require('./src/data/cities.json'); for (const n of ['Mecca','Istanbul','London','Emmen','Jakarta']) console.log(c.find(x=>x.n===n))"`
Expected: each resolves, with a plausible `ilceID`, a correct `tz`, and coordinates matching the real city.

- [ ] **Step 6: Commit**

```bash
git add scripts/prayer-data/select-cities.ts src/data/cities.json package.json scripts/prayer-data/match.ts
git commit -m "feat: select ~1,200 major cities matched to Diyanet districts"
```

---

### Task 8: Point the app at the generated city list

**Files:**
- Modify: `src/lib/cities.ts` (full rewrite)

**Interfaces:**
- Consumes: `src/data/cities.json`.
- Produces: `interface City` gains `tz`, `iso2`, `country`, `pop`, `ilceID`, `ilceUrl`; keeps `n`, `la`, `lo`, `u`, `p`, `d`. `CITIES: City[]` export is unchanged in name and type shape.

- [ ] **Step 1: Rewrite cities.ts**

Replace the entire contents of `src/lib/cities.ts`:

```ts
// Generated by `npm run prayer:select` — do not hand-edit.
//
// Cities are chosen as the capital plus the most populous few per country,
// from GeoNames cities15000, and every one of them has been matched to a real
// Diyanet district. A city with no district never reaches this list, because
// the globe promises Diyanet times for every dot it draws.
//
// GeoNames also supplies what Diyanet does not publish: coordinates for the
// globe, and the IANA timezone the snapshot uses to derive each day's UTC
// offset.

import data from '../data/cities.json'

export interface City {
  /** Display name. */
  n: string
  /** Latitude, degrees north. */
  la: number
  /** Longitude, degrees east. */
  lo: number
  /** IANA timezone, e.g. "Europe/Amsterdam". */
  tz: string
  iso2: string
  country: string
  pop: number
  /** Diyanet district id — the snapshot filename. */
  ilceID: string
  ilceUrl: string
  /** Diyanet UlkeID, retained for the live-API fallback. */
  u: number
  /** Province/SehirAdi, retained for the live-API fallback. */
  p?: string
  /** Candidate district names, retained for the live-API fallback. */
  d: string[]
}

export const CITIES: City[] = data as City[]
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If a component reads a field the old `City` had and the new one lacks, the error names it — the only removed field is nothing, so no errors are expected.

- [ ] **Step 3: Run the existing tests**

Run: `npm test`
Expected: PASS — `src/lib/astro.test.ts` plus the two new suites.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cities.ts
git commit -m "feat: drive the globe from the generated city list"
```

---

### Task 9: Stage 3 — fetch, merge, and write the snapshot

**Files:**
- Create: `scripts/prayer-data/fetch-times.ts`
- Delete: `scripts/fetch-times.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `getText`, `mapPool`, `BlockedError` from `./http.ts`; `parseCityPage` from `./parse-page.ts`; `CITIES` from `../../src/lib/cities.ts`.
- Produces:
  - `interface SnapshotFile { ilceID: string; name: string; tz: string; days: Record<string, [string, string, string, string, string, string, string]> }` — six times then the Hijri string.
  - Writes `public/times/{ilceID}.json` and `public/times/index.json`.

- [ ] **Step 1: Write the fetcher**

Create `scripts/prayer-data/fetch-times.ts`:

```ts
// Stage 3: one plain GET per city, parsed into public/times/.
//
//   npm run prayer:fetch                  # every selected city
//   npm run prayer:fetch -- --only Emmen  # just these
//   npm run prayer:fetch -- --prune       # also drop days older than 2 days
//
// A run yields the rolling ~31-day window plus all 365 days of the published
// next year. Writes MERGE: each run contributes a different 30 days, and
// Diyanet serves no archive, so overwriting would permanently narrow the
// snapshot to whatever the last run happened to see.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getText, mapPool, BlockedError } from './http.ts'
import { parseCityPage } from './parse-page.ts'
import { CITIES } from '../../src/lib/cities.ts'
import type { City } from '../../src/lib/cities.ts'

export type SnapshotDay = [string, string, string, string, string, string, string]

export interface SnapshotFile {
  ilceID: string
  name: string
  tz: string
  /** ISO date -> [fajr, sunrise, dhuhr, asr, maghrib, isha, hijri] */
  days: Record<string, SnapshotDay>
}

const OUT = 'public/times'
const STATE = 'data/fetch-state.json'
/** Yesterday is still needed: a city at UTC-11 is on the previous local date. */
const KEEP_DAYS_BACK = 2

const args = process.argv.slice(2)
const prune = args.includes('--prune')
const onlyIdx = args.indexOf('--only')
const only = onlyIdx > -1 ? args.slice(onlyIdx + 1).filter((a) => !a.startsWith('--')) : []

/** A stable id for this run, so resume never spans two different runs. */
const RUN_ID = new Date().toISOString().slice(0, 13)

interface RunState {
  runId: string
  done: string[]
}

function loadState(): RunState {
  if (!existsSync(STATE)) return { runId: RUN_ID, done: [] }
  const prev = JSON.parse(readFileSync(STATE, 'utf8')) as RunState
  return prev.runId === RUN_ID ? prev : { runId: RUN_ID, done: [] }
}

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function merge(city: City, fresh: SnapshotFile['days']): SnapshotFile {
  const path = join(OUT, `${city.ilceID}.json`)
  let days: SnapshotFile['days'] = {}
  if (existsSync(path)) {
    try {
      days = (JSON.parse(readFileSync(path, 'utf8')) as SnapshotFile).days ?? {}
    } catch {
      days = {}
    }
  }

  // Fresh wins, so a Diyanet correction propagates.
  Object.assign(days, fresh)

  if (prune) {
    const floor = isoDaysAgo(KEEP_DAYS_BACK)
    for (const date of Object.keys(days)) if (date < floor) delete days[date]
  }

  const sorted: SnapshotFile['days'] = {}
  for (const date of Object.keys(days).sort()) sorted[date] = days[date]

  return { ilceID: city.ilceID, name: city.n, tz: city.tz, days: sorted }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  mkdirSync('data', { recursive: true })

  const state = loadState()
  const done = new Set(state.done)
  const targets = (only.length ? CITIES.filter((c) => only.includes(c.n)) : CITIES).filter(
    (c) => !done.has(c.ilceID),
  )

  if (only.length && !targets.length && !done.size) {
    throw new Error(`no city matched ${only.join(', ')}`)
  }
  console.log(`${targets.length} cities to fetch (${done.size} already done this run)`)

  const failures: { city: string; reason: string }[] = []
  let n = 0

  await mapPool(targets, 3, async (city) => {
    try {
      const html = await getText(city.ilceUrl)
      const parsed = parseCityPage(html)

      const fresh: SnapshotFile['days'] = {}
      for (const day of parsed) {
        fresh[day.date] = [...day.times, day.hijri] as SnapshotDay
      }

      writeFileSync(
        join(OUT, `${city.ilceID}.json`),
        JSON.stringify(merge(city, fresh)),
      )

      done.add(city.ilceID)
      writeFileSync(STATE, JSON.stringify({ runId: RUN_ID, done: [...done] }))
    } catch (err) {
      if (err instanceof BlockedError) throw err
      failures.push({ city: city.n, reason: String(err) })
    }
    if (++n % 50 === 0) console.log(`  ${n}/${targets.length}`)
  })

  // The index the app uses to go from city name to snapshot file.
  const index: Record<string, { ilceID: string; districtName: string; provinceName: string }> = {}
  for (const c of CITIES) {
    if (existsSync(join(OUT, `${c.ilceID}.json`))) {
      index[c.n] = { ilceID: c.ilceID, districtName: c.d[0], provinceName: c.p ?? '' }
    }
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2))

  console.log(`\n${Object.keys(index).length} cities in the snapshot`)
  if (failures.length) {
    console.log(`${failures.length} failures:`)
    for (const f of failures.slice(0, 20)) console.log(`  ${f.city}: ${f.reason}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Replace the old crawler**

```bash
git rm scripts/fetch-times.ts
```

In `package.json`, delete the `"fetch-times"` script and add:

```json
    "prayer:fetch": "node --experimental-strip-types scripts/prayer-data/fetch-times.ts",
```

- [ ] **Step 3: Fetch a single city and inspect it**

Run: `npm run prayer:fetch -- --only Emmen`
Expected: `1 cities to fetch`, then `… cities in the snapshot`.

Run: `node -e "const f=require('./public/times/13880.json'); const d=Object.keys(f.days); console.log(f.tz, d.length, d[0], d[d.length-1]); console.log(f.days[d[0]])"`
Expected: `Europe/Amsterdam`, ~396 dates, and a row of six `HH:MM` strings plus a Hijri string.

- [ ] **Step 4: Prove the merge accretes rather than replaces**

```bash
node -e "
const fs=require('fs'), p='public/times/13880.json'
const f=JSON.parse(fs.readFileSync(p))
f.days['1999-01-01']=['1:00','2:00','3:00','4:00','5:00','6:00','sentinel']
fs.writeFileSync(p, JSON.stringify(f))
"
rm -f data/fetch-state.json
npm run prayer:fetch -- --only Emmen
node -e "const f=require('./public/times/13880.json'); console.log(f.days['1999-01-01'] ? 'MERGED' : 'LOST')"
```

Expected: `MERGED`. If it prints `LOST`, the write is replacing instead of merging — the single most important bug this plan guards against. Fix before continuing.

Then clean up the sentinel:

```bash
node -e "
const fs=require('fs'), p='public/times/13880.json'
const f=JSON.parse(fs.readFileSync(p)); delete f.days['1999-01-01']
fs.writeFileSync(p, JSON.stringify(f))
"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/prayer-data/fetch-times.ts package.json public/times
git rm --cached scripts/fetch-times.ts 2>/dev/null || true
git commit -m "feat: crawl prayer times from the Diyanet website, merging on write"
```

---

### Task 10: Read the compact snapshot in the app

The compact format is expanded back into `VakitRow[]`, with `MiladiTarihUzunIso8601` synthesized from the IANA timezone. That is the exact field `parseDay` already reads the UTC offset from, so `buildTimetable`, `readout.ts` and every component keep working untouched — and DST is handled by `Intl`, correctly, per date.

**Files:**
- Modify: `src/lib/snapshot.ts`
- Create: `src/lib/snapshot.test.ts`

**Interfaces:**
- Consumes: `VakitRow`, `ResolvedDistrict` from `./diyanet.ts`.
- Produces:
  - `offsetMinutesFor(tz: string, isoDate: string): number`
  - `toVakitRows(file: SnapshotFile): VakitRow[]`
  - `loadTimetable(ilceID: string): Promise<VakitRow[] | null>` — signature unchanged.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { offsetMinutesFor, toVakitRows } from './snapshot'
import { buildTimetable } from './diyanet'

describe('offsetMinutesFor', () => {
  it('follows DST across the year', () => {
    expect(offsetMinutesFor('Europe/London', '2027-01-15')).toBe(0)
    expect(offsetMinutesFor('Europe/London', '2027-07-15')).toBe(60)
  })

  it('handles zones that never shift', () => {
    expect(offsetMinutesFor('Europe/Istanbul', '2027-01-15')).toBe(180)
    expect(offsetMinutesFor('Europe/Istanbul', '2027-07-15')).toBe(180)
  })

  it('handles negative and half-hour offsets', () => {
    expect(offsetMinutesFor('America/New_York', '2027-01-15')).toBe(-300)
    expect(offsetMinutesFor('Asia/Kolkata', '2027-01-15')).toBe(330)
  })

  it('returns 0 for UTC', () => {
    expect(offsetMinutesFor('UTC', '2027-01-15')).toBe(0)
  })
})

describe('toVakitRows', () => {
  const file = {
    ilceID: '13880',
    name: 'Emmen',
    tz: 'Europe/Amsterdam',
    days: {
      '2027-01-01': ['06:37', '08:38', '12:41', '14:15', '16:34', '18:21', '23 Recep 1448'],
      '2027-07-01': ['03:30', '05:25', '13:40', '17:50', '21:55', '23:30', '26 Muharrem 1449'],
    },
  } as const

  it('maps the compact row onto Diyanet field names', () => {
    const rows = toVakitRows(file as never)
    expect(rows[0].Imsak).toBe('06:37')
    expect(rows[0].Gunes).toBe('08:38')
    expect(rows[0].Ogle).toBe('12:41')
    expect(rows[0].Ikindi).toBe('14:15')
    expect(rows[0].Aksam).toBe('16:34')
    expect(rows[0].Yatsi).toBe('18:21')
    expect(rows[0].HicriTarihUzun).toBe('23 Recep 1448')
  })

  it('synthesizes the ISO date with the zone offset that day', () => {
    const rows = toVakitRows(file as never)
    expect(rows[0].MiladiTarihUzunIso8601).toBe('2027-01-01T00:00:00.0000000+01:00')
    expect(rows[1].MiladiTarihUzunIso8601).toBe('2027-07-01T00:00:00.0000000+02:00')
  })

  it('feeds buildTimetable so the app gets correct UTC instants', () => {
    const days = buildTimetable(toVakitRows(file as never), 0)
    expect(days).toHaveLength(2)
    expect(days[0].offsetMin).toBe(60)
    // 06:37 local at +01:00 is 05:37 UTC.
    expect(new Date(days[0].utc.fajr!).toISOString()).toBe('2027-01-01T05:37:00.000Z')
    expect(days[0].hijri).toBe('23 Recep 1448')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/snapshot.test.ts`
Expected: FAIL — `offsetMinutesFor` is not exported.

- [ ] **Step 3: Rewrite snapshot.ts**

Replace the entire contents of `src/lib/snapshot.ts`:

```ts
// Reads the pre-fetched dataset in public/times/, produced by
// `npm run prayer:fetch`.
//
// The files are stored compactly — one array per day rather than Diyanet's
// verbose row objects, which is the difference between ~26 MB and ~250 MB
// across 1,200 cities. They are expanded back into VakitRow here, with
// MiladiTarihUzunIso8601 synthesized from the city's IANA timezone, because
// that is the field buildTimetable already reads each day's UTC offset from.
// Nothing downstream needs to know the format changed.

import type { ResolvedDistrict, VakitRow } from './diyanet'

export type SnapshotIndex = Record<string, ResolvedDistrict>

/** [fajr, sunrise, dhuhr, asr, maghrib, isha, hijri] */
export type SnapshotDay = [string, string, string, string, string, string, string]

export interface SnapshotFile {
  ilceID: string
  name: string
  tz: string
  days: Record<string, SnapshotDay>
}

const base = import.meta.env.BASE_URL

/**
 * Minutes east of UTC for `tz` on `isoDate`. Probed at midday so a DST
 * transition — which happens in the small hours — never lands on the boundary.
 */
export function offsetMinutesFor(tz: string, isoDate: string): number {
  const probe = new Date(`${isoDate}T12:00:00Z`)
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(probe)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'

  const m = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(name)
  if (!m) return 0 // Plain "GMT" — zero offset.
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}

function isoWithOffset(date: string, offsetMin: number): string {
  const sign = offsetMin < 0 ? '-' : '+'
  const abs = Math.abs(offsetMin)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `${date}T00:00:00.0000000${sign}${hh}:${mm}`
}

export function toVakitRows(file: SnapshotFile): VakitRow[] {
  const rows: VakitRow[] = []
  for (const date of Object.keys(file.days).sort()) {
    const day = file.days[date]
    rows.push({
      Imsak: day[0],
      Gunes: day[1],
      Ogle: day[2],
      Ikindi: day[3],
      Aksam: day[4],
      Yatsi: day[5],
      HicriTarihUzun: day[6],
      MiladiTarihUzunIso8601: isoWithOffset(date, offsetMinutesFor(file.tz, date)),
    })
  }
  return rows
}

/** The city -> district map, or null when no snapshot has been built. */
export async function loadIndex(): Promise<SnapshotIndex | null> {
  try {
    const res = await fetch(`${base}times/index.json`)
    if (!res.ok) return null
    const data = (await res.json()) as SnapshotIndex
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

/** One district's timetable from the snapshot, or null to fall back to live. */
export async function loadTimetable(ilceID: string): Promise<VakitRow[] | null> {
  try {
    const res = await fetch(`${base}times/${ilceID}.json`)
    if (!res.ok) return null
    const file = (await res.json()) as SnapshotFile
    if (!file || typeof file !== 'object' || !file.days || !file.tz) return null
    const rows = toVakitRows(file)
    return rows.length ? rows : null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/snapshot.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Full test run and typecheck**

Run: `npm test && npm run typecheck`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/snapshot.ts src/lib/snapshot.test.ts
git commit -m "feat: expand the compact snapshot into VakitRow with tz-derived offsets"
```

---

### Task 11: The coverage gate

This is what enforces "no computed times". It matters more than any other test here.

**Files:**
- Create: `scripts/prayer-data/coverage.ts`
- Create: `scripts/prayer-data/coverage.test.ts`
- Create: `scripts/prayer-data/check-coverage.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface CoverageProblem { ilceID: string; name: string; reason: string }`
  - `checkCoverage(files: SnapshotFile[], today: string, forwardDays?: number): CoverageProblem[]`

- [ ] **Step 1: Write the failing tests**

Create `scripts/prayer-data/coverage.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkCoverage } from './coverage.ts'

const day = ['05:00', '06:00', '13:00', '17:00', '20:00', '21:30', '1 Recep 1448'] as const

/** A file covering [from, to] inclusive, as ISO dates. */
function file(from: string, to: string, opts: { skip?: string } = {}) {
  const days: Record<string, unknown> = {}
  for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    if (iso !== opts.skip) days[iso] = [...day]
  }
  return { ilceID: '1', name: 'Test', tz: 'UTC', days } as never
}

describe('checkCoverage', () => {
  const today = '2026-08-15'

  it('passes a snapshot covering yesterday through today+25', () => {
    expect(checkCoverage([file('2026-08-14', '2026-09-20')], today)).toEqual([])
  })

  it('fails when the forward window is too short', () => {
    const problems = checkCoverage([file('2026-08-14', '2026-09-01')], today)
    expect(problems).toHaveLength(1)
    expect(problems[0].reason).toMatch(/missing 2026-09-02/)
  })

  it('fails on a hole inside the forward window', () => {
    const problems = checkCoverage([file('2026-08-14', '2026-09-20', { skip: '2026-08-20' })], today)
    expect(problems[0].reason).toMatch(/missing 2026-08-20/)
  })

  it('fails when yesterday is missing but earlier dates exist', () => {
    const problems = checkCoverage([file('2026-08-10', '2026-09-20', { skip: '2026-08-14' })], today)
    expect(problems[0].reason).toMatch(/2026-08-14/)
  })

  it('grandfathers yesterday when it precedes the earliest capture', () => {
    // A first run: the snapshot starts today, so yesterday was never obtainable.
    expect(checkCoverage([file('2026-08-15', '2026-09-20')], today)).toEqual([])
  })

  it('fails an empty snapshot', () => {
    const empty = { ilceID: '1', name: 'Test', tz: 'UTC', days: {} } as never
    expect(checkCoverage([empty], today)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/prayer-data/coverage.test.ts`
Expected: FAIL — cannot resolve `./coverage.ts`.

- [ ] **Step 3: Write the gate**

Create `scripts/prayer-data/coverage.ts`:

```ts
// The promise the app makes is that every displayed prayer time comes from
// Diyanet, never from the solar model. That holds only if the snapshot covers
// the scrubber's whole reach for every city it ships. This is the check that
// turns that promise into a build failure rather than a silent fallback.

export interface CoverageProblem {
  ilceID: string
  name: string
  reason: string
}

interface Coverable {
  ilceID: string
  name: string
  days: Record<string, unknown>
}

/** The scrubber reaches +10 days; +25 leaves slack to notice a failed run. */
const FORWARD_DAYS = 25

function shift(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function checkCoverage(
  files: Coverable[],
  today: string,
  forwardDays: number = FORWARD_DAYS,
): CoverageProblem[] {
  const problems: CoverageProblem[] = []

  for (const file of files) {
    const dates = Object.keys(file.days)
    if (!dates.length) {
      problems.push({ ilceID: file.ilceID, name: file.name, reason: 'no days at all' })
      continue
    }

    const have = new Set(dates)
    const earliest = dates.reduce((a, b) => (a < b ? a : b))
    let reason: string | null = null

    // Yesterday: needed because a city at UTC-11 is still on the previous local
    // date. Diyanet serves no archive, so on a first run it was never
    // obtainable — grandfather it against the earliest date ever captured.
    const yesterday = shift(today, -1)
    if (yesterday >= earliest && !have.has(yesterday)) {
      reason = `missing ${yesterday} (yesterday)`
    }

    for (let i = 0; !reason && i <= forwardDays; i++) {
      const date = shift(today, i)
      if (!have.has(date)) reason = `missing ${date} (today+${i})`
    }

    if (reason) problems.push({ ilceID: file.ilceID, name: file.name, reason })
  }

  return problems
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run scripts/prayer-data/coverage.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the CI entry point**

Create `scripts/prayer-data/check-coverage.ts`:

```ts
// CI entry point for the coverage gate. Exits non-zero so a workflow fails
// rather than deploying a globe that would fall back to the solar model.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkCoverage } from './coverage.ts'

const OUT = 'public/times'

const files = readdirSync(OUT)
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => JSON.parse(readFileSync(join(OUT, f), 'utf8')))

if (!files.length) {
  console.error('no snapshot files in public/times')
  process.exit(1)
}

const today = new Date().toISOString().slice(0, 10)
const problems = checkCoverage(files, today)

console.log(`checked ${files.length} cities for ${today}`)
if (problems.length) {
  console.error(`\n${problems.length} cities fail coverage:`)
  for (const p of problems.slice(0, 30)) console.error(`  ${p.name} (${p.ilceID}): ${p.reason}`)
  process.exit(1)
}
console.log('coverage OK')
```

- [ ] **Step 6: Register and run it**

In `package.json`, add:

```json
    "prayer:check": "node --experimental-strip-types scripts/prayer-data/check-coverage.ts",
```

Run: `npm run prayer:check`
Expected: with only Emmen fetched so far, `checked 1 cities` and `coverage OK`. (The four legacy files from the old crawler have a different shape and no `days` key — delete them first: `rm -f public/times/9541.json public/times/15344.json public/times/16309.json public/times/14096.json`.)

- [ ] **Step 7: Commit**

```bash
git add scripts/prayer-data/coverage.ts scripts/prayer-data/coverage.test.ts \
        scripts/prayer-data/check-coverage.ts package.json
git rm -f public/times/9541.json public/times/15344.json public/times/16309.json public/times/14096.json
git commit -m "feat: coverage gate enforcing Diyanet-only prayer times"
```

---

### Task 12: The full crawl

**Files:** none — this is a data-producing run.

- [ ] **Step 1: Run the full fetch**

Run: `rm -f data/fetch-state.json && npm run prayer:fetch`
Expected: ~10 minutes, `1000–1400 cities in the snapshot`, few or no failures.

If it reports `BlockedError`, the WAF has objected persistently: wait an hour, then re-run. The run resumes, so no work is lost.

- [ ] **Step 2: Verify coverage across every city**

Run: `npm run prayer:check`
Expected: `coverage OK`. Any failure names the city and the missing date — investigate before committing, since this is the gate that keeps `COMPUTED` off the panel.

- [ ] **Step 3: Check the size is what the design predicted**

Run: `du -sh public/times && ls public/times | wc -l`
Expected: roughly 25–35 MB across 1,000–1,400 files. Substantially more means the compact format is not being written; investigate rather than committing tens of megabytes of waste.

- [ ] **Step 4: Run the app and confirm the badge**

Run: `npm run dev`

Open the app, hover several cities on different continents — including ones far from Turkey. Expected: the panel badges `DIYANET · LIVE` for every city, never `COMPUTED`. Scrub to +10 days and confirm times still resolve.

- [ ] **Step 5: Commit the snapshot**

```bash
git add public/times
git commit -m "data: prayer-times snapshot for all selected cities"
```

---

### Task 13: Scheduled refresh workflow

**Files:**
- Create: `.github/workflows/refresh-prayer-times.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/refresh-prayer-times.yml`:

```yaml
# Refreshes the prayer-times snapshot and pushes it, which triggers the Vercel
# redeploy.
#
# Monthly is a bridge, not a steady state: the first run banked all 365 days of
# the published next year, so most runs will find nothing new and commit
# nothing. The cadence exists so the rolling window keeps advancing until the
# banked year takes over.

name: Refresh prayer times

on:
  schedule:
    - cron: '0 3 5 * *' # 03:00 UTC, day 5 of each month
  workflow_dispatch:

# Never `push` — the job's own commit would retrigger it.

permissions:
  contents: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Crawl
        run: npm run prayer:fetch -- --prune

      - name: Verify coverage
        run: npm run prayer:check

      - name: Commit if anything changed
        run: |
          if git diff --quiet -- public/times; then
            echo "no changes"
            exit 0
          fi
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add public/times
          git commit -m "data: refresh prayer times"
          git push
```

The coverage check runs **after** the crawl and **before** the commit, so a partial crawl fails the job rather than pushing a snapshot that would show computed times.

- [ ] **Step 2: Validate the workflow parses**

Run: `node -e "console.log(require('fs').readFileSync('.github/workflows/refresh-prayer-times.yml','utf8').length + ' bytes')"`
Expected: a byte count. Then push and confirm the workflow appears under the repo's Actions tab.

- [ ] **Step 3: Trigger it manually once**

```bash
git push
gh workflow run "Refresh prayer times"
gh run watch
```

Expected: green. The commit step should report `no changes`, since the snapshot was just built locally. That is the correct outcome and proves the no-op path works.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/refresh-prayer-times.yml
git commit -m "ci: monthly prayer-times refresh"
```

---

### Task 14: Documentation

**Files:**
- Modify: `README.md`
- Modify: `src/hooks/queries.ts:71`

- [ ] **Step 1: Fix the stale comment**

In `src/hooks/queries.ts`, replace the docblock above `useTimetable` (line 69–72):

```ts
/**
 * Step 2: IlceID -> the snapshot's ~396 days of prayer times, normalised to UTC
 * instants. The scrubber reaches +10 days, so that window is never the limit.
 */
```

- [ ] **Step 2: Rewrite the README's data section**

In `README.md`, replace the "Where the numbers come from", "The rate limit, and the snapshot" and "Mapping cities to Diyanet" sections with:

```markdown
## Where the numbers come from

**Diyanet, for every city.** Prayer times are scraped from
`namazvakitleri.diyanet.gov.tr`. Each city page ships its weekly, monthly and
yearly tables as plain HTML — the yearly one is 365 rows — so a single GET is a
full calendar year. The PDF and Excel buttons on that page are DataTables
client-side exports of rows already in the DOM; there is no server-side export,
and no browser automation is needed.

The site publishes no coordinates and no UTC offset. Both come from GeoNames
`cities15000`, which also supplies the population used to pick cities and the
IANA timezone used to derive each day's offset via `Intl.DateTimeFormat`.

**A local solar model, for the globe's geometry.** The terminator rings
(−0.833° sunrise/sunset, −18° Fajr, −17° Isha), the night polygon, and the
sub-solar and sub-lunar points are computed in `src/lib/astro.ts`. No source
publishes these.

## The snapshot

Three stages, each independently re-runnable:

```bash
npm run prayer:discover   # country -> state -> district tree (~11 min, rarely)
npm run prayer:select     # GeoNames x tree -> src/data/cities.json
npm run prayer:fetch      # one GET per city -> public/times/{ilceID}.json
npm run prayer:check      # coverage gate
```

`public/times/` is committed, so production makes no upstream calls at all.

**Writes merge.** The monthly table is a rolling 30-day window and Diyanet
serves no archive, so each run contributes a different 30 days and overwriting
would permanently narrow the snapshot. Resume is tracked per run in
`data/fetch-state.json`, never inferred from a file's existence.

**No computed times.** Only cities matched to a real Diyanet district ship, and
`npm run prayer:check` fails the build unless every city covers yesterday
through today+25. A monthly GitHub Action re-runs the crawl and pushes only
when something changed.

**The site's WAF is strict.** GET only — a POST or any query string returns a
385-byte block page with HTTP 200, detected by content and backed off five
minutes.
```

- [ ] **Step 3: Verify the README's claims still hold**

Run: `npm run prayer:check && npm test && npm run typecheck && npm run build`
Expected: all four PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md src/hooks/queries.ts
git commit -m "docs: describe the website crawler and the coverage guarantee"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: recon findings → Tasks 2–3; stage 1 → Task 4; stage 2 → Tasks 5–7; stage 3 → Task 9; merge semantics → Task 9 Step 4 (with an explicit MERGED/LOST assertion); app changes → Tasks 8, 10, 14; coverage gate → Task 11; deployment → Task 13; testing → Tasks 3, 6, 10, 11. `SCRUB_MIN`/`SCRUB_MAX` needed no task — already applied.

**Placeholders.** None. The one iterative step, extending `COUNTRY_OVERRIDES` (Task 7 Step 4), has an explicit done-criterion: no country over 1M population left unmatched.

**Type consistency.** `SnapshotFile`/`SnapshotDay` are defined identically in `scripts/prayer-data/fetch-times.ts` and `src/lib/snapshot.ts` — deliberately duplicated rather than shared, since the crawler must not import from the browser bundle and the shape is seven fields. `ilceID` is a string throughout. `City.u` is a number, matching `resolveDistrict`'s existing use. `checkCoverage` takes a structural `Coverable`, so it accepts both shapes without a shared import.

**Known deliberate loss:** `KibleSaati` has no column in the website's tables, so `TimetableDay.qiblaHour` becomes null. It is unused — `SidePanel.tsx:225` renders the qibla *bearing*, computed from coordinates in `readout.ts:256`, not the qibla hour.

---

## Amendments applied during execution

Review of Tasks 2–3 found defects in this plan's own code, fixed in commit `db2a6e6`. The code blocks above are superseded by the repo where they differ:

- `mapPool` latches on first failure so no worker starts new work after an error — without it, a `BlockedError` left the remaining workers hammering a WAF that was actively refusing us, invisibly, because `Promise.all` had already rejected. `limit` is clamped to `>= 1`.
- `request()` wraps `fetch` in try/catch feeding the same attempt counter, and passes `AbortSignal.timeout(30_000)`; transport errors previously bypassed all retry logic.
- `isBlockPage` uses body length as the primary signal. `Response.text()` decodes as UTF-8 regardless of declared charset, so a phrase-only test could miss a real block and misreport it as a parse error, with no backoff.
- `GAP_MS` 500 → 1500, so concurrency 3 actually yields the ~2 req/s the constraints require rather than 2–6.
- `parseCityPage` now requires BOTH tables and throws if a caption is present but yields zero rows. The monthly table is the sole source of near-term dates; losing it silently produced a snapshot with no current prayer times and a green test run.
- Added `scripts/prayer-data/http.test.ts`, and a real captured WAF block page at `__fixtures__/waf-block-page.html` (490 bytes, UTF-8) so block detection is tested against the genuine artefact.
