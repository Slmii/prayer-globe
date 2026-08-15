# Ever-Standing — Prayer Globe

A MapLibre globe showing where on earth each prayer is currently being observed.
Hover any of 143 cities, zoom to its streets, and scrub the sun, moon and night
side ±12 hours.

React 19 · Vite · TypeScript · TanStack Query · MapLibre GL 5

```bash
npm install
npm run dev
```

## Where the numbers come from

Two sources, deliberately split by what each can actually answer.

**Diyanet, for the selected city.** Prayer times come from the Diyanet
(ezanvakti) API. It publishes local wall-clock strings; the globe runs on UTC, so
each day's real offset is read from `MiladiTarihUzunIso8601` (`+01:00` for
London, `+03:00` for Ankara). Note that the sibling `GreenwichOrtalamaZamani`
field reports `3` for *both* of those — it is not the UTC offset and is ignored.

**A local solar model, for everything else.** The terminator rings (−0.833°
sunrise/sunset, −18° Fajr, −17° Isha), the night polygon, the sub-solar and
sub-lunar points, and the phase colour of all 143 city dots are computed in
`src/lib/astro.ts`. No API can provide these, and colouring 143 dots on every
scrub frame could never be 143 network calls. The model also backs the panel
whenever Diyanet has no district for a city.

The panel badges which one you are looking at: `DIYANET · LIVE` or `COMPUTED`.

The −18°/−17° in the legend are Diyanet's twilight convention (hence the header
badge); −0.833° is the standard geometric sunrise, being refraction plus the
sun's semi-diameter. Note that the drawn bands are *always* the local model even
when the panel says LIVE, because the API returns times rather than angles. The
two agree at most latitudes but diverge above roughly 45–48°, where Diyanet
switches from fixed angles to adjustment rules for nights with no true twilight —
there the fetched table is the one to trust.

## The rate limit, and the snapshot

The upstream API allows roughly **100 requests per 15 minutes per IP**. Two
things keep the app inside that:

1. **Lookups only happen for a city you actually pointed at.** The auto-spin
   constantly changes the centre city; left ungated that fires a lookup every
   second or so and exhausts the quota in about a minute. So fetching is gated
   on hovering or pausing the spin, and debounced 600 ms on top
   (`useSettledValue`). A 429 is never retried — retrying only deepens the hole.

2. **An optional pre-fetched snapshot.** `npm run fetch-times` crawls every city
   once and writes `public/times/{ilceID}.json` plus an `index.json`. When those
   files are present the app serves prayer times straight from disk and makes
   **no upstream calls at all**. When they are absent it falls through to the
   live API, so a fresh clone still works.

```bash
npm run fetch-times                    # all cities, resumable
npm run fetch-times -- Istanbul London # just these
npm run fetch-times -- --force         # re-fetch what is already cached
```

The crawler paces itself to 90 requests per 15 minutes and backs off 5 minutes
on a 429, so a full run takes roughly 45 minutes. It is resumable — interrupting
it is safe. `/vakitler` only returns ~32 days, so re-run it monthly from cron or
CI.

## Mapping cities to Diyanet

The API is ID-based (country → province → district) with no coordinates and no
geographic search, so each city in `src/lib/cities.ts` carries the hints needed
to walk that chain: a `UlkeID`, an optional province, and candidate district
names (`['MECCA', 'MEKKE', 'MAKKAH']`) because transliterations vary.

Matching is scoped by country for a reason: a name-only lookup matches
"Los Angeles" to **Los Angeles, Chile**.

## Notes

- The app is browser-only; the API sends `access-control-allow-origin: *`, so no
  backend is required. If one is ever wanted — to shield the rate limit behind a
  shared cache, or to ingest the official `namazvakitleri.diyanet.gov.tr` yearly
  XLSX, which sends no CORS headers — TanStack Start is the intended route. The
  snapshot above solves the same problem without a server.
- The official Diyanet site uses the *same* district IDs as this API
  (`/en-US/9206/prayer-time-for-ankara` is Ankara, and `9206` is its `IlceID`).
- The `ezanvakti.imsakiyem.com` open-data set covers Türkiye and KKTC only
  (880 districts, no coordinates), so it cannot back a global globe.
