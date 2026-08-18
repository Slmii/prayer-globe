# Prayer Globe

A MapLibre globe showing where on earth each prayer is currently being observed.
Hover any of 723 cities across 203 countries, zoom to its streets, and scrub the
sun, moon and night side forward ten days.

React 19 · Vite · TypeScript · TanStack Query · MapLibre GL 5

```bash
npm install
npm run dev
```

## Where the numbers come from

**Diyanet, for every city.** Prayer times are scraped from
`namazvakitleri.diyanet.gov.tr`. Each city page ships its weekly, monthly and
yearly tables as plain HTML — the yearly one is 365 rows — so a single GET is a
full calendar year. The PDF and Excel buttons on that page are DataTables
client-side exports of rows already in the DOM: the page loads `jszip` and
`pdfmake`, there is no server-side export to call, and no browser automation is
needed.

The site publishes no coordinates and no UTC offset. Both come from GeoNames
`cities15000`, which also supplies the population used to pick cities and the
IANA timezone. Each day's offset is derived from that timezone with
`Intl.DateTimeFormat(…, { timeZoneName: 'longOffset' })`, which handles DST
correctly and needs no network.

**A local solar model, for the globe's geometry.** The terminator rings
(−0.833° sunrise/sunset, −18° Fajr, −17° Isha), the night polygon, and the
sub-solar and sub-lunar points are computed in `src/lib/astro.ts`. No source
publishes these, so they stay modelled even though the prayer times no longer
are.

## The snapshot

Three stages, each independently re-runnable:

```bash
npm run prayer:discover   # country -> state -> district tree (~28 min, rarely)
npm run prayer:select     # GeoNames x tree -> src/data/cities.json
npm run prayer:fetch      # one GET per city -> public/times/{ilceID}.json
npm run prayer:check      # coverage gate
```

`public/times/` is committed, so production makes no upstream calls at all.
`data/` holds the regenerable caches and is git-ignored.

**Writes merge.** The monthly table is a rolling 30-day window and Diyanet
serves no archive, so each run contributes a different 30 days and overwriting
would permanently narrow the snapshot. Resume is tracked per run in
`data/fetch-state.json`, never inferred from a file's existence — inferring it
would make every scheduled run a silent no-op.

**No computed times.** Only cities matched to a real Diyanet district ship, so
every dot on the globe has real data; the rest go to `data/unmatched.json`.
`npm run prayer:check` then fails the build unless every city covers yesterday
through today+25. A monthly GitHub Action re-runs the crawl and pushes only
when something changed.

## Two things the site will do to you

**The WAF is strict.** GET only — a POST or any query string returns a
490-byte block page with HTTP 200. It has to be caught by content, and the
test for it differs by endpoint: city pages run to hundreds of kilobytes so
anything tiny is a block, but `GetRegList` legitimately answers in 90–2000
bytes, where a block instead shows up as HTML where JSON was expected.

**The site runs on Turkey time (UTC+3).** Between 21:00 and 24:00 UTC its
rolling window has already advanced to tomorrow's UTC date, so a snapshot built
in that window contains no row for today and fails the coverage gate. The
scheduled refresh runs at 03:00 UTC to stay clear of it; `prayer:fetch` warns
if you run it in that window by hand.

## Matching cities to Diyanet

The API is ID-based with no coordinates and no geographic search, so each
GeoNames city is matched to a district by name — always **scoped inside one
country**, because a name-only lookup matches "Los Angeles" to Los Angeles,
Chile.

Three things make that harder than it sounds, each of which silently cost real
cities before it was handled:

- Country names arrive HTML-escaped (`T&#220;RKİYE`) and often in Turkish
  (`ZIMBABVE`, `UMMAN`, `KATAR`), so they need decoding and an override table.
- `Intl.DisplayNames` resolves withdrawn ISO2 codes to the same English name as
  the live ones — FX for France, SU for Russia, UK for the United Kingdom — and
  the withdrawn code winning meant the country vanished while still _looking_
  resolved.
- District names carry parenthetical qualifiers that mean different things:
  `SAO PAULO (S.P.)` where the parenthesis is noise, and `BUKRES(bucharest)`
  where it holds the English name.

## Notes

- The app is browser-only and needs no backend. The snapshot is served from
  disk, so the ~100-requests-per-15-minutes limit on the `ezanvakti` API no
  longer applies to anything the app does; that API survives in
  `src/lib/diyanet.ts` only as a fallback the coverage gate should keep from
  ever firing.
- Scraping the site rather than ingesting its yearly XLSX was not a compromise:
  the XLSX is generated in the browser by `pdfmake`/`jszip` from rows the page
  already contains, so the HTML is the actual source.
- The website and the `ezanvakti` API share district IDs
  (`/en-US/9206/prayer-time-for-ankara` is Ankara, and `9206` is its `IlceID`),
  which is why the snapshot drops straight into the existing lookup path.
- The `ezanvakti.imsakiyem.com` open-data set covers Türkiye and KKTC only
  (880 districts, no coordinates), so it cannot back a global globe.
