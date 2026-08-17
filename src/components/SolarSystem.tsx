// The design's `Solar System 3D.html`, as a page in this app.
//
// The original is a standalone document: a full-viewport <three-d-stage> with a
// HUD docked to the bottom — a plate naming the body and listing four facts, and
// a rail of buttons to switch between them. That structure is kept exactly; what
// changed is that the stage is now `createStage` (see stage.ts) and the rail is
// React state rather than buttons appended in a loop.
//
// Earth is absent on purpose. In this app the globe *is* the earth, so the
// design's default selection moves to the sun.

import { useEffect, useRef, useState } from 'react';
import { AppIcon } from './AppIcon';
import { createStage } from './stage';
import type { Stage } from './stage';
import { buildBody, BODY_IDS } from '../lib/planets-model';
import type { BodyId } from '../lib/planets-model';

interface BodyInfo {
	name: string;
	/** Rail dot colour, straight from the design. */
	swatch: string;
	/** The four figures the plate shows, in order. */
	facts: [string, string][];
}

const INFO: Record<BodyId, BodyInfo> = {
	sun: {
		name: 'Sun',
		swatch: '#ffcf5c',
		facts: [
			['Radius', '695,700 km'],
			['Type', 'G2V star'],
			['Surface', '5,772 K'],
			['Rotation', '25.4 d']
		]
	},
	mercury: {
		name: 'Mercury',
		swatch: '#9c9088',
		facts: [
			['Radius', '2,440 km'],
			['Orbit', '88 d'],
			['Day', '176 d'],
			['Moons', '0']
		]
	},
	venus: {
		name: 'Venus',
		swatch: '#e8c98a',
		facts: [
			['Radius', '6,052 km'],
			['Orbit', '225 d'],
			['Day', '243 d (retro)'],
			['Cloud top', '737 K']
		]
	},
	moon: {
		name: 'Moon',
		swatch: '#cfc9bf',
		facts: [
			['Radius', '1,737 km'],
			['Orbit', '27.3 d'],
			['Day', '29.5 d'],
			['Gravity', '1.62 m/s²']
		]
	},
	mars: {
		name: 'Mars',
		swatch: '#c1502e',
		facts: [
			['Radius', '3,390 km'],
			['Orbit', '687 d'],
			['Day', '24h 37m'],
			['Moons', '2']
		]
	},
	jupiter: {
		name: 'Jupiter',
		swatch: '#d9a878',
		facts: [
			['Radius', '69,911 km'],
			['Orbit', '11.86 y'],
			['Day', '9h 56m'],
			['Moons', '95']
		]
	},
	saturn: {
		name: 'Saturn',
		swatch: '#e0c58c',
		facts: [
			['Radius', '58,232 km'],
			['Orbit', '29.45 y'],
			['Day', '10h 33m'],
			['Moons', '146']
		]
	},
	uranus: {
		name: 'Uranus',
		swatch: '#8fd0da',
		facts: [
			['Radius', '25,362 km'],
			['Orbit', '84 y'],
			['Day', '17h 14m'],
			['Moons', '28']
		]
	},
	neptune: {
		name: 'Neptune',
		swatch: '#4a6cd4',
		facts: [
			['Radius', '24,622 km'],
			['Orbit', '164.8 y'],
			['Day', '16h 6m'],
			['Moons', '16']
		]
	}
};

export default function SolarSystem() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const stageRef = useRef<Stage | null>(null);
	const [body, setBody] = useState<BodyId>('sun');
	const [busy, setBusy] = useState(false);

	// The stage outlives every selection: building it per body would throw away
	// the WebGL context and the viewer's camera on each click.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const stage = createStage(canvas);
		stageRef.current = stage;
		stage.setAutoRotate(true);

		const host = canvas.parentElement;
		const ro = new ResizeObserver(() => stage.resize());
		if (host) ro.observe(host);

		return () => {
			ro.disconnect();
			stage.dispose();
			stageRef.current = null;
		};
	}, []);

	// Swap the object, and start turning again — a fresh body deserves the same
	// introduction the first one got.
	useEffect(() => {
		const stage = stageRef.current;
		if (!stage) return;
		stage.setObject(buildBody(body));
		stage.setAutoRotate(true);
	}, [body]);

	const info = INFO[body];

	const save = async (kind: 'obj' | 'glb') => {
		const stage = stageRef.current;
		if (!stage || busy) return;
		setBusy(true);
		try {
			await (kind === 'obj' ? stage.exportObj(body) : stage.exportGlb(body));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className='ss'>
			<canvas ref={canvasRef} className='ss-canvas' />

			<div className='ss-tools'>
				{/* These buttons write a file, so they say so — the dot they used to
				    carry said nothing at all. */}
				<button type='button' onClick={() => save('obj')} disabled={busy}>
					<span className='ss-dot'>
						<AppIcon name='download' size='small' />
					</span>
					OBJ&nbsp;+&nbsp;MTL
				</button>
				<button type='button' onClick={() => save('glb')} disabled={busy}>
					<span className='ss-dot'>
						<AppIcon name='download' size='small' />
					</span>
					GLB
				</button>
			</div>

			<a className='ss-back' href='#/'>
				<AppIcon name='arrow-left' size='small' />
				Globe
			</a>
			<p className='ss-note'>Drag to orbit · scroll to zoom · right-drag to pan</p>

			<div className='ss-hud'>
				<div className='ss-plate'>
					<h1>{info.name}</h1>
					<dl>
						{info.facts.map(([k, v]) => (
							<div key={k} className='ss-fact'>
								<dt>{k}</dt>
								<dd>{v}</dd>
							</div>
						))}
					</dl>
				</div>

				<div className='ss-rail'>
					{BODY_IDS.map(id => (
						<button key={id} type='button' aria-pressed={id === body} onClick={() => setBody(id)}>
							<span className='ss-swatch' style={{ background: INFO[id].swatch }} />
							{INFO[id].name}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
