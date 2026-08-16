import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import SolarSystem from './components/SolarSystem'
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
function Routes() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash.startsWith('#/solar') ? <SolarSystem /> : <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Routes />
    </QueryClientProvider>
  </StrictMode>,
)
