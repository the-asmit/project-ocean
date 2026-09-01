import { ROUTES, hrefFor } from '../router.js'

// Page tabs, in the app bar. Real anchors rather than buttons, so middle-click
// and copy-link behave the way a person expects a nav to behave.
const LABEL = { explorer: 'Explorer', docs: 'Docs', roadmap: 'Roadmap' }

export default function TopNav({ route }) {
  return (
    <nav className="topnav" aria-label="Pages">
      {ROUTES.map((id) => (
        <a
          key={id}
          href={hrefFor(id)}
          className={route === id ? 'on' : undefined}
          aria-current={route === id ? 'page' : undefined}
        >
          {LABEL[id]}
        </a>
      ))}
    </nav>
  )
}
