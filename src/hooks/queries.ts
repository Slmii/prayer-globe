import { useQuery } from '@tanstack/react-query'
import type { FeatureCollection } from 'geojson'
import { resolveDistrict, getTimetable, buildTimetable, HttpError } from '../lib/diyanet'
import type { ResolvedDistrict, TimetableDay } from '../lib/diyanet'
import type { City } from '../lib/cities'
import { loadTimetable } from '../lib/snapshot'
import { loadPhases } from '../lib/phases'

/**
 * Retrying a 429 just deepens the hole — the limiter is counting attempts, not
 * successes. Back off entirely and let the UI fall back to the solar model.
 */
const retryUnlessRateLimited = (failureCount: number, error: Error) =>
  !(error instanceof HttpError && error.status === 429) && failureCount < 1

const isRateLimited = (error: unknown) => error instanceof HttpError && error.status === 429

// Built by `npm run build:world` from Natural Earth, pinned to a release tag,
// stripped of all 168 properties per feature and rounded to ~1 km. It used to
// be fetched live from jsDelivr at `@master`: 194 KB over the wire, the single
// largest thing the page loaded, from a moving ref on a third-party CDN sitting
// on the critical render path. Self-hosted it is 35 KB brotli.
const WORLD_GEOJSON = `${import.meta.env.BASE_URL}world.json`

/** Country outlines for the globe. Static data — fetch once, keep forever. */
export function useWorldGeo() {
  return useQuery<FeatureCollection>({
    queryKey: ['world-geojson'],
    queryFn: async ({ signal }) => {
      const res = await fetch(WORLD_GEOJSON, { signal })
      if (!res.ok) throw new Error(`Natural Earth → HTTP ${res.status}`)
      return (await res.json()) as FeatureCollection
    },
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

/**
 * Every city's prayer boundaries, for colouring the globe and counting the
 * tally. One file, fetched once, ~110 KB gzipped — the alternative is 723
 * requests per tick. Absent until `npm run prayer:phases` has been run, in which
 * case both fall back to the solar model.
 */
export function usePhases() {
  return useQuery({
    queryKey: ['phases'],
    queryFn: loadPhases,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
}

/**
 * Step 1 of the chain: city -> IlceID.
 *
 * This used to fetch public/times/index.json — 94 KB — purely to map a city
 * name to its ilceID, and every timetable fetch waited on it. But cities.json
 * already carries `ilceID` on every city, so the file was a second copy of data
 * the bundle had at module scope, bought with a serial round trip. Resolving
 * from the City itself is synchronous and always available.
 *
 * `resolveDistrict` stays as the live fallback for a city with no snapshot,
 * which the coverage gate is meant to make impossible.
 */
export function useDistrict(city: City | null) {
  return useQuery<ResolvedDistrict | null>({
    queryKey: ['district', city?.n, city?.ilceID ? 'snapshot' : 'live'],
    queryFn: () =>
      city?.ilceID
        ? { ilceID: city.ilceID, districtName: city.d[0] ?? city.n, provinceName: city.p ?? '' }
        : resolveDistrict(city as City),
    enabled: !!city,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: retryUnlessRateLimited,
  })
}

/**
 * Step 2: IlceID -> the snapshot's ~396 days of prayer times, normalised to UTC
 * instants. The scrubber reaches +10 days, so that window is never the limit.
 */
export function useTimetable(ilceID: string | undefined, fallbackOffsetMin: number) {
  return useQuery({
    queryKey: ['timetable', ilceID],
    queryFn: async () => (await loadTimetable(ilceID as string)) ?? getTimetable(ilceID as string),
    enabled: !!ilceID,
    // Upstream CDN caches for 5 days; half a day is plenty fresh here.
    staleTime: 12 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: retryUnlessRateLimited,
    select: (rows): TimetableDay[] => buildTimetable(rows, fallbackOffsetMin),
  })
}

export type TimesSource = 'diyanet' | 'local' | 'pending'

export interface PrayerTimes {
  days: TimetableDay[] | null
  district: ResolvedDistrict | null
  isLoading: boolean
  isFetching: boolean
  /** Diyanet has no district for this city. */
  unavailable: boolean
  /** Upstream is refusing requests (100 per 15 minutes, per IP). */
  rateLimited: boolean
  error: Error | null
  source: TimesSource
}

/** The two steps combined, plus the status the UI needs to badge its source. */
export function usePrayerTimes(city: City | null): PrayerTimes {
  const fallbackOffsetMin = city ? Math.round(city.lo / 15) * 60 : 0
  const district = useDistrict(city)
  const timetable = useTimetable(district.data?.ilceID, fallbackOffsetMin)

  const unavailable = district.isSuccess && !district.data
  const error = (district.error || timetable.error) as Error | null
  const days = timetable.data ?? null

  return {
    days,
    district: district.data ?? null,
    isLoading: district.isPending || (!!district.data && timetable.isPending),
    isFetching: district.isFetching || timetable.isFetching,
    unavailable,
    rateLimited: isRateLimited(district.error) || isRateLimited(timetable.error),
    error,
    source: days?.length ? 'diyanet' : unavailable || error ? 'local' : 'pending',
  }
}
