// The month of fasting, drawn as a shape.
//
// The day arc answers "where am I in today?". This answers "where am I in the
// month?" — one row per day, each a bar from imsak to maghrib on a shared
// 24-hour track. Read down the rows and the interesting thing is not any single
// day but the drift: the window slides and narrows or widens across the month,
// and at high latitude it does so dramatically.

import { ramadanMonth } from '../lib/ramadan';
import type { TimetableDay } from '../lib/diyanet';
import { Caption, Display, Label } from './Typography';

interface Props {
	days: TimetableDay[] | null;
	nowMs: number;
	cityName: string;
	/** Waiting on this city's timetable. */
	pending: boolean;
}

export default function RamadanPanel({ days, nowMs, cityName, pending }: Props) {
	const month = days?.length ? ramadanMonth(days, nowMs) : null;

	if (pending || !month) {
		return (
			<div className='ram'>
				<div className='ram-empty'>
					{pending ? 'Loading this city’s month…' : 'No timetable for this city yet.'}
				</div>
			</div>
		);
	}

	return (
		<div className='ram'>
			<div className='ram-head'>
				<div>
					<Label as='div' size='sm' className='ram-label'>
						{month.current ? 'THIS MONTH' : 'NEXT IN THE TIMETABLE'}
					</Label>
					<Display as='div' size='sm' className='ram-title'>
						{month.title}
					</Display>
				</div>
				<Caption as='div' size='xl' className='ram-sub'>
					{month.sub}
				</Caption>
			</div>

			{/* Today's fast, only when today is actually in the month being shown —
          otherwise the bar would claim a progress that means nothing. */}
			{month.current && (
				<div className='ram-today'>
					<div className='ram-today-head'>
						<Label size='sm' className='ram-today-label'>
							TODAY’S FAST
						</Label>
						<span className='ram-today-val'>{Math.round(month.pct * 100)}%</span>
					</div>
					<div className='ram-today-bar'>
						<div className='ram-today-fill' style={{ width: `${month.pct * 100}%` }} />
					</div>
					<div className='ram-today-ends'>
						<span>imsak {month.imsak}</span>
						<span>maghrib {month.maghrib}</span>
					</div>
				</div>
			)}

			<div className='ram-axis'>
				<span>00</span>
				<span>06</span>
				<span>12</span>
				<span>18</span>
				<span>24</span>
			</div>

			<div className='ram-days'>
				{month.days.map(d => (
					<div
						key={d.n}
						className={'ram-day' + (d.today ? ' ram-day-on' : '')}
						data-tip={`${d.n} · ${d.imsak} → ${d.maghrib}`}
						data-tip-above=''
					>
						<Label size='2xs' className='ram-day-n'>
							{d.n}
						</Label>
						<span className='ram-day-track'>
							<span
								className='ram-day-bar'
								style={{ left: `${d.left * 100}%`, width: `${d.width * 100}%` }}
							/>
						</span>
					</div>
				))}
			</div>

			<p className='ram-note'>
				Each bar is one day’s fast in {cityName}, imsak to maghrib on a 24-hour track. The drift is the month.
			</p>
		</div>
	);
}
