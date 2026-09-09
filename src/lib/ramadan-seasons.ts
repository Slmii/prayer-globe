import { solarTableAt, sun } from './astro';
const DAY = 86400000;
const ISLAMIC_EPOCH = 1948439.5;
export interface SeasonCity {
	name: string;
	lat: number;
	lon: number;
}
export interface RamadanSeason {
	hijriYear: number;
	startMs: number;
	previewMs: number;
	meanHours: number | null;
	shortestHours: number | null;
	longestHours: number | null;
	missingDays: number;
}
export interface RamadanSeries {
	city: SeasonCity;
	points: RamadanSeason[];
	meanHours: number | null;
	missingMonths: number;
}
export interface RamadanRequest {
	id: number;
	startYear: number;
	cities: SeasonCity[];
}
export interface RamadanResult {
	id: number;
	series: RamadanSeries[];
}

/** Arithmetic civil calendar: day 1 is the daytime date, following sunset. */
export function ramadanStart(hijriYear: number): number {
	const jd = ISLAMIC_EPOCH + 354 * (hijriYear - 1) + Math.floor((3 + 11 * hijriYear) / 30) + Math.ceil(29.5 * 8);
	return (jd - 2440587.5) * DAY;
}

export function ramadanSeasons(city: SeasonCity, startYear: number): RamadanSeries {
	const start = Date.UTC(startYear, 0, 1),
		end = Date.UTC(startYear + 33, 0, 1);
	const approximateYear = Math.floor((start / DAY + 2440587.5 - ISLAMIC_EPOCH) / 354.3667) + 1;
	const points: RamadanSeason[] = [];
	let totalHours = 0,
		totalDays = 0,
		missingMonths = 0;
	for (let year = approximateYear - 1; year <= approximateYear + 35; year++) {
		const startMs = ramadanStart(year);
		if (startMs < start || startMs >= end) continue;
		const lengths: number[] = [];
		for (let day = 0; day < 30; day++) {
			const at = startMs + (day + 0.5 - city.lon / 360) * DAY;
			const table = solarTableAt(city.lat, sun(new Date(at)).dec);
			const duration = table.set - table.fajr;
			if (Number.isFinite(duration) && duration > 0 && duration <= 24) lengths.push(duration);
		}
		const missingDays = 30 - lengths.length;
		const sum = lengths.reduce((total, hours) => total + hours, 0);
		if (missingDays) missingMonths++;
		else {
			totalHours += sum;
			totalDays += 30;
		}
		points.push({
			hijriYear: year,
			startMs,
			previewMs: startMs + (14.5 - city.lon / 360) * DAY,
			meanHours: missingDays ? null : sum / 30,
			shortestHours: missingDays ? null : Math.min(...lengths),
			longestHours: missingDays ? null : Math.max(...lengths),
			missingDays
		});
	}
	return { city, points, meanHours: missingMonths || !totalDays ? null : totalHours / totalDays, missingMonths };
}
