import { memo, useEffect, useId, useMemo, useState } from 'react';
import { Body, Caption, Display, Label, Title, Value } from './Typography';
import Combobox from './Combobox';
import { latTxt } from '../lib/astro';
import { cityContinent } from '../lib/continents';
import { CITIES } from '../lib/cities';
import type { City } from '../lib/cities';
import type { RamadanResult, RamadanSeries } from '../lib/ramadan-seasons';

interface Props {
	city: City | null;
	/**
	 * The reader's own city, offered at the top of the compare list.
	 *
	 * It is almost always in the list already, and almost always the one they
	 * want — "how does this compare to home" is the first question a chart of
	 * somewhere else provokes. Buried alphabetically among nine hundred others
	 * it may as well not be there.
	 */
	locatedCity?: City | null;
}
const dateFormat = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const duration = (hours: number | null) =>
	hours === null
		? 'Unavailable'
		: Math.floor(Math.round(hours * 60) / 60) + 'h ' + String(Math.round(hours * 60) % 60).padStart(2, '0') + 'm';
const WIDTH = 800,
	HEIGHT = 300,
	LEFT = 48,
	RIGHT = 780,
	TOP = 24,
	BOTTOM = 252;
const y = (hours: number) => BOTTOM - (hours / 24) * (BOTTOM - TOP);
function line(series: RamadanSeries, x: (ms: number) => number) {
	let hasPrevious = false;
	return series.points
		.map(point => {
			if (point.meanHours === null) {
				hasPrevious = false;
				return '';
			}
			const command = hasPrevious ? 'L' : 'M';
			hasPrevious = true;
			return command + x(point.startMs).toFixed(2) + ',' + y(point.meanHours).toFixed(2);
		})
		.join(' ');
}

export const RamadanSeasons = memo(function RamadanSeasons({ city, locatedCity }: Props) {
	const id = useId();
	const [startYear] = useState(() => new Date().getUTCFullYear());
	const [comparisonName, setComparisonName] = useState('');
	const [result, setResult] = useState<RamadanResult | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');
	const [index, setIndex] = useState(0);
	const [retry, setRetry] = useState(0);
	const comparisonCities = useMemo(() => CITIES.filter(candidate => candidate.n !== city?.n), [city?.n]);
	// Grouped by continent and carrying latitude, because latitude is the whole
	// mechanism here — two cities differ in fasting hours to the degree they
	// differ in how far from the equator they sit.
	const compareOptions = useMemo(() => {
		const rest = comparisonCities.map(candidate => ({
			value: candidate.n,
			label: candidate.n,
			meta: latTxt(candidate.la),
			group: cityContinent(candidate)
		}));
		// Nothing to lift when the reader is already looking at their own city.
		if (!locatedCity || locatedCity.n === city?.n) {
			return rest;
		}
		// Lifted out of its continent rather than copied into a second place: two
		// rows for one city would be a bug the moment someone picked the other one.
		return [
			{
				value: locatedCity.n,
				label: locatedCity.n,
				meta: latTxt(locatedCity.la),
				group: 'My location'
			},
			...rest.filter(option => option.value !== locatedCity.n)
		];
	}, [comparisonCities, locatedCity, city?.n]);
	const comparison = useMemo(() => {
		if (!comparisonName) {
			return null;
		}
		// Checked before the list: a located city can be a guest that was never in
		// CITIES, and looking only there would offer it and then find nothing.
		if (locatedCity?.n === comparisonName) {
			return locatedCity;
		}
		return CITIES.find(candidate => candidate.n === comparisonName) ?? null;
	}, [comparisonName, locatedCity]);
	useEffect(() => {
		if (!city) {
			setResult(null);
			return;
		}
		let worker: Worker;
		setIsLoading(true);
		setError('');
		try {
			worker = new Worker(new URL('../lib/ramadan-seasons.worker.ts', import.meta.url), { type: 'module' });
			worker.onmessage = (event: MessageEvent<RamadanResult & { error?: string }>) => {
				if (event.data.error) {
					setError(event.data.error);
					setResult(null);
				} else setResult(event.data);
				setIsLoading(false);
			};
			worker.onerror = () => {
				setError('The seasonal comparison could not load.');
				setIsLoading(false);
			};
			const cities = [city, ...(comparison && comparison.n !== city.n ? [comparison] : [])].map(item => ({
				name: item.n,
				lat: item.la,
				lon: item.lo
			}));
			worker.postMessage({ id: 1, startYear, cities });
		} catch {
			setError('The seasonal comparison could not load.');
			setIsLoading(false);
			return;
		}
		return () => worker.terminate();
	}, [city?.n, city?.la, city?.lo, comparison, startYear, retry]);
	const primary = result?.series[0],
		secondary = result?.series[1];
	const activeIndex = Math.min(index, Math.max(0, (primary?.points.length ?? 1) - 1));
	const selected = primary?.points[activeIndex];
	const comparePoint = secondary?.points[activeIndex];
	const start = Date.UTC(startYear, 0, 1),
		end = Date.UTC(startYear + 33, 0, 1);
	const x = (ms: number) => LEFT + ((ms - start) / (end - start)) * (RIGHT - LEFT);
	const select = (next: number) => {
		setIndex(next);
	};
	return (
		<section id='ramadan-seasons' tabIndex={-1} className='ramadan-seasons' aria-labelledby={id + '-title'}>
			<header className='ramadan-seasons-head'>
				<div>
					<Label color='accent' className='ramadan-seasons-eyebrow'>
						Ramadan · through the seasons
					</Label>
					<Display as='h2' size='sm' id={id + '-title'}>
						Ramadan travels through the seasons.
					</Display>
					<Body as='p' color='muted'>
						About eleven days earlier each year. Follow how dawn-to-sunset fasting windows change across 33
						solar years.
					</Body>
				</div>
				<Value size='xs' color='muted' className='ramadan-seasons-period'>
					{startYear}—{startYear + 33}
				</Value>
			</header>
			{!city ? (
				<Body as='p' color='muted' className='ramadan-seasons-empty'>
					Select a city dot on the globe to explore its Ramadan seasons.
				</Body>
			) : (
				<>
					<div className='ramadan-seasons-toolbar'>
						<Title as='strong' size='xs'>
							<span className='ramadan-series-key' />
							{city.n}
						</Title>
						{/*
							A searchable list rather than a native select.

							The choice is one of 890 cities, which a native menu presents as
							one alphabetical column you scroll: finding Tromsø meant knowing
							it was there and travelling to the T's. Typing is how anyone
							actually picks from a list this long, and the latitude beside
							each name is the thing being compared — a fasting window is a
							function of how far north you are, so it belongs in the choosing
							rather than only in the answer.

							"No comparison" is the clear button now: an explicit row for
							"nothing" reads oddly in a list you search.
						*/}
						<Combobox
							label='Compare with'
							placeholder='Search cities…'
							width='260px'
							options={compareOptions}
							value={comparisonName === city.n ? undefined : comparisonName || undefined}
							onChange={next => setComparisonName(next ?? '')}
						/>
					</div>
					{isLoading ? (
						/*
							The chart's own frame, empty and waiting.

							A line of text where a 300-unit chart is about to be left the
							modal a third of its height, so opening it collapsed and then
							jumped once the worker answered. The grid is the part that does
							not depend on the data — the hour lines and the year labels are
							known before a single Ramadan has been computed — so it can be
							drawn immediately and simply gain its curve. Nothing moves; the
							picture just fills in.
						*/
						<>
							<div className='ramadan-seasons-chart ramadan-seasons-loading' role='status'>
								<span className='sr-only'>Calculating the seasons…</span>
								<svg viewBox={'0 0 ' + WIDTH + ' ' + HEIGHT} aria-hidden='true'>
									{[0, 6, 12, 18, 24].map(hours => (
										<g key={hours}>
											<line
												x1={LEFT}
												x2={RIGHT}
												y1={y(hours)}
												y2={y(hours)}
												className='ramadan-grid'
											/>
											<text x={LEFT - 10} y={y(hours) + 4} textAnchor='end'>
												{hours}h
											</text>
										</g>
									))}
									{[0, 8, 16, 24, 33].map(year => (
										<text
											key={year}
											x={x(Date.UTC(startYear + year, 0, 1))}
											y={BOTTOM + 28}
											textAnchor={year === 33 ? 'end' : 'middle'}
										>
											{startYear + year}
										</text>
									))}
									{/* Where the curve will be, as a hint rather than a promise:
								    a real fasting curve is a wave, and drawing a plausible one
								    would be inventing data the worker has not returned yet. */}
									<line
										x1={LEFT}
										x2={RIGHT}
										y1={y(12)}
										y2={y(12)}
										className='ramadan-curve ramadan-curve-pending'
									/>
								</svg>
							</div>
							{/*
							The rest of the layout, held open but empty.

							The chart alone was not enough: measured, the panel still went
							from 612px to 916px the moment the worker answered, because the
							legend, the slider and the readouts all arrived together. These
							are those same elements with nothing in them, so the height is
							the real height rather than a number guessed and left to rot.
						*/}
							<div className='ramadan-seasons-pending' aria-hidden='true'>
								<div className='ramadan-seasons-legend'>
									<Caption size='sm' color='muted'>
										&nbsp;
									</Caption>
								</div>
								<div className='ramadan-year-label'>
									<Title size='xs'>&nbsp;</Title>
									<Caption size='sm' color='muted'>
										&nbsp;
									</Caption>
								</div>
								<input
									className='ramadan-year-slider'
									type='range'
									min={0}
									max={1}
									value={0}
									disabled
									readOnly
								/>
								<Body as='p' color='muted' size='sm'>
									&nbsp;
								</Body>
								<div className='ramadan-seasons-readouts'>
									<div>
										<Title as='h3' size='xs'>
											&nbsp;
										</Title>
										<Value as='strong' size='xl' color='accent-soft'>
											&nbsp;
										</Value>
										<Caption size='xl' color='muted'>
											&nbsp;
										</Caption>
										<Body as='p' color='muted'>
											&nbsp;
										</Body>
									</div>
								</div>
							</div>
						</>
					) : error ? (
						<div role='alert'>
							<Body as='p' color='muted'>
								{error}
							</Body>
							<button type='button' className='btn' onClick={() => setRetry(value => value + 1)}>
								Try again
							</button>
						</div>
					) : (
						primary &&
						selected && (
							<>
								<div className='ramadan-seasons-chart'>
									<svg
										viewBox={'0 0 ' + WIDTH + ' ' + HEIGHT}
										role='img'
										aria-labelledby={id + '-chart-title ' + id + '-chart-desc'}
									>
										<title id={id + '-chart-title'}>
											Estimated average daily fasting duration by Ramadan, {startYear} to{' '}
											{startYear + 33}
										</title>
										<desc id={id + '-chart-desc'}>
											Solid line: {primary.city.name}.
											{secondary ? ' Dashed line: ' + secondary.city.name + '.' : ''} Thin
											vertical marks show the shortest and longest fast within each month. Gaps
											indicate missing dawn or sunset. Use the year slider below to explore
											values.
										</desc>
										{[0, 6, 12, 18, 24].map(hours => (
											<g key={hours}>
												<line
													x1={LEFT}
													x2={RIGHT}
													y1={y(hours)}
													y2={y(hours)}
													className='ramadan-grid'
												/>
												<text x={LEFT - 10} y={y(hours) + 4} textAnchor='end'>
													{hours}h
												</text>
											</g>
										))}
										{[0, 8, 16, 24, 33].map(year => (
											<text
												key={year}
												x={x(Date.UTC(startYear + year, 0, 1))}
												y={BOTTOM + 28}
												textAnchor={year === 33 ? 'end' : 'middle'}
											>
												{startYear + year}
											</text>
										))}
										{primary.meanHours !== null && (
											<line
												x1={LEFT}
												x2={RIGHT}
												y1={y(primary.meanHours)}
												y2={y(primary.meanHours)}
												className='ramadan-mean'
											>
												<title>
													{primary.city.name}: mean across the period{' '}
													{duration(primary.meanHours)}
												</title>
											</line>
										)}
										{secondary?.meanHours != null && (
											<line
												x1={LEFT}
												x2={RIGHT}
												y1={y(secondary.meanHours)}
												y2={y(secondary.meanHours)}
												className='ramadan-mean ramadan-comparison'
											/>
										)}
										{primary.points.map((point, pointIndex) => (
											<g
												key={point.hijriYear}
												onClick={() => select(pointIndex)}
												className='ramadan-chart-point'
											>
												{point.meanHours !== null ? (
													<>
														<line
															x1={x(point.startMs)}
															x2={x(point.startMs)}
															y1={y(point.shortestHours!)}
															y2={y(point.longestHours!)}
															className='ramadan-range'
														/>
														<circle
															cx={x(point.startMs)}
															cy={y(point.meanHours)}
															r={pointIndex === activeIndex ? 5 : 3}
															className='ramadan-dot'
														/>
														<circle
															cx={x(point.startMs)}
															cy={y(point.meanHours)}
															r={12}
															fill='transparent'
														/>
													</>
												) : (
													<path
														d={
															'M' +
															(x(point.startMs) - 3) +
															',' +
															(BOTTOM - 6) +
															'l6,6m-6,0l6,-6'
														}
														className='ramadan-gap'
													/>
												)}
												<title>
													Ramadan {point.hijriYear} · {dateFormat.format(point.startMs)} ·{' '}
													{point.meanHours === null
														? point.missingDays + ' days need a high-latitude convention'
														: duration(point.meanHours)}
												</title>
											</g>
										))}
										<path d={line(primary, x)} className='ramadan-curve' />
										{secondary && (
											<path d={line(secondary, x)} className='ramadan-curve ramadan-comparison' />
										)}
										<line
											x1={x(selected.startMs)}
											x2={x(selected.startMs)}
											y1={TOP}
											y2={BOTTOM}
											className='ramadan-cursor'
										/>
									</svg>
								</div>
								<div className='ramadan-seasons-legend'>
									<Caption size='sm' color='muted'>
										<i className='ramadan-series-key' />
										{primary.city.name}
									</Caption>
									{secondary && (
										<Caption size='sm' color='muted'>
											<i className='ramadan-series-key ramadan-comparison' />
											{secondary.city.name}
										</Caption>
									)}
									<Caption size='sm' color='muted'>
										Vertical marks: monthly range
									</Caption>
									<Caption size='sm' color='muted'>
										Dotted horizontal line: period mean, where complete
									</Caption>
								</div>
								<label className='ramadan-year-label' htmlFor={id + '-year'}>
									<Title size='xs'>Ramadan {selected.hijriYear} AH</Title>
									<Caption size='sm' color='muted'>
										Estimated start · {dateFormat.format(selected.startMs)}
									</Caption>
								</label>
								<input
									id={id + '-year'}
									className='ramadan-year-slider'
									type='range'
									min={0}
									max={primary.points.length - 1}
									step={1}
									value={activeIndex}
									onChange={event => select(Number(event.target.value))}
									aria-valuetext={
										'Ramadan ' +
										selected.hijriYear +
										', estimated start ' +
										dateFormat.format(selected.startMs)
									}
								/>
								<Body as='p' color='muted' size='sm'>
									Move the slider to compare Ramadan years. Durations below average the whole month.
								</Body>
								<div className='ramadan-seasons-readouts'>
									{[
										{ series: primary, point: selected },
										{ series: secondary, point: comparePoint }
									].map(({ series, point }) =>
										series && point ? (
											<div key={series.city.name}>
												<Title as='h3' size='xs'>
													{series.city.name}
												</Title>
												<Value as='strong' size='xl' color='accent-soft'>
													{duration(point.meanHours)}
												</Value>
												<Caption size='xl' color='muted'>
													average daily fasting window
												</Caption>
												{point.missingDays ? (
													<Body as='p' color='muted'>
														Dawn or sunset is absent on {point.missingDays} of 30 modeled
														days. This month needs a high-latitude convention.
													</Body>
												) : (
													<Body as='p' color='muted'>
														{duration(point.shortestHours)} shortest ·{' '}
														{duration(point.longestHours)} longest
													</Body>
												)}
												<Body as='p' color='muted'>
													{series.meanHours === null
														? series.missingMonths +
														  ' Ramadans have gaps; no full-period mean is shown.'
														: 'Mean across this period: ' + duration(series.meanHours)}
												</Body>
											</div>
										) : null
									)}
								</div>
							</>
						)
					)}
				</>
			)}
		</section>
	);
});
