import { Component, StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
// Only reachable at #/solar, and it pulls in three.js. Loading it eagerly put
// the whole model viewer in the globe's critical path for a route almost nobody
// opens.
const SolarSystem = lazy(() => import('./components/SolarSystem'))
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Prayer timetables and reference lists don't change under us, and the
      // upstream API is rate-limited — so don't refetch on every window focus.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

/**
 * Two pages, switched on the hash.
 *
 * A router library would be four dependencies and a provider for what is one
 * boolean: the globe, or the solar-system model viewer at `#/solar`.
 */
/**
 * A lazy route that fails to load throws to the root, which unmounts the whole
 * tree and leaves a blank page — and React caches the rejection, so navigating
 * back does not retry. The likeliest cause is mundane: a tab left open across a
 * deploy, asking for a hashed chunk that no longer exists.
 */
class RouteBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="pg-route-error">
        <p>Could not load this view.</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}

function Routes() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  if (!hash.startsWith('#/solar')) return <App />
  return (
    <RouteBoundary>
      <Suspense fallback={<div className="pg-route-loading">Loading…</div>}>
        <SolarSystem />
      </Suspense>
    </RouteBoundary>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Routes />
    </QueryClientProvider>
  </StrictMode>,
)
