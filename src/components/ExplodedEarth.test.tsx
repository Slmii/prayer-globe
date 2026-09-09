import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExplodedEarth } from './ExplodedEarth.component';
import { CONTINENTS } from '../lib/continents';

describe('embedded exploded globe', () => {
	it('renders inside the map with continent navigation and no dialog or city search', () => {
		const html = renderToStaticMarkup(
			<ExplodedEarth
				initialContinent='Africa'
				world={{ type: 'FeatureCollection', features: [] }}
				phases={null}
				guestCity={null}
				activeCity={null}
				highlightPhase={null}
				getNowMs={() => Date.UTC(2026, 8, 8)}
				onCitySelect={() => {}}
				onCityHover={() => {}}
				onClose={() => {}}
			/>
		);
		expect(html).toContain('class="inline-earth"');
		expect(html).toContain('Spherical continent pieces');
		expect(html).not.toContain('role="dialog"');
		expect(html).not.toContain('<input');
		expect(html).not.toContain('earth-city-list');
		for (const continent of CONTINENTS) expect(html).toContain(`>${continent}</button>`);
		expect(html).toContain('Return to globe');
	});
});
