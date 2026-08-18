import { useMemo, useRef, useState } from 'react';
import { CITIES } from '../lib/cities';
import type { City } from '../lib/cities';
import { normalize } from '../lib/diyanet';

const MAX_RESULTS = 7;

// Precomputed so typing never re-normalises 143 names per keystroke.
const INDEX = CITIES.map(city => ({ city, key: normalize(city.n) }));

interface CitySearchProps {
	onSelect(city: City): void;
}

export default function CitySearch({ onSelect }: CitySearchProps) {
	const [query, setQuery] = useState('');
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const results = useMemo(() => {
		const q = normalize(query);
		if (!q) {
			return [];
		}
		// Prefix matches first — typing "ma" should offer Madinah before Amman.
		const starts: City[] = [];
		const contains: City[] = [];
		for (const { city, key } of INDEX) {
			if (key.startsWith(q)) starts.push(city);
			else if (key.includes(q)) contains.push(city);
		}
		return [...starts, ...contains].slice(0, MAX_RESULTS);
	}, [query]);

	const choose = (city: City) => {
		onSelect(city);
		setQuery(city.n);
		setOpen(false);
		setActive(0);
		inputRef.current?.blur();
	};

	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Escape') {
			setOpen(false);
			inputRef.current?.blur();
			return;
		}
		if (!results.length) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setOpen(true);
			setActive(i => (i + 1) % results.length);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			setOpen(true);
			setActive(i => (i - 1 + results.length) % results.length);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			choose(results[Math.min(active, results.length - 1)]);
		}
	};

	const showList = open && results.length > 0;

	return (
		<div className='search'>
			<input
				ref={inputRef}
				className='search-input'
				type='text'
				value={query}
				placeholder='Search a city'
				aria-label='Search a city'
				role='combobox'
				aria-expanded={showList}
				aria-controls='city-results'
				aria-autocomplete='list'
				autoComplete='off'
				spellCheck={false}
				onChange={e => {
					setQuery(e.target.value);
					setOpen(true);
					setActive(0);
				}}
				onFocus={() => setOpen(true)}
				// Delayed so a click on a result lands before the list unmounts.
				onBlur={() => window.setTimeout(() => setOpen(false), 120)}
				onKeyDown={onKeyDown}
			/>

			{showList && (
				<ul className='search-list' id='city-results' role='listbox'>
					{results.map((city, i) => (
						<li key={city.n} role='option' aria-selected={i === active}>
							<button
								type='button'
								className={'search-item' + (i === active ? ' search-item-on' : '')}
								onMouseEnter={() => setActive(i)}
								onMouseDown={e => e.preventDefault()}
								onClick={() => choose(city)}
							>
								<span className='search-name'>{city.n}</span>
								<span className='search-coord'>
									{Math.abs(city.la).toFixed(1)}°{city.la >= 0 ? 'N' : 'S'}{' '}
									{Math.abs(city.lo).toFixed(1)}°{city.lo >= 0 ? 'E' : 'W'}
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
