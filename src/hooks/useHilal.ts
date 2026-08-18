// Drives the crescent worker, and holds the evening it last answered for.
//
// The field depends on two things only — which evening, and which criterion —
// so it is recomputed when either changes and at no other time. In particular
// it does not follow the clock: this map is not an instant, it is a whole
// evening judged at each place's own best moment, so a running scrubber has
// nothing to say to it beyond which date it lands on.

import { useEffect, useRef, useState } from 'react';
import type { Criterion } from '../lib/hilal';
import type { Field, CitySummary } from '../lib/hilal-field';
import type { HilalReply, HilalRequest } from '../workers/hilal.worker';

export interface HilalState {
	/** The latest field — possibly the coarse pass, while `busy` is still true. */
	field: Field | null;
	/** Cities per zone, and the best-placed one — for the legend and the card. */
	summary: CitySummary;
	/** A finer field is still coming. */
	busy: boolean;
}

/** The UTC date of an instant, as midday — the key an evening is asked for by. */
export const eveningKey = (ms: number): number => {
	const d = new Date(ms);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
};

export function useHilal(eveningMs: number | null, criterion: Criterion): HilalState {
	const [field, setField] = useState<Field | null>(null);
	const [summary, setSummary] = useState<CitySummary>({ counts: {}, best: null });
	const [busy, setBusy] = useState(false);
	const workerRef = useRef<Worker | null>(null);
	/** The question currently outstanding; a reply with any other id is stale. */
	const askRef = useRef(0);

	// One worker for the life of the panel. Starting one per request would spend
	// more time parsing the module than computing the answer.
	useEffect(() => {
		const w = new Worker(new URL('../workers/hilal.worker.ts', import.meta.url), { type: 'module' });
		workerRef.current = w;
		w.onmessage = (e: MessageEvent<HilalReply>) => {
			if (e.data.id !== askRef.current) return;
			// The coarse pass is shown as soon as it lands, so the globe fills in
			// early; `busy` stays true until the fine one replaces it, so the panel
			// keeps saying so rather than implying the map is final.
			setField(e.data);
			setSummary(e.data.summary);
			if (!e.data.coarse) setBusy(false);
		};
		return () => {
			w.terminate();
			workerRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (eveningMs == null) return;
		const w = workerRef.current;
		if (!w) return;
		const id = askRef.current + 1;
		askRef.current = id;
		setBusy(true);
		const req: HilalRequest = { id, eveningMs, criterion };
		w.postMessage(req);
	}, [eveningMs, criterion]);

	return { field, summary, busy };
}
