import { PHASES } from './astro';

const HEX = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const PHASE_RGB = PHASES.map(p => HEX(p.c));

/** Blend two phase colours, so a dot eases into its next prayer. */
export function mixPhase(a: number, b: number, t: number): string {
	if (t <= 0 || a === b) {
		return PHASES[a].c;
	}
	const x = PHASE_RGB[a];
	const y = PHASE_RGB[b];
	const m = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t);
	return `rgb(${m(0)},${m(1)},${m(2)})`;
}
