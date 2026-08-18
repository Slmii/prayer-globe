// The design's `Mosques 3D.html`, as a modal over the globe.
//
// The original is a standalone document: a full-viewport <three-d-stage> with a
// rail of buttons down the left naming each mosque, its city and era, and a line
// on what makes it itself. That structure is kept. What changed is that it opens
// on the mosque you pressed rather than on the first in the list, and that it is
// a modal rather than a page — the globe is still behind it, and closing returns
// you to exactly the view you left.
//
// The stage is `createStage` (see stage.ts), the same one the Solar System page
// uses. Export is deliberately absent: this viewer is for looking.

import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { createStage } from './stage';
import type { Stage } from './stage';
import Modal from './Modal';
import { DESIGN_MOSQUES, buildDesignMosque } from '../lib/mosques-model';
import { buildKaaba } from '../lib/kaaba-model';
import { buildNabawi } from '../lib/nabawi-model';
import { MOSQUES } from '../lib/mosques';
import type { MosqueModel } from '../lib/mosques';
import { EXTRA_PLATES } from '../lib/mosque-views';
import type { Plate } from '../lib/mosque-views';

interface Entry extends Plate {
	model: MosqueModel;
	build: () => THREE.Group;
}

const BUILD_EXTRA: Partial<Record<MosqueModel, () => THREE.Group>> = {
	kaaba: buildKaaba,
	nabawi: buildNabawi
};

const DESIGN_BY_KEY = new Map(DESIGN_MOSQUES.map(m => [m.key as MosqueModel, m]));

/**
 * Every building standing on the globe, once each.
 *
 * Driven from the sites rather than from the model library, so the rail lists
 * what is actually out there: a model nobody has placed does not appear, and a
 * site cannot be pressed only to find the viewer has nothing to show. Keyed by
 * model rather than by site so two sites sharing a building would list it once.
 */
const ENTRIES: Entry[] = (() => {
	const out: Entry[] = [];
	const seen = new Set<MosqueModel>();
	for (const site of MOSQUES) {
		if (seen.has(site.model)) continue;
		seen.add(site.model);
		const design = DESIGN_BY_KEY.get(site.model);
		if (design) {
			const { name, city, era, note } = design;
			out.push({ model: site.model, name, city, era, note, build: () => buildDesignMosque(site.model) });
			continue;
		}
		const plate = EXTRA_PLATES[site.model];
		const build = BUILD_EXTRA[site.model];
		if (plate && build) out.push({ model: site.model, ...plate, build });
	}
	return out;
})();

interface Props {
	/** Which building to open on — the one that was pressed. */
	model: MosqueModel;
	onClose(): void;
}

export default function MosqueViewer({ model, onClose }: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const stageRef = useRef<Stage | null>(null);
	const railRef = useRef<HTMLDivElement>(null);
	const [current, setCurrent] = useState<MosqueModel>(model);
	/** A model is being assembled. True from the first paint, not after it. */
	const [building, setBuilding] = useState(true);

	// The stage outlives every selection: building it per mosque would throw away
	// the WebGL context and the viewer's camera on each click.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const stage = createStage(canvas);
		stageRef.current = stage;

		const host = canvas.parentElement;
		const ro = new ResizeObserver(() => stage.resize());
		if (host) ro.observe(host);

		return () => {
			ro.disconnect();
			stage.dispose();
			stageRef.current = null;
		};
	}, []);

	/*
	 * Swap the object, and start turning again — a fresh building deserves the
	 * same introduction the first one got.
	 *
	 * Built two frames late, on purpose. These are hand-assembled models of a few
	 * hundred meshes and merging one blocks the main thread for tens of
	 * milliseconds; the first one also lands while three.js is still warming.
	 * Building it inline meant the canvas was mounted and empty, then stuttered
	 * as the model appeared and the camera snapped to frame it — the flicker.
	 * Yielding first lets React paint the spinner and the browser show it, so the
	 * pause reads as loading rather than as a fault.
	 */
	useEffect(() => {
		const stage = stageRef.current;
		const entry = ENTRIES.find(e => e.model === current);
		if (!stage || !entry) return;
		setBuilding(true);
		let second = 0;
		const first = requestAnimationFrame(() => {
			second = requestAnimationFrame(() => {
				stage.setObject(entry.build());
				stage.setAutoRotate(true);
				setBuilding(false);
			});
		});
		return () => {
			cancelAnimationFrame(first);
			cancelAnimationFrame(second);
		};
	}, [current]);

	// Bring the opened mosque into view in the rail, which is long enough that it
	// is otherwise anyone's guess whether the highlighted row is even on screen.
	useEffect(() => {
		railRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
	}, [current]);

	const entry = ENTRIES.find(e => e.model === current) ?? ENTRIES[0];

	return (
		<Modal label={`${entry.name} in 3D`} onClose={onClose} className='mv'>
				<div className='mv-rail' ref={railRef}>
					<h2 className='mv-rail-head'>{ENTRIES.length} mosques</h2>
					{ENTRIES.map(e => (
						<button
							key={e.model}
							type='button'
							aria-pressed={e.model === current}
							onClick={() => setCurrent(e.model)}
						>
							<span className='mv-rail-n'>{e.name}</span>
							<span className='mv-rail-c'>
								{e.city} · {e.era}
							</span>
						</button>
					))}
				</div>

				<div className='mv-stage'>
					<canvas ref={canvasRef} className='mv-canvas' />

					{/* Over the canvas, where the building is about to be — not a
					    banner somewhere else on the page saying that something,
					    somewhere, is happening. */}
					{building && (
						<div className='mv-building' role='status'>
							<span className='mv-spinner' aria-hidden='true' />
							<span>Assembling {entry.name}</span>
						</div>
					)}

					<p className='mv-note'>Drag to orbit · scroll to zoom · right-drag to pan</p>

					<div className='mv-plate'>
						<h1>{entry.name}</h1>
						<p className='mv-plate-where'>
							{entry.city} · {entry.era}
						</p>
						<p className='mv-plate-note'>{entry.note}</p>
					</div>
			</div>
		</Modal>
	);
}
