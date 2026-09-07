import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
	plugins: [react()],
	/*
	 * Reachable from a phone on the same network, and through a tunnel.
	 *
	 * Vite refuses requests whose Host header it does not recognise, so an ngrok
	 * or Cloudflare URL pointed at the dev server answers with a blocked-host
	 * page rather than the app. Listed here so testing the globe on a real
	 * handset does not mean editing this file first.
	 */
	server: {
		host: true,
		allowedHosts: ['.ngrok-free.app', '.ngrok.io', '.trycloudflare.com', '.loca.lt']
	},
	optimizeDeps: {
		/*
		 * MapLibre loads its worker as a file sitting next to its own entry point.
		 * When Vite pre-bundles the package that entry moves into
		 * `node_modules/.vite/deps`, and the worker has to be copied there with it —
		 * which a re-optimisation mid-session silently failed to do, leaving a 404
		 * for `maplibre-gl-worker.mjs`.
		 *
		 * Nothing reported it. MapLibre parses all GeoJSON on that worker, so every
		 * source sat at `loaded() === false` forever and the map drew no layer at
		 * all: no land, no borders, no city dots, no night. Only the three.js layer,
		 * which needs no worker, kept drawing — a black globe with mosques and
		 * planets floating on it, and not one error in the console.
		 *
		 * Left unbundled, the worker resolves next to the real package file, where
		 * it actually is.
		 */
		exclude: ['maplibre-gl']
	}
});
