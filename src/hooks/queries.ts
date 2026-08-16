import { useQuery } from '@tanstack/react-query'
import type { FeatureCollection } from 'geojson'
import { resolveDistrict, getTimetable, buildTimetable, HttpError } from '../lib/diyanet'
import type { ResolvedDistrict, TimetableDay } from '../lib/diyanet'
import type { City } from '../lib/cities'
import { loadIndex, loadTimetable } from '../lib/snapshot'

/**
 * Retrying a 429 just deepens the hole — the limiter is counting attempts, not
 * successes. Back off entirely and let the UI fall back to the solar model.
 */
const retryUnlessRateLimited = (failureCount: number, error: Error) =>
  !(error instanceof HttpError && error.status === 429) && failureCount < 1

const isRateLimited = (error: unknown) => error instanceof HttpError && error.status === 429

const WORLD_GEOJSON =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson'

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
 * The pre-fetched dataset, if `npm run fetch-times` has been run. Absent on a
 * fresh clone, in which case everything falls through to the live API.
 */
export function useSnapshotIndex() {
  return useQuery({
    queryKey: ['snapshot-index'],
    queryFn: loadIndex,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
}

/**
 * Step 1 of the chain: city -> IlceID. Served from the snapshot when we have
 * one; otherwise resolved live. Province and district lists are immutable
 * reference data, so this never needs refetching either way.
 */
export function useDistrict(city: City | null) {
  const snapshot = useSnapshotIndex()
  const fromSnapshot = city ? snapshot.data?.[city.n] : undefined

  return useQuery<ResolvedDistrict | null>({
    queryKey: ['district', city?.n, fromSnapshot ? 'snapshot' : 'live'],
    queryFn: () => fromSnapshot ?? resolveDistrict(city as City),
    // Wait for the snapshot probe so we don't hit the API for a city we already
    // have on disk.
    enabled: !!city && !snapshot.isPending,
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
