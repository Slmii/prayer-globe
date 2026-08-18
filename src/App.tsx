import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import Globe from './components/Globe';
import type { GlobeHandle, PathMode, QiblaMode } from './components/Globe';
import SidePanel from './components/SidePanel';
import TimeBar from './components/TimeBar';
import type { PanelMode } from './components/SidePanel';
import Legend from './components/Legend';
import TipLayer from './components/TipLayer';
import { AppIcon } from './components/AppIcon';
import { ToastContainer } from 'react-toastify';
import { say, amend, TOAST_MS } from './components/Toast';
import type { Note } from './components/Toast';
import { CITIES } from './lib/cities';
import type { City } from './lib/cities';
import { useWorldGeo, usePrayerTimes, usePhases } from './hooks/queries';
import { useQueryClient } from '@tanstack/react-query';
import { useClock, useSettledValue, SWEEP_MINUTES, SWEEP_SPEEDS } from './hooks/util';
import { useTransportKeys } from './hooks/useTransportKeys';
import { pulse } from './lib/pulse';
import { buildReadout, citiesInPhase } from './lib/readout';
import { decodeView, encodeView, loadPinned, savePinned, resolvePin, pinName, MAX_PINNED } from './lib/permalink';
import type { Pin } from './lib/permalink';
import { pad, phaseCentre, skyState } from './lib/astro';
import { locateDistrict } from './lib/locate';
import { MOSQUES } from './lib/mosques';
import type { MosqueModel } from './lib/mosques';
import { useHilal, eveningKey } from './hooks/useHilal';
import { nextConjunction, toJD, fromJD } from './lib/hilal';
import type { Criterion } from './lib/hilal';

/**
 * The 3D viewer, fetched only when someone asks for it.
 *
 * It pulls in the whole model library and a second WebGL context for a modal
 * most visits never open, and the globe's own three.js is already lazy for the
 * same reason — putting this in the initial bundle would undo that.
 */
const MosqueViewer = lazy(() => import('./components/MosqueViewer'));

/** The qibla scene, fetched when asked for — it pulls in three.js and the Kaaba. */
const QiblaViewer = lazy(() => import('./components/QiblaViewer'));
/** The shortcut sheet: a list of text, and nobody opens it on the first frame. */
const Shortcuts = lazy(() => import('./components/Shortcuts'));

// Minutes of simulated time per real second while playing — 10 days in ~40s.
const PLAY_RATE = 360;

/**
 * The pace every run is quoted at, in seconds.
 *
 * 1× is forty seconds: ten days of Play, or one circuit of the chain sweep. The
 * speed keys scale whatever is running away from this, so a single multiplier
 * covers both — they used to reach only the sweep, which meant pressing 4× while
 * the console was playing the day did nothing at all.
 */
const BASE_SECONDS = 40;

/**
 * How far a run of "Play" travels, in days.
 *
 * Five keys on the strip, labelled by the number alone — the console has room to
 * show every choice, so there is no menu to open to find out what they are.
 */
const PLAY_OPTIONS: { days: number }[] = [{ days: 1 }, { days: 2 }, { days: 4 }, { days: 8 }, { days: 10 }];

/**
 * The chain's own pace: one full day, at a speed you choose.
 *
 * Ten days at PLAY_RATE is the wrong gesture for watching a prayer travel — the
 * band laps the earth before you can follow it. A day is the natural unit here,
 * because a day is exactly one circuit. How long that circuit should take is
 * genuinely a matter of taste: slow enough to read the cities it passes, or fast
 * enough to see the whole loop close.
 */

/**
 * Panel names for the share message. `now` is absent on purpose: it is the
 * default panel, so naming it would add a clause that says nothing.
 */
const MODE_NAMES: Record<PanelMode, string | null> = {
	now: null,
	chain: 'Chain',
	records: 'Records',
	ramadan: 'Ramadan',
	hilal: 'Hilal'
};

/** "41.01° N 28.98° E" — where the reader is, as a toast states it. */
function coordLabel(lat: number, lon: number): string {
	const ns = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}`;
	return `${ns} ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
}

/** "+2d 06h 15m", or "now" at the present instant. */
function scrubLabelOf(minutes: number): string {
	const r = Math.round(minutes);
	if (r === 0) return 'now';
	const abs = Math.abs(r);
	const d = Math.floor(abs / 1440);
	const h = Math.floor((abs % 1440) / 60);
	return (r > 0 ? '+' : '−') + (d ? `${d}d ` : '') + `${h}h ${pad(abs % 60)}m`;
}

/**
 * What the address bar asked for, read once before the first render.
 *
 * This used to be read inside an effect, and it raced the effect that writes the
 * URL back: the writer went first, with the app's defaults, and the reader then
 * dutifully restored those defaults over the link. A hard reload kept the city
 * and lost the panel, the chain, everything — and under StrictMode, where the
 * reader runs a second time against the already-rewritten hash, it lost the city
 * too. Reading at module scope removes the race rather than ordering it: the
 * first render already holds the linked view, so there is no window in which the
 * URL can be overwritten before it has been seen.
 */
const LINK = decodeView(window.location.hash);

/**
 * The link's city, or nothing at all.
 *
 * There is deliberately no fallback to `CITIES[0]`. That used to open every
 * fresh visit on Aalborg — not a choice anyone made, just the first row of an
 * alphabetical list of 889 cities — and presented it as a selection.
 *
 * Pins do not open anything either, now that there can be five of them: a
 * shortlist has no obvious first member, and picking one would be the same
 * arbitrary choice in a nicer hat. They are offered instead — as buttons in the
 * empty state, and as a row that stays in view — which is also what makes the
 * empty state something you can leave in one click.
 */
const INITIAL_CITY: City | null =
	CITIES.find(c => c.n === LINK.city) ??
	// A city found by locating is not in the bundle, so a link naming it can only
	// be honoured if it was also pinned — the pin is where its record lives. This
	// is what makes "locate, pin, reload" come back to the same place.
	loadPinned()
		.map(resolvePin)
		.find(c => c?.n === LINK.city) ??
	null;

interface View {
	lng: number;
	lat: number;
	zoom: number;
}

export default function App() {
	// With nothing selected the globe turns on its own — which is what the empty
	// state promises ("the globe keeps turning either way"), and it beats opening
	// on a still earth with no reason to look at any part of it. Arriving by link
	// or pin starts still, because that view is already about somewhere.
	const [spin, setSpin] = useState(!INITIAL_CITY);
	/**
	 * The tracks the bodies have taken: off, the sun alone, or both.
	 *
	 * Three states rather than two because the two lines answer different
	 * questions — where the sun has been is about the day, where the moon has been
	 * is about the month — and drawing both at once when you only wanted one is
	 * the sort of clutter that makes people turn the whole thing off.
	 */
	const [pathMode, setPathMode] = useState<PathMode>('off');
	// The sky is always on now that the strip has no switch for it. Kept as a prop
	// rather than inlined so the Globe still has one place to read it from if a
	// control comes back.
	const showOrrery = true;
	const [highlightPhase, setHighlightPhase] = useState<number | null>(null);
	/**
	 * Where the reader is, once they have asked.
	 *
	 * The mark stays for the session rather than expiring: it is the one point on
	 * the globe that is *theirs*, and having it disappear meant the only way back
	 * was to ask again. What expires is the pulse — ten seconds of movement to
	 * catch the eye when it arrives, then a quiet dot that keeps its place.
	 */
	const [mark, setMark] = useState<{ lat: number; lon: number } | null>(null);
	const [markPulsing, setMarkPulsing] = useState(false);
	const [locating, setLocating] = useState(false);
	const markTimer = useRef<number | null>(null);
	const [scrubbing, setScrubbing] = useState(false);
	const highlightTimer = useRef<number | null>(null);
	const [hover, setHover] = useState<{ lat: number; lng: number } | null>(null);
	const [hoveredCity, setHoveredCity] = useState<string | null>(null);
	/** A monument under the pointer — a building the app can show but not read. */
	const [hoveredSite, setHoveredSite] = useState<string | null>(null);
	/** Which building the 3D viewer is showing, or null while it is closed. */
	const [viewer, setViewer] = useState<MosqueModel | null>(null);
	/** The qibla viewer is open for the selected city. */
	const [qiblaOpen, setQiblaOpen] = useState(false);
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	/**
	 * Which rule the crescent map applies.
	 *
	 * A constant, not a choice, because there is no choice yet: everything on
	 * this globe is Diyanet's, and Istanbul 1978 is the rule they apply. The
	 * other criteria are implemented and tested in `hilal.ts` ready for the
	 * method selector that will eventually cover the whole app — this stays a
	 * constant until that exists, rather than pretending to be state nothing can
	 * change.
	 */
	const criterion: Criterion = 'istanbul';
	/** Evenings from tonight that the crescent map is showing. */
	const [hilalDays, setHilalDays] = useState(0);
	const [view, setView] = useState<View>({ lng: 39, lat: 20, zoom: 1.4 });
	/**
	 * The same view, readable without re-subscribing.
	 *
	 * `onCitySelect` needs the zoom the map is at right now, but depending on
	 * `view` would rebuild the callback on every frame of every pan.
	 */
	const viewRef = useRef(view);
	viewRef.current = view;
	const [note, setNote] = useState('loading outlines…');
	const globe = useRef<GlobeHandle>(null);

	const clock = useClock(PLAY_RATE, 200, LINK.scrub ?? 0);
	const { scrub, playing, getNowMs, setScrub: setScrubStable } = clock;
	// Sampled for the panel; the globe samples the clock itself, every frame.
	const nowMs = getNowMs();

	const world = useWorldGeo();
	// The locator reaches the cache imperatively, from a button press.
	const queryClient = useQueryClient();

	// Selection is explicit only: a click on a city dot, or the search box.
	// Deriving it from the map centre relabelled the panel just from turning the
	// globe, and snapping to the nearest city on hover was equally twitchy.
	const [activeCity, setActiveCity] = useState<City | null>(INITIAL_CITY);
	/**
	 * The city the locate button found, held for the session.
	 *
	 * Kept apart from `activeCity` because it outlives the selection: it earns a
	 * dot on the globe like any shipped city, so it can still be hovered, read and
	 * clicked back to after you have gone and looked at somewhere else.
	 */
	const [located, setLocated] = useState<City | null>(null);

	// The city now only changes on a deliberate action, so there is no request
	// storm to guard against — a short settle is enough to coalesce rapid clicks.
	const phases = usePhases().data ?? null;
	/**
	 * Qibla cycles rather than toggles: one city's line answers "which way do I
	 * face", and every city's answers "where does everyone face", which are two
	 * different questions and both worth having.
	 */
	const [qiblaMode, setQiblaMode] = useState<QiblaMode>('off');
	const [mode, setMode] = useState<PanelMode>((LINK.mode as PanelMode) ?? 'now');
	/** How far "Play" runs. Ten days is the ceiling the scrubber allows. */
	const [playDays, setPlayDays] = useState(10);
	const [sweepSeconds, setSweepSeconds] = useState(BASE_SECONDS);
	const [sweepOn, setSweepOn] = useState(false);
	/**
	 * What the clock is running: its 1× rate, and where it stops.
	 *
	 * The console's Play and the chain's sweep are the same clock at different
	 * paces, and the speed keys have to re-pace whichever is running without
	 * moving its destination — so the run records both. Only the sweep used to
	 * record anything, which is why the keys could not reach a run of Play.
	 */
	const run = useRef<{ base: number; limit: number } | null>(null);
	const sweeping = sweepOn && playing !== 0;
	/** The speed keys as a multiplier: ½×, 1×, 2×, 4×. */
	const speedMul = BASE_SECONDS / sweepSeconds;
	/*
	 * The live speed behind the key that steps through it. React state lags a
	 * frame behind a burst of keydowns; this does not, and it is resynced from the
	 * rendered truth below. (The scrub's equivalent lives in the clock, which owns
	 * the glide those presses now compose against.)
	 */
	const speedRef = useRef(sweepSeconds);
	/** Which prayer the chain mode follows. Fajr is the one people picture moving. */
	const [chain, setChain] = useState(LINK.chain ?? 0);

	/**
	 * Pick a prayer to follow, and go and look at it.
	 *
	 * Choosing one without moving the camera left you reading a count for a band
	 * that might be on the far side of the earth — so the globe goes to it. The
	 * cities in the prayer decide where, falling back to the band's own geometry
	 * when it is out over open water and contains none.
	 */
	const selectChain = useCallback(
		(phase: number) => {
			setChain(phase);
			const at = getNowMs();
			const { centre } = citiesInPhase(at, phase, phases);
			const sky = skyState(new Date(at));
			const target = centre ?? phaseCentre(phase, sky.dec, sky.utcH, sky.eot);
			if (!target) return;
			setSpin(false);
			globe.current?.flyTo(target.lon, target.lat, 1.5, 2000);
		},
		[getNowMs, phases]
	);
	const [pinned, setPinned] = useState<Pin[]>(() => loadPinned());

	/**
	 * A city by name, from anywhere its record can live.
	 *
	 * The bundle first, then the city found by locating, then the pins — which is
	 * where a located city's record survives a reload, since nothing else holds it
	 * once the tab closes.
	 *
	 * Every path that turns a name back into a city goes through this: a click on
	 * a dot, a pasted link, the back button. They each used to do their own
	 * `CITIES.find`, and each one silently did nothing for the one city the reader
	 * had gone looking for — the dot answered, the link did not.
	 */
	const cityByName = useCallback(
		(name: string | null | undefined): City | null => {
			if (!name) return null;
			if (located?.n === name) return located;
			return CITIES.find(c => c.n === name) ?? pinned.map(resolvePin).find(c => c?.n === name) ?? null;
		},
		[located, pinned]
	);

	const queryCity = useSettledValue(activeCity, true, 400);
	const times = usePrayerTimes(queryCity);
	const settling = queryCity?.n !== activeCity?.n;
	const querying = settling || times.isLoading || times.isFetching;

	// Diyanet data is only valid for the city it was fetched for.
	const days = !settling && times.days?.length ? times.days : null;

	const readout = useMemo(
		() => buildReadout({ city: activeCity, nowMs, hover, centerLng: view.lng, days, phases }),
		[activeCity, nowMs, hover, view.lng, days, phases]
	);

	/**
	 * Select a city, and optionally travel to it.
	 *
	 * `zoom` is a parameter because the two ways in want different things. Being
	 * sent to a city — from a record, a chain edge, the pinned-home line — means
	 * going to look at it, so it closes in. Clicking a dot means "this one", and
	 * pulling the camera in to street level would throw away the view you were
	 * choosing from, so that keeps whatever zoom you were already at.
	 */
	const selectCity = useCallback((c: City, fly: boolean, zoom = 6.5) => {
		setActiveCity(c);
		if (fly) {
			setSpin(false);
			globe.current?.flyTo(c.lo, c.la, zoom, 1800);
		}
	}, []);

	/**
	 * Travel to the city we opened on — the link's, or the pinned home.
	 *
	 * Only the camera is left here: everything the URL carries is now seeded into
	 * state above, where no effect can race it. This still has to be an effect
	 * because the map does not exist on the first tick, and it retries until it
	 * does. Without that the panel showed the linked city while the globe stayed
	 * where it started — the link half-worked, which is worse than not working,
	 * because nothing tells you the rest was ignored.
	 */
	useEffect(() => {
		const to = INITIAL_CITY;
		// Nothing selected: stay on the whole earth rather than travelling to a
		// place that was never chosen.
		if (!to) return;
		setSpin(false);
		let tries = 0;
		const fly = () => {
			if (globe.current) {
				globe.current.flyTo(to.lo, to.la, 6.5, 2200);
			} else if (tries++ < 120) {
				requestAnimationFrame(fly);
			}
		};
		requestAnimationFrame(fly);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/**
	 * Follow the address bar when it changes under us.
	 *
	 * Pasting a link into the bar of a page that is already open does not reload
	 * it — the browser only swaps the hash — so the state seeded at module load
	 * never sees the new one, and the sync effect below promptly writes the app's
	 * current view back over what was typed. Watching for the change makes a
	 * pasted link behave like a followed one, and makes the back button work.
	 *
	 * `replaceState` does not fire `hashchange`, so the app writing its own URL
	 * cannot feed back into this.
	 */
	useEffect(() => {
		const onHash = () => {
			const v = decodeView(window.location.hash);
			const c = cityByName(v.city);
			if (c) selectCity(c, true);
			if (v.mode) setMode(v.mode as PanelMode);
			if (v.chain != null) setChain(v.chain);
			setScrubStable(v.scrub ?? 0);
		};
		window.addEventListener('hashchange', onHash);
		return () => window.removeEventListener('hashchange', onHash);
	}, [selectCity, setScrubStable, cityByName]);

	/*
	 * Both of these work from `pinned` directly rather than from a `setPinned`
	 * updater, because they do more than compute the next value: they write to
	 * storage and raise a message. React runs updater functions during the render
	 * phase, and twice over in StrictMode — so as updaters these saved twice and
	 * announced twice, and raising a toast from there is a state change in another
	 * component mid-render, which React rejects outright.
	 */
	const commitPins = useCallback((next: Pin[], said: Note) => {
		setPinned(next);
		savePinned(next);
		say(said);
	}, []);

	const unpin = useCallback(
		(name: string) => {
			if (!pinned.some(p => pinName(p) === name)) return;
			// The one message with no detail line: a removal needs no explaining.
			commitPins(
				pinned.filter(p => pinName(p) !== name),
				{ kind: 'off', title: `Unpinned ${name}` }
			);
		},
		[pinned, commitPins]
	);

	const togglePin = useCallback(() => {
		if (!activeCity) return;
		const name = activeCity.n;
		if (pinned.some(p => pinName(p) === name)) {
			commitPins(
				pinned.filter(p => pinName(p) !== name),
				{ kind: 'off', title: `Unpinned ${name}` }
			);
			return;
		}
		// Full: say so rather than silently dropping the oldest, which would lose a
		// city the reader chose without ever telling them. A warn names the way out.
		if (pinned.length >= MAX_PINNED) {
			say({ kind: 'warn', title: `${MAX_PINNED} cities pinned`, detail: 'Unpin one to make room' });
			return;
		}
		// A shipped city stores its name; one found by locating stores itself,
		// because nothing else holds its record once the tab closes.
		const shipped = CITIES.some(c => c.n === name);
		commitPins([...pinned, shipped ? name : activeCity], {
			kind: 'ok',
			title: `${name} is pinned`,
			detail: `Kept between visits · ${pinned.length + 1} of ${MAX_PINNED}`
		});
	}, [activeCity?.n, pinned, commitPins]);

	const share = useCallback(() => {
		const at = Math.round(clock.scrub);
		const frag = encodeView({ city: activeCity?.n ?? null, scrub: at, mode, chain });
		const url = window.location.origin + window.location.pathname + frag;
		// Whichever of the city, the moment and the panel are actually set — a link
		// to the whole earth as it stands would otherwise carry three empty clauses.
		const detail = [activeCity?.n, at === 0 ? 'right now' : scrubLabelOf(at), MODE_NAMES[mode]]
			.filter(Boolean)
			.join(' · ');
		// Refused outright, which is what an insecure origin gives. The optional
		// call short-circuits the whole chain including `.catch`, so this case used
		// to press the button and say nothing at all.
		const blocked = () =>
			say({ kind: 'warn', title: 'Clipboard blocked by the browser', detail: `Add ${frag} to this page’s URL` });
		if (!navigator.clipboard) return blocked();
		navigator.clipboard
			.writeText(url)
			.then(() => say({ kind: 'link', title: 'Link copied', detail }))
			.catch(blocked);
	}, [activeCity?.n, clock, mode, chain]);

	// Clicking a dot selects it in place; searching flies there.
	const onCitySelect = useCallback(
		(name: string) => {
			const c = cityByName(name);
			if (c) selectCity(c, true, viewRef.current.zoom);
		},
		[selectCity, cityByName]
	);

	/** Centre the globe on a point without changing the selected city. */
	const goTo = useCallback((lat: number, lon: number) => {
		setSpin(false);
		globe.current?.flyTo(lon, lat, 2.6, 2200);
	}, []);

	/**
	 * A monument that stands on no city was clicked.
	 *
	 * There is nothing to select — Diyanet publishes no timetable for Djenné, and
	 * Aya Sofya's district already belongs to the Blue Mosque — so this goes and
	 * looks at the building instead of changing what the panel is reading. Close
	 * enough to see it, and never further out than you already were.
	 */
	const onSiteSelect = useCallback((name: string) => {
		const m = MOSQUES.find(x => x.name === name);
		if (!m) return;
		setSpin(false);
		globe.current?.flyTo(m.lon, m.lat, Math.max(viewRef.current.zoom, 9), 1800);
	}, []);

	/**
	 * Clicking a band of the cities-by-prayer bar takes you to that band of the
	 * earth and pulses the cities in it, so the number turns into a place.
	 */
	/**
	 * Go to where the reader actually is, and say so for five seconds.
	 *
	 * The mark is deliberately the raw coordinates rather than the nearest city:
	 * the point of the button is "here I am on this earth", and snapping it to a
	 * Diyanet district up to a few hundred kilometres away would answer a
	 * different question. Selecting the nearest city is one more click, from a dot
	 * that is now right under the mark.
	 */
	const locate = useCallback(() => {
		if (!navigator.geolocation) {
			say({
				kind: 'warn',
				title: 'This browser can’t share a location',
				detail: 'Pick a city on the globe instead'
			});
			return;
		}
		setLocating(true);
		navigator.geolocation.getCurrentPosition(
			pos => {
				setLocating(false);
				const { latitude: lat, longitude: lon, accuracy } = pos.coords;
				setSpin(false);
				// Closer than the old 4.5. At that zoom a town and the border ten
				// kilometres from it are a few pixels apart, so the mark could not show
				// which of them it was on — the same distance that made a coarse fix
				// look like a misplaced one.
				globe.current?.flyTo(lon, lat, 6.5, 2200);
				/*
				 * Where you are, said at once — and filled in below with whose
				 * timetable that turns out to be.
				 *
				 * One toast, amended, rather than two a second apart: the position is
				 * known immediately and the district takes a round trip, and two
				 * messages for one button press read as a stutter.
				 *
				 * The detail also carries how good the fix is when it is poor. A coarse
				 * one can land a town or two away, which looks like a bug when the mark
				 * sits on a border instead of on you — so the number is offered rather
				 * than left to be guessed at.
				 */
				const km = accuracy / 1000;
				const fix = km >= 1 ? `±${km < 10 ? km.toFixed(1) : Math.round(km)} km` : null;
				const here = `You are at ${coordLabel(lat, lon)}`;
				const id = say({ kind: 'ok', title: here, detail: fix ?? undefined });

				/*
				 * Then find out whose timetable this is.
				 *
				 * Most people do not live in one of the 891 cities the app ships, but
				 * Diyanet publishes far more than we ship — so the district is looked up
				 * live and held for the session only. It is never written to the
				 * dataset, so it takes no part in the chain or the records, which are
				 * drawn from the shipped table. What it does get is its own published
				 * prayer times, by exactly the path a shipped city uses, and a dot on
				 * the globe like any other — everything the reader can do to a city goes
				 * through that dot.
				 */
				locateDistrict(queryClient, lat, lon)
					.then(found => {
						if (!found) {
							amend(id, {
								kind: 'warn',
								title: here,
								detail: 'Diyanet publishes no timetable here — pick a city on the globe'
							});
							return;
						}
						setLocated(found.city);
						selectCity(found.city, false);
						// Which published timetable you are now reading. The design asks
						// for the nearest city with times and how far off it is; the app
						// resolves the actual district instead, whose coordinates are the
						// reader's own — so a distance would read 0 km for everyone, and
						// the district's name is the thing worth saying.
						amend(id, {
							kind: 'ok',
							title: here,
							detail: `Diyanet district: ${found.city.n}${found.city.p ? ` · ${found.city.p}` : ''}`
						});
					})
					.catch(() => {
						// The globe still flew and the mark is still there; only the
						// timetable is missing.
						amend(id, {
							kind: 'warn',
							title: here,
							detail: 'Could not reach Diyanet for a timetable — pick a city on the globe'
						});
					});
				setMark({ lat, lon });
				setMarkPulsing(true);
				if (markTimer.current) window.clearTimeout(markTimer.current);
				// Ten seconds of pulse, then the dot settles and stays. Five was gone
				// before the two-second flight had finished settling, which left about
				// as long to find the mark as it took to notice the globe had moved.
				markTimer.current = window.setTimeout(() => {
					setMarkPulsing(false);
					markTimer.current = null;
				}, 10000);
			},
			err => {
				setLocating(false);
				// Denied, unavailable, or timed out — all three are the reader's
				// business rather than an error to swallow. A refusal is told apart
				// from a failure so the way out can be about the permission itself;
				// everything else — timeout, no fix, no provider — reads the same to
				// the reader and gets one message.
				say(
					err.code === err.PERMISSION_DENIED
						? {
								kind: 'warn',
								title: 'Location permission denied',
								detail: 'Allow it in your browser, or pick a city on the globe'
						  }
						: {
								kind: 'warn',
								title: 'Couldn’t get your location',
								detail: 'Pick a city on the globe instead'
						  }
				);
			},
			/*
			 * Ask for the best fix the device can give, and never a stored one.
			 *
			 * The first version asked for a coarse fix and accepted one up to five
			 * minutes old, which is the cheap, battery-friendly choice — and it is
			 * why the mark landed on the Dutch-German border rather than on Emmen,
			 * ten kilometres away. For a button whose entire job is "put me on the
			 * map", a stale approximation is the wrong trade: it is pressed once,
			 * deliberately, and it should be worth the extra second.
			 */
			{ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
		);
	}, [queryClient, selectCity]);

	useEffect(() => () => window.clearTimeout(markTimer.current ?? undefined), []);

	const onPickPhase = useCallback(
		(phase: number) => {
			const { cities, centre } = citiesInPhase(getNowMs(), phase, phases);
			if (!cities.length || !centre) return;
			setSpin(false);
			globe.current?.flyTo(centre.lon, centre.lat, 1.5, 2200);
			setHighlightPhase(phase);
			if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
			highlightTimer.current = window.setTimeout(() => {
				setHighlightPhase(null);
				highlightTimer.current = null;
			}, 8000);
		},
		[getNowMs]
	);

	useEffect(() => () => window.clearTimeout(highlightTimer.current ?? undefined), []);

	// Release can happen anywhere, not just over the slider, so the end of a drag
	// is caught on the window rather than on the input.
	useEffect(() => {
		if (!scrubbing) return;
		const release = () => setScrubbing(false);
		window.addEventListener('pointerup', release);
		window.addEventListener('pointercancel', release);
		return () => {
			window.removeEventListener('pointerup', release);
			window.removeEventListener('pointercancel', release);
		};
	}, [scrubbing]);

	/**
	 * Run the clock forward by `days`, stopping there.
	 *
	 * The limit is measured from wherever the scrub already is, so pressing Play
	 * twice covers two spans rather than the second press doing nothing because
	 * the first had already passed the mark.
	 */
	const startPlay = useCallback(
		(days: number) => {
			const limit = Math.round(clock.scrub) + days * 1440;
			run.current = { base: PLAY_RATE, limit };
			// A run of Play is not a circuit of the chain, so the band stops calling
			// itself one — otherwise pressing Play mid-sweep left the panel claiming a
			// sweep that had just been replaced by a ten-day run.
			setSweepOn(false);
			clock.play(1, { rate: PLAY_RATE * speedMul, limit });
		},
		[clock, speedMul]
	);

	/**
	 * Change how fast whatever is running goes, without moving where it stops.
	 *
	 * Lifted out of the time bar's prop when the keyboard needed it as well: a
	 * chain circuit and a run of Play are the same clock, and both are re-paced
	 * from here.
	 */
	const setSpeed = useCallback(
		(seconds: number) => {
			speedRef.current = seconds;
			setSweepSeconds(seconds);
			const r = run.current;
			if (playing && r) clock.play(1, { rate: r.base * (BASE_SECONDS / seconds), limit: r.limit });
		},
		[clock, playing]
	);

	/** Play if stopped, stop if running — the strip's Play button, as a key. */
	const playToggle = useCallback(() => {
		if (!playing) {
			startPlay(playDays);
			return;
		}
		clock.stop();
		run.current = null;
	}, [clock, playing, playDays, startPlay]);

	/**
	 * One rung along the speed strip, stopping at either end.
	 *
	 * Read from a ref rather than from the rendered value: two presses inside one
	 * frame both see the same state, so holding the key stepped once and then sat
	 * there repeating a move it had already made.
	 */
	const stepSpeed = useCallback(
		(dir: -1 | 1) => {
			const i = SWEEP_SPEEDS.findIndex(s => s.seconds === speedRef.current);
			const next = SWEEP_SPEEDS[Math.min(SWEEP_SPEEDS.length - 1, Math.max(0, (i < 0 ? 1 : i) + dir))];
			if (!next) return;
			setSpeed(next.seconds);
			// The segment that ends up chosen, which at either end is the one already
			// lit — a ripple that goes nowhere still says the key was heard.
			pulse('speed' + next.seconds);
		},
		[setSpeed]
	);

	/**
	 * Nudge the scrubber.
	 *
	 * The clock does the composing either way: repeated presses step from where
	 * the last one was heading, so a held key covers a steady distance per press
	 * instead of chasing its own animation. A zero duration is an instant step
	 * that still composes. Seeking by hand stops a run, as dragging does.
	 */
	const stepScrub = useCallback(
		(minutes: number, glide: boolean) => clock.stepBy(minutes, glide ? undefined : 0),
		[clock]
	);

	const pickSpan = useCallback(
		(i: number) => {
			const o = PLAY_OPTIONS[i];
			if (!o) return;
			setPlayDays(o.days);
			startPlay(o.days);
		},
		[startPlay]
	);

	useTransportKeys({
		// A modal owns the keyboard while it is up: the qibla finder turns its
		// compass with the arrows, and the clock must not move underneath it.
		enabled: !viewer && !qiblaOpen && !shortcutsOpen,
		/*
		 * Each of these rings its own button on the way past. Only the keyboard
		 * path does — a click already shows itself, and pressing a button that is
		 * flashing because you pressed it is just noise.
		 */
		playToggle: useCallback(() => {
			pulse('play');
			playToggle();
		}, [playToggle]),
		step: stepScrub,
		now: useCallback(() => {
			pulse('now');
			clock.setScrub(0);
		}, [clock]),
		speed: stepSpeed,
		span: useCallback(
			(i: number) => {
				pulse('span' + (i + 1));
				pickSpan(i);
			},
			[pickSpan]
		),
		spin: useCallback(() => {
			pulse('spin');
			setSpin(v => !v);
		}, []),
		// A toggle, so the same chord that opens the sheet puts it away again.
		shortcuts: useCallback(() => {
			pulse('shortcuts');
			setShortcutsOpen(v => !v);
		}, [])
	});

	speedRef.current = sweepSeconds;

	const onView = useCallback((v: View) => setView(v), []);
	const onNote = useCallback((n: string) => setNote(n), []);

	/**
	 * The strip's own state, spelled out under it.
	 *
	 * Five controls, each with two or three states, is more than a row of
	 * highlights can say plainly — so it is said in words.
	 */
	const consoleStatus = [
		spin ? 'SPIN ON' : 'SPIN OFF',
		playing ? `RUNNING ${playDays}D` : `SPAN ${playDays}D`,
		`QIBLA ${qiblaMode === 'off' ? 'OFF' : qiblaMode === 'one' ? 'CITY' : 'ALL'}`,
		`PATH ${pathMode === 'off' ? 'OFF' : pathMode === 'sun' ? 'SUN' : 'SUN+MOON'}`
	].join(' · ');

	const mapNote = world.isPending ? 'loading Natural Earth outlines…' : world.isError ? 'outline fetch failed' : note;

	const rounded = Math.round(scrub);

	/*
	 * The evening the crescent map is drawn for.
	 *
	 * Read off the scrubbed *date* and nothing finer. This map is not an
	 * instant: every point on it is judged at that place's own best moment,
	 * some minutes after its own sunset. Following the clock would imply a
	 * precision the map does not have, so the hour is thrown away and only the
	 * day survives — which is also what makes the field cacheable, since
	 * scrubbing within a day asks the same question.
	 */
	const tonightMs = useMemo(() => eveningKey(nowMs), [Math.floor(nowMs / 86400000)]);
	const hilalEveningMs = tonightMs + hilalDays * 86400000;
	const hilal = useHilal(mode === 'hilal' ? hilalEveningMs : null, criterion);

	/** Jump to the evening after the next new moon — the first one worth seeing. */
	const nextCrescent = useCallback(() => {
		const conj = nextConjunction(toJD(hilalEveningMs));
		const evening = eveningKey(fromJD(conj) + 86400000);
		setHilalDays(Math.round((evening - tonightMs) / 86400000));
	}, [hilalEveningMs, tonightMs]);

	/**
	 * Keep the address bar showing what you are looking at.
	 *
	 * The share button was copying a link describing the current view while the
	 * URL itself said nothing — so the two disagreed, and you could not simply
	 * copy what was in the bar. Now the view is written back as it changes, which
	 * also means a reload returns you to where you were.
	 *
	 * `replaceState`, not `push`: these are not navigations, and pushing would
	 * turn every scrub into a back-button step. Skipped while the clock is
	 * running, because rewriting the URL several times a second during a sweep is
	 * churn for something nobody can read at that speed — it syncs when you stop.
	 */
	useEffect(() => {
		if (playing) return;
		const next = encodeView({ city: activeCity?.n ?? null, scrub: rounded, mode, chain });
		if (next !== window.location.hash) window.history.replaceState(null, '', next);
	}, [activeCity?.n, mode, chain, rounded, playing]);
	const scrubLabel = scrubLabelOf(rounded);

	return (
		<div className='app'>
			<SidePanel
				readout={readout}
				times={times}
				querying={querying}
				onGoTo={goTo}
				onPickPhase={onPickPhase}
				timeShifted={playing !== 0 || scrubbing}
				mode={mode}
				onMode={setMode}
				phases={phases}
				nowMs={nowMs}
				chain={chain}
				onChain={selectChain}
				sweeping={sweeping}
				onSweep={() => {
					if (playing) {
						clock.stop();
						setSweepOn(false);
						run.current = null;
						return;
					}
					const limit = Math.round(clock.scrub) + SWEEP_MINUTES;
					const base = SWEEP_MINUTES / BASE_SECONDS;
					run.current = { base, limit };
					setSweepOn(true);
					clock.play(1, { rate: base * speedMul, limit });
				}}
				onGoToCity={c => selectCity(c, true)}
				pinned={pinned}
				onTogglePin={togglePin}
				onUnpin={unpin}
				onLocate={locate}
				locating={locating}
				hilalEveningMs={hilalEveningMs}
				criterion={criterion}
				hilalCity={activeCity}
				hilalBusy={hilal.busy}
				hilalSummary={hilal.summary}
				onOpenQibla={() => setQiblaOpen(true)}
				conjunctionMs={hilal.field?.conjunctionMs ?? null}
				onStep={(d: number) => setHilalDays(v => v + d)}
				onNextCrescent={nextCrescent}
				onTonight={() => setHilalDays(0)}
				shifted={hilalDays !== 0}
				tonightMs={tonightMs}
			/>

			<main className='stage'>
				<Globe
					ref={globe}
					worldGeo={world.data}
					getNowMs={getNowMs}
					activeCity={activeCity}
					guestCity={located}
					spin={spin && !hover}
					pathMode={pathMode}
					showOrrery={showOrrery}
					highlightPhase={highlightPhase}
					phases={phases}
					qiblaMode={qiblaMode}
					bandPhase={mode === 'chain' ? chain : null}
					hilal={mode === 'hilal' ? hilal.field?.bands ?? null : null}
					mark={mark}
					markPulsing={markPulsing}
					sweeping={sweeping}
					onHover={setHover}
					onView={onView}
					onCitySelect={onCitySelect}
					onCityHover={setHoveredCity}
					onSiteHover={setHoveredSite}
					onSiteSelect={onSiteSelect}
					onOpenViewer={setViewer}
					onNote={onNote}
					onShare={share}
					onShortcuts={() => setShortcutsOpen(true)}
				/>

				{/*
					The console strip.

					One bar, divided by hairlines, rather than a row of separate pills:
					every control that acts on the *view* is in it, and the run length is
					a row of keys inside it instead of a menu you had to open to find out
					what it held. The line under the bar says what the whole thing is set
					to, so the state can be read without decoding five highlights.
				*/}
				<div className='controls'>
					<div className='console'>
						<button
							className={'con-btn' + (spin ? ' con-btn-on' : '')}
							aria-pressed={spin}
							data-hotkey='spin'
							data-tip='Auto-rotate the earth · S'
							onClick={() => setSpin(v => !v)}
						>
							<span className={'con-switch' + (spin ? ' con-switch-on' : '')}>
								<span className='con-switch-knob' />
							</span>
							Spin
						</button>

						<span className='con-div' />

						<button
							className={'con-btn' + (playing ? ' con-btn-on' : '')}
							aria-pressed={playing !== 0}
							data-hotkey='play'
							data-tip='Run the clock forward · Space'
							onClick={playToggle}
						>
							<span className={'con-play' + (playing ? ' con-play-on' : '')} />
							{playing ? 'Running' : 'Play'}
						</button>

						{/* How far a run goes, every choice on show. */}
						<span className='con-keys'>
							{PLAY_OPTIONS.map((o, i) => (
								<button
									key={o.days}
									className={'con-key' + (o.days === playDays ? ' con-key-on' : '')}
									data-hotkey={'span' + (i + 1)}
									aria-pressed={o.days === playDays}
									data-tip={
										(o.days === 1 ? 'Run one day forward' : `Run ${o.days} days forward`) +
										` · ${i + 1}`
									}
									onClick={() => pickSpan(i)}
								>
									{o.days}d
								</button>
							))}
						</span>

						<span className='con-div' />

						<button
							className={'con-btn' + (qiblaMode !== 'off' ? ' con-btn-qibla' : '')}
							aria-pressed={qiblaMode !== 'off'}
							data-tip={
								qiblaMode === 'off'
									? 'Great circles to the Kaaba'
									: qiblaMode === 'one'
									? 'Now show every city facing us'
									: 'Turn the qibla lines off'
							}
							onClick={() => setQiblaMode(v => (v === 'off' ? 'one' : v === 'one' ? 'many' : 'off'))}
						>
							<span className='con-qibla'>
								<span className='con-qibla-needle' />
							</span>
							{/* The design labels the three states Qibla / City / All. This bar also
							    carries a City button that flies to the selected city, and two
							    segments reading CITY that do unrelated things is worse than a
							    longer label — so the mode keeps its own name in front. */}
							{qiblaMode === 'off' ? 'Qibla' : qiblaMode === 'one' ? 'Qibla · city' : 'Qibla · all'}
						</button>

						<span className='con-div' />

						<button
							className={'con-btn' + (pathMode !== 'off' ? ' con-btn-path' : '')}
							aria-pressed={pathMode !== 'off'}
							data-tip={
								pathMode === 'off'
									? "The sun's track across the day"
									: pathMode === 'sun'
									? "Add the moon's track"
									: 'Turn the tracks off'
							}
							onClick={() => setPathMode(v => (v === 'off' ? 'sun' : v === 'sun' ? 'both' : 'off'))}
						>
							<svg className='con-arc' width='13' height='11' viewBox='0 0 13 11' aria-hidden='true'>
								<path
									d='M1 9 C 4 1, 9 1, 12 9'
									fill='none'
									stroke='currentColor'
									strokeWidth='1.5'
									strokeLinecap='round'
									strokeDasharray='2.5 2'
								/>
							</svg>
							{pathMode === 'off' ? 'Path' : pathMode === 'sun' ? 'Sun' : 'Sun+Moon'}
						</button>

						<span className='con-div' />

						{/* City, Makkah and Now are gone from here: the first two are reachable
						    by clicking the globe, and the time bar already carries its own Now. */}
						<button
							className={'con-btn' + (locating ? ' con-btn-on' : '')}
							data-tip='Fly to where you are'
							disabled={locating}
							onClick={locate}
						>
							<AppIcon name='locate' size='small' />
							{locating ? 'Locating' : 'My location'}
						</button>

						<span className='con-div' />

						<button
							className='con-btn con-btn-plain'
							data-tip='Pull back to the whole earth'
							onClick={() => {
								setSpin(false);
								globe.current?.flyTo(view.lng, 20, 1.4, 2200);
							}}
						>
							Whole earth
						</button>
					</div>

					<div className='con-status'>{consoleStatus}</div>

					<div className='pointer'>
						<div className='pointer-pos'>{readout.ptrPos}</div>
						<div className='pointer-note'>
							{/* The zoom lives with the zoom buttons now, not out here. */}
							{/* Said plainly rather than left to be discovered by clicking: a
						    monument is the one mark on this globe with no times behind
						    it, and the line has room to say so. */}
							{hoveredCity
								? `${hoveredCity} · click to select`
								: hoveredSite
								? `${hoveredSite} · no published timetable · click to look`
								: mapNote}
						</div>
					</div>
				</div>

				{/*
					One place for every passing message. react-toastify owns the stack, the
					timing and the dismissal; the card itself is ours, in `Toast.tsx` and
					`styles.css`, so these read as part of the instrument rather than as a
					library's default.

					One at a time, per the design's spec: a new message replaces the one on
					screen and resets the timer. That is done by dismissing in `say()`
					rather than with the library's `limit`, which queues instead — see the
					note there. The close button and the countdown hairline are the card's
					own, so the library's are both switched off.

					Both pauses are off for the same reason. The library stops its timer
					when the window loses focus and while the pointer is over the card, but
					the countdown drawn at the card's foot is a CSS animation that knows
					about neither — so a message could sit there long after its bar had run
					out, which is exactly what it looked like: a toast that never left. The
					bar is the promise, and this is what keeps it.
				*/}
				{/* Every `data-tip` in the app is drawn by this one node, in a portal. */}
				{/* On the map, not only in the panel — the map is what the reader is
				    watching for a change, and a second of blank earth with the news
				    two feet to the left reads as nothing happening. */}
				{mode === 'hilal' && hilal.busy && (
					<div className='hil-busy' role='status'>
						<span className='mv-spinner' aria-hidden='true' />
						{hilal.field ? 'Sharpening the crescent map…' : 'Working out the whole earth…'}
					</div>
				)}

				<TipLayer />

				{/* The globe keeps running behind it, so closing returns to exactly the
				    view you left rather than to a globe that has drifted on without you. */}
				{shortcutsOpen && (
					<Suspense fallback={null}>
						<Shortcuts onClose={() => setShortcutsOpen(false)} />
					</Suspense>
				)}

				{qiblaOpen && activeCity && (
					<Suspense fallback={<div className='modal-back' />}>
						<QiblaViewer
							lat={activeCity.la}
							lon={activeCity.lo}
							place={activeCity.n}
							onClose={() => setQiblaOpen(false)}
						/>
					</Suspense>
				)}

				{viewer && (
					/* The fallback is the modal's own shape — backdrop, panel, and a
					   rail column of the same width — so the chunk arriving fills the
					   frame in rather than replacing one thing on screen with a
					   different one. A full-screen holding message flashed. */
					<Suspense
						fallback={
							<div className='mv-back'>
								<div className='mv'>
									<div className='mv-rail mv-rail-ghost' />
									<div className='mv-stage'>
										<div className='mv-building' role='status'>
											<span className='mv-spinner' aria-hidden='true' />
											<span>Opening the viewer</span>
										</div>
									</div>
								</div>
							</div>
						}
					>
						<MosqueViewer model={viewer} onClose={() => setViewer(null)} />
					</Suspense>
				)}

				<ToastContainer
					position='bottom-right'
					autoClose={TOAST_MS}
					hideProgressBar
					closeButton={false}
					newestOnTop
					pauseOnFocusLoss={false}
					pauseOnHover={false}
					theme='dark'
					className='pg-toasts'
				/>

				<Legend />

				<TimeBar
					readout={readout}
					scrub={rounded}
					setScrub={m => clock.setScrub(m)}
					onScrubbingChange={setScrubbing}
					scrubLabel={scrubLabel}
					sweepSeconds={sweepSeconds}
					onSweepSpeed={setSpeed}
					getNowMs={getNowMs}
				/>
			</main>
		</div>
	);
}
