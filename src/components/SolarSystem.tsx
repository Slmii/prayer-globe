import { useEffect, useRef, useState } from 'react';
import { AppIcon } from './AppIcon';
import { createStage } from './stage';
import type { Stage } from './stage';
import { buildBody, BODY_IDS } from '../lib/planets-model';
import type { BodyId } from '../lib/planets-model';
import { buildSolarSystem, buildSeasons } from '../lib/solar-system-model';

interface BodyInfo {
	name: string;
	/** Rail dot colour, straight from the design. */
	swatch: string;
	/** The four figures the plate shows, in order. */
	facts: [string, string][];
}

const INFO: Record<BodyId, BodyInfo> = {
	earth: {
		name: 'Earth',
		swatch: '#8bc5dc',
		facts: [
			['Radius', '6,371 km'],
			['Axial tilt', '23.44°'],
			['Orbit', '365.25 d'],
			['Moon', '1']
		]
	},
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

export function SolarSystem() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const stageRef = useRef<Stage | null>(null);
	const [body, setBody] = useState<BodyId>('earth');
	const [busy, setBusy] = useState(false);
	const [view, setView] = useState<'system' | 'body' | 'seasons'>('system');
	const [season, setSeason] = useState(0);
	const [hasError, setHasError] = useState(false);
	const [isTurning, setIsTurning] = useState(false);
	const [isMoving, setIsMoving] = useState(true);

	// The stage outlives every selection: building it per body would throw away
	// the WebGL context and the viewer's camera on each click.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		let stage: Stage;
		try {
			stage = createStage(canvas, { isSpace: true });
		} catch {
			setHasError(true);
			return;
		}
		stageRef.current = stage;
		stage.setAutoRotate(false);

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
		try {
			stage.setObject(
				view === 'system' ? buildSolarSystem() : view === 'seasons' ? buildSeasons() : buildBody(body)
			);
			stage.setAutoRotate(false);
			setIsTurning(false);
			setHasError(false);
		} catch {
			setHasError(true);
		}
	}, [body, view]);
	useEffect(() => {
		const angle = (season * Math.PI) / 2;
		if (view === 'seasons') stageRef.current?.setLightDirection(8 * Math.cos(angle), 0, 8 * Math.sin(angle));
		else stageRef.current?.setLightDirection(4, 3, 5);
	}, [season, view]);

	const info =
		view === 'system'
			? {
					name: 'The solar system',
					facts: [
						['View', 'Eight planets'],
						['Distances', 'Compressed'],
						['Planet sizes', 'Enlarged'],
						['Motion', '1 Earth year / 40 s']
					]
				}
			: view === 'seasons'
				? {
						name: 'Earth, through the seasons',
						facts: [
							['Axis', '23.44° tilt'],
							[
								'Sunlight',
								['June solstice', 'September equinox', 'December solstice', 'March equinox'][season]
							],
							['North', ['Summer', 'Autumn', 'Winter', 'Spring'][season]],
							['South', ['Winter', 'Spring', 'Summer', 'Autumn'][season]]
						]
					}
				: INFO[body];

	const save = async (kind: 'obj' | 'glb') => {
		const stage = stageRef.current;
		if (!stage || busy) return;
		setBusy(true);
		try {
			await (kind === 'obj'
				? stage.exportObj(view === 'body' ? body : view)
				: stage.exportGlb(view === 'body' ? body : view));
		} catch {
			setHasError(true);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className='ss'>
			<canvas ref={canvasRef} className='ss-canvas' aria-label={info.name + ', interactive 3D view'} />
			{hasError && (
				<p className='ss-error' role='status'>
					This 3D view could not load. Try reopening the solar system.
				</p>
			)}
			<div className='ss-view-tabs' role='group' aria-label='Solar system view'>
				{(['system', 'body', 'seasons'] as const).map(value => (
					<button key={value} type='button' aria-pressed={view === value} onClick={() => setView(value)}>
						{value === 'system' ? 'Overview' : value === 'body' ? 'Planet detail' : 'Earth & seasons'}
					</button>
				))}
			</div>

			<div className='ss-tools'>
				{view === 'system' && (
					<button
						type='button'
						aria-pressed={isMoving}
						onClick={() => {
							setIsMoving(value => !value);
							stageRef.current?.setAnimationEnabled(!isMoving);
						}}
					>
						{isMoving ? 'Pause planets' : 'Play planets'}
					</button>
				)}
				<button
					type='button'
					aria-pressed={isTurning}
					onClick={() => {
						const next = !isTurning;
						setIsTurning(next);
						stageRef.current?.setAutoRotate(next);
					}}
				>
					{isTurning ? 'Stop orbit' : 'Orbit view'}
				</button>
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
			<p className='ss-note'>
				Drag to orbit · Scroll to zoom
				<br />
				{view === 'system'
					? 'Illustrative starting positions. Sizes and distances are not to scale.'
					: view === 'seasons'
						? 'The axis stays tilted as the direction of sunlight changes.'
						: 'Geographic Earth model · Illustrative planetary surfaces'}
			</p>

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

				<div className='ss-rail' role='group' aria-label={view === 'seasons' ? 'Season' : 'Planet'}>
					{view === 'seasons' ? (
						['June', 'September', 'December', 'March'].map((label, index) => (
							<button
								key={label}
								type='button'
								aria-pressed={season === index}
								onClick={() => setSeason(index)}
							>
								{label}
							</button>
						))
					) : (
						<>
							{BODY_IDS.map(id => (
								<button
									key={id}
									type='button'
									aria-pressed={id === body}
									onClick={() => {
										setBody(id);
										setView('body');
									}}
								>
									<span className='ss-swatch' style={{ background: INFO[id].swatch }} />
									{INFO[id].name}
								</button>
							))}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
