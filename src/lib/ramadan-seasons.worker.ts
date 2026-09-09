import { ramadanSeasons } from './ramadan-seasons';
import type { RamadanRequest, RamadanResult } from './ramadan-seasons';
self.onmessage = (event: MessageEvent<RamadanRequest>) => {
	const { id, startYear, cities } = event.data;
	try {
		const result: RamadanResult = { id, series: cities.map(city => ramadanSeasons(city, startYear)) };
		self.postMessage(result);
	} catch {
		self.postMessage({ id, error: 'The seasonal comparison could not be calculated.' });
	}
};
