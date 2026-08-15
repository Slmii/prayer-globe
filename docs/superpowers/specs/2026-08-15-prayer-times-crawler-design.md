# Global prayer-times crawler

Replace the rate-limited `ezanvakti` API crawl with a scrape of the Diyanet
website, and grow the globe from 143 hand-curated cities to roughly 1,200
selected by population across every country Diyanet publishes.

## Problem

`scripts/fetch-times.ts` walks the `ezanvakti` API, which allows ~100 requests
per 15 minutes. It paces itself to 90/15min, so a 143-city run takes ~45
minutes and returns 32 days per city. Scaling that to 1,200 cities would take
roughly six hours and still return 32 days.

The cities themselves are hand-maintained in `src/lib/cities.ts`, each carrying
transliteration hints (`d: ['MECCA', 'MEKKE', 'MAKKAH']`) because the API is
ID-based with no search and no coordinates.

## What the recon established

Verified by direct request on 2026-08-15, not assumed:

**The yearly table ships in the page HTML.** `GET
/en-US/13880/prayer-time-for-emmen` returns 432 KB containing a 365-row table,
01.01.2027 → 31.12.2027, plus a 31-row monthly table and a 7-row weekly table.
Columns are `Gregorian Date, Hijri Date, Fajr, Sun, Dhuhr, Asr, Maghrib, Isha`,
mapping 1:1 onto the API's `Imsak, Gunes, Ogle, Ikindi, Aksam, Yatsi`.

**The PDF and Excel buttons are client-side.** The page loads
`datatables.net/js/buttons.html5.min.js`, `jszip.min.js` and `pdfmake.min.js`.
Those buttons serialise rows already present in the DOM. No server-side export
endpoint exists to call, and none is needed.

**The dropdowns are backed by an undocumented JSON endpoint.**

```
GET /en-US/home/GetRegList?ChangeType=country&CountryId=13
  → { StateList: [{ SehirAdi, SehirAdiEn, SehirID }] }

GET /en-US/home/GetRegList?ChangeType=state&CountryId=13&StateId=850
  → { StateRegionList: [{ IlceID, IlceAdi, IlceAdiEn, IlceUrl }] }
```

`IlceUrl` is the exact page path, so no slug construction is required.

**The WAF is strict.** A `POST` to a city page and a `GET` carrying any query
string both return an identical 385-byte block page titled *"İsteğiniz güvenlik
kurallarına takılmıştır"*. Crawler rule: bare `GET`s on the published paths
only, and treat that page as a backoff signal rather than as content.

## Coverage

| Source | Range on 2026-08-15 |
| --- | --- |
| Yearly tab | 365 days, 01.01.2027 → 31.12.2027 |
| Monthly tab | 31 days, 15.08.2026 → 14.09.2026 |
| `ezanvakti` API | 32 days, 12.08.2026 → 12.09.2026 |

Diyanet publishes the **next** calendar year in the yearly tab. Neither source
offers 15 Sep – 31 Dec 2026 in bulk, and there is no year selector or archive.

Both tables come from one GET and one parse, so the crawler stores both.

### Requirement: every displayed time comes from Diyanet

The panel must never show computed times. Two things currently cause the
`COMPUTED` badge, and the design closes both:

**No Diyanet district for the city.** Stage 2 ships only cities it matched to a
real `IlceID`. Unmatched cities go to `unmatched.json` and never reach the
globe, so every dot has Diyanet data by construction.

**Date absent from the snapshot.** The scrubber becomes forward-only, 0 to +10
days (`SCRUB_MIN = 0`, `SCRUB_MAX = 10 * 24 * 60` in `src/hooks/util.ts`). With
UTC offsets reaching +14, the local date at the far end of the scrub can be
`today+11`, so that is the forward requirement. The rolling 30-day window
covers it with nineteen days to spare.

**Yesterday is still required, for a different reason.** `readout.ts:247`
derives the displayed day as `nowMs + offsetHours * 3600000`. During the early
UTC hours a city at UTC−11 is still on the previous local date, so rendering
*right now* in the far west needs `today−1`. This is a consequence of timezone
spread, not of scrubbing, and removing the backward scrub does not remove it.

Diyanet's monthly table begins on the day it is requested and there is no
archive, so `today−1` can only come from a previous run's data surviving the
merge. `--prune` therefore retains 2 days of history — enough for the timezone
spread, without the 14 days the old backward scrub would have needed.

The 15 Sep – 31 Dec 2026 hole is entirely in dates beyond the scrubber's reach,
and it fills in well ahead of the calendar arriving there.

What stays modelled is the globe's geometry — terminator rings, night polygon,
sub-solar and sub-lunar points. No source publishes those. Only the panel's
`COMPUTED` badge goes away.

### Closing the 2026 gap

The monthly window rolls forward with the calendar, so each run contributes a
fresh 30 days:

| Run | Extends coverage to |
| --- | --- |
| 15 Aug 2026 (first) | 14 Sep |
| 5 Sep | 5 Oct |
| 5 Oct | 4 Nov |
| 5 Nov | 5 Dec |
| 5 Dec | 4 Jan 2027, meeting the banked yearly table |

This works only because writes merge; see below.

Note that monthly is a **bridge, not the steady state**. The first run banks all
365 days of 2027, so from January the app is covered for a year by data already
on disk, and runs through 2027 produce empty diffs until the yearly tab flips to
2028. Cadence stays monthly because it costs nothing when nothing changes.

## Non-goals

- Browser automation. No Playwright, no headless Chrome, no download directory.
- Parsing XLSX or PDF.
- Crawling every district. Diyanet publishes tens of thousands; a globe needs
  hundreds.
- Removing the live-API fallback in `src/lib/diyanet.ts`. It stays as a crash
  guard, though the coverage gate means it should never fire.

## Architecture

Three stages under `scripts/prayer-data/`, each writing a checkpoint so it can
be re-run independently.

### Stage 1 — `discover.ts`

Builds the full country → state → district tree.

1. Parse `<select name="country">` from one seed page: 307 options, `value` is
   the `CountryId`.
2. Per country, `GetRegList?ChangeType=country` for its states.
3. Per state, `GetRegList?ChangeType=state` for its districts.

Writes `data/diyanet-tree.json`. About 1,300 requests, ~11 minutes at the
configured pace. IDs are stable, so this runs rarely; every later stage reads
the cache.

### Stage 2 — `select-cities.ts`

Chooses which cities matter. Touches no Diyanet endpoint.

Source: GeoNames `cities15000.zip` (~30k cities, no API key). Relevant
tab-separated columns are name (1), asciiname (2), alternatenames (3), lat (4),
lon (5), feature code (7), country code (8), population (14), timezone (17).

1. Group by ISO2 country code; keep the capital (feature code `PPLC`) plus the
   top 5 by population.
2. Resolve Diyanet's country names to ISO2. `Intl.DisplayNames(['en'], {type:
   'region'})` generates English names for every ISO2 code; both sides are
   normalised and matched, with a small hand-written override table for the
   cases that will not match (`HOLLANDA`, `KKTC`, `ATLANTIC OCEAN`,
   `ASCENSION`).
3. Match each city to a district **within its country only** — a name-only
   match sends "Los Angeles" to Los Angeles, Chile. Compare normalised
   GeoNames `name`/`asciiname`/`alternatenames` against `IlceAdiEn` and
   `IlceAdi`. Normalisation uppercases, strips diacritics, handles Turkish
   `İ`/`ı`, and drops punctuation. Exact match first, then alternate names.
   Anything left over is reported, not guessed at.

Writes `src/data/cities.json` and `data/unmatched.json`.

```json
{
  "name": "Emmen",
  "iso2": "NL",
  "country": "Netherlands",
  "lat": 52.78,
  "lon": 6.9,
  "tz": "Europe/Amsterdam",
  "pop": 57000,
  "ilceID": "13880",
  "ilceUrl": "/en-US/13880/prayer-time-for-emmen",
  "diyanetName": "EMMEN"
}
```

`alternatenames` is what bridges `MECCA` / `MEKKE` / `MAKKAH`, replacing the
hand-maintained `d` hints.

### Stage 3 — `fetch-times.ts`

One bare `GET` per selected city against `IlceUrl`. Extracts the monthly and
yearly tables, anchored on `id="table-caption-monthly"` and
`id="table-caption-yearly"`, and merges them into one date-keyed map.

Every row is validated before it is written: 8 cells, date matching
`dd.mm.yyyy`, six times matching `HH:MM`. A city that fails validation is
recorded in the failure report and its file is left untouched rather than
written half-formed.

Writes `public/times/{ilceID}.json`:

```json
{
  "ilceID": "13880",
  "name": "Emmen",
  "tz": "Europe/Amsterdam",
  "days": {
    "2027-01-01": ["06:37", "08:38", "12:41", "14:15", "16:34", "18:21"]
  }
}
```

Times are local wall-clock, in the order fajr, sunrise, dhuhr, asr, maghrib,
isha. About 22 KB per city, ~26 MB for the full set — against ~250 MB had the
verbose API row shape been kept.

Also writes `public/times/index.json` mapping city name to `ilceID`.

Flags: `--only <city…>`, `--concurrency`, `--prune`.

### Writes must merge, never replace

The monthly table is a rolling 30-day window. The whole value of re-running is
that each run contributes a *different* 30 days, so a run must union its parsed
days into whatever the file already holds. Overwriting would discard every
earlier window and leave the snapshot permanently 30 days wide.

Newly parsed dates win on conflict, so a Diyanet correction propagates.

`--prune` drops days more than 2 days before today, which is the only thing
stopping the files growing without bound. Two rather than zero because the far
-western timezones still need yesterday's row. Diyanet will not re-serve a past
date, so anything pruned is gone for good; the flag stays opt-in for that
reason.

## App changes

- `src/lib/cities.ts` becomes a thin re-export of the generated
  `src/data/cities.json`, preserving the `City` interface and adding `tz`,
  `pop` and `iso2`. The `u`/`p`/`d` resolution hints go away.
- `src/lib/snapshot.ts` reads the compact `days` map.
- **UTC offset** is derived from the IANA `tz` using
  `Intl.DateTimeFormat(…, { timeZone, timeZoneName: 'longOffset' })`. This
  replaces reading `MiladiTarihUzunIso8601`, which the website does not
  provide. It is DST-correct and needs no library and no network.
- `src/lib/diyanet.ts` is untouched. Its live-API path and the solar fallback
  remain as a crash guard, but they are now failure states rather than expected
  behaviour: the coverage gate below is what guarantees they never fire.
- `src/hooks/util.ts`: `SCRUB_MIN` becomes `0` and `SCRUB_MAX` becomes
  `10 * 24 * 60`. The scrubber is forward-only.
- Two stale comments get corrected to match: the README's "±12 hours" scrub
  claim, and `src/hooks/queries.ts:71`, which says the fetched window
  "comfortably covers the ±12h scrubber". Neither is a bug; both would mislead
  the next person reasoning about coverage.

## Deployment

Vercel, static build, data committed to the repo.

The repository is `github.com/Slmii/prayer-globe`, default branch `main`, with
`public/times/*.json` already tracked. The one remaining prerequisite is
connecting a Vercel project to that repo.

`public/times/*.json` is committed and served as a static asset, so production
makes no upstream calls. A scheduled GitHub Action refreshes it:

```yaml
# .github/workflows/refresh-prayer-times.yml
on:
  schedule: [{ cron: '0 3 5 * *' }]   # 03:00 UTC, day 5 monthly
  workflow_dispatch:
```

The job runs stage 3, verifies coverage, and commits **only if files actually
changed** — during 2027 the diffs will be empty and no commit is made. Pushing
to `main` triggers the Vercel redeploy; nothing host-specific lives in the
crawler, so moving off Vercel later touches only this workflow file.

It needs `permissions: contents: write` to push to `main`. The trigger is
`schedule` plus `workflow_dispatch` only, never `push`, so the workflow's own
commit cannot retrigger it.

`workflow_dispatch` allows a manual re-run, which matters because a failed
scheduled run must be noticed and repeated inside the remaining window.

Repo growth is concentrated in the four bridge runs of late 2026, roughly 9 MB
of compressed blobs each. Once 2027 is banked, unchanged files cost nothing.

### Coverage gate

The Action fails loudly if the snapshot cannot satisfy the no-computed
requirement. After crawling, assert for every shipped city that `days` holds an
unbroken run of dates across the full scrubber reach:

- **Forward, today → today + 25.** Hard requirement. Twenty-five rather than the
  eleven the scrubber needs leaves fourteen days of slack to notice a failed run
  and re-run it before the app is affected.
- **Backward, today − 1.** Required, but grandfathered to the earliest date the
  snapshot has ever captured. Diyanet publishes no archive, so on a first run
  yesterday is genuinely unobtainable and demanding it would fail the bootstrap
  forever. From the second day of operation onward the merge has it, and the
  bound becomes real.

A break anywhere in that span, a missing city, or a short window fails the
workflow rather than quietly deploying a globe that falls back to the solar
model.

The bootstrap consequence is worth stating plainly: on launch day, scrubbing
back into yesterday's local date in the far-western timezones has no Diyanet
data. Running the crawler once the day before going live removes even that.

## Error handling

- Detect the 385-byte WAF page by content, not status code, and back off five
  minutes — mirroring how the current crawler treats a 429.
- Never retry a block immediately; retrying only deepens it.
- Per-city failures accumulate into a report; a bad city never aborts the run.
- Resume is tracked per run, in `data/fetch-state.json`, which records the
  cities completed under the current run id. Interrupting and restarting skips
  what that run already did. A new run — next month's — starts with an empty
  set and merges into the existing city files. Resume must not be inferred from
  "the output file exists", which would make every monthly run a no-op.
- Concurrency 3, roughly 2 requests per second, realistic User-Agent.

## Testing

- **Table parser** against trimmed fixtures saved from the live site (Ankara
  and Emmen): asserts 365 yearly rows, correct first and last dates, `HH:MM`
  shape, and that a malformed row is rejected rather than written.
- **Name matcher**: `MEKKE` ↔ `MECCA`, Turkish `İstanbul` ↔ `ISTANBUL`, and
  the country-scoping case that must *not* match Los Angeles to Chile.
- **Offset derivation**: London in January versus July, to prove DST.
- **Coverage gate**: a fixture with a deliberate one-day hole must fail it, a
  city whose forward window is 20 days must fail it, and a snapshot missing
  today−1 must fail it *unless* today−1 precedes its earliest captured date, in
  which case it must pass. This is the test that protects the no-computed
  requirement, so it matters more than the others.
- `src/lib/astro.test.ts` must still pass.

## Runtime

| Stage | Requests | Time |
| --- | --- | --- |
| discover | ~1,300 | ~11 min, cached |
| select | 1 (GeoNames zip) | seconds |
| fetch | ~1,200 | ~10 min |

Against roughly six hours for the equivalent API crawl, which would return 32
days rather than 396.

Re-run monthly from cron so the rolling 2026 window keeps advancing.
