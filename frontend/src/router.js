import { useEffect, useState } from 'react'

// Three flat pages, no params, no nested routes — so this is a switch statement,
// not a routing library. React Router would be ~11 kB gzipped of machinery for
// that, and its history-API mode needs a server rewrite rule this project does
// not have (a static host 404s on /docs; it never 404s on #/docs).
//
// Hash rather than plain useState because the browser Back button and a
// shareable link are worth twenty lines. The app otherwise carries NO url state
// at all, which PROJECT_DOCUMENTATION.md §23.8 lists as a limitation.

export const ROUTES = ['explorer', 'docs', 'roadmap']

function read() {
  const h = window.location.hash.replace(/^#\/?/, '').split(/[?#]/)[0]
  return ROUTES.includes(h) ? h : 'explorer'
}

export function useHashRoute() {
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const on = () => setRoute(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

// Explorer is the bare hash, so the default view has a clean url.
export const hrefFor = (r) => (r === 'explorer' ? '#/' : `#/${r}`)
