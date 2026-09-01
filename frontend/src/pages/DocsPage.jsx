import { useEffect, useMemo, useRef, useState } from 'react'
import raw from '../../../PROJECT_DOCUMENTATION.md?raw'
import { renderMarkdown, scanHeadings } from './markdown.js'

// The full technical reference, rendered from the repo's own
// PROJECT_DOCUMENTATION.md via Vite's ?raw import — ONE source of truth. The
// page cannot drift from the document, because it IS the document.
//
// Lazy-loaded from App.jsx, so the 250 kB of Markdown never enters the
// Explorer bundle.

export default function DocsPage() {
  const html = useMemo(() => renderMarkdown(raw), [])
  const heads = useMemo(() => scanHeadings(raw), [])
  const bodyRef = useRef(null)
  const [active, setActive] = useState(heads[0]?.slug ?? '')

  // Chapters, with their subsections nested. A flat list of all 212 headings is
  // a wall you scroll past rather than a map you navigate by, so the subsections
  // of the chapter you are actually in are the only ones on screen.
  const tree = useMemo(() => {
    const out = []
    for (const h of heads) {
      if (h.level === 1 || !out.length) out.push({ ...h, kids: [] })
      else out[out.length - 1].kids.push(h)
    }
    return out
  }, [heads])

  const openTop = useMemo(() => (
    tree.find((t) => t.slug === active || t.kids.some((k) => k.slug === active))?.slug ?? ''
  ), [tree, active])

  // Highlight the section currently under the top of the viewport. Threshold
  // rather than IntersectionObserver: chapters here are far taller than the
  // viewport, so "which heading did we last pass" is the honest question.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return undefined
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const marks = el.querySelectorAll('h1[id], h2[id]')
        let current = marks[0]?.id ?? ''
        for (const m of marks) {
          if (m.getBoundingClientRect().top - el.getBoundingClientRect().top > 90) break
          current = m.id
        }
        setActive(current)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [])

  const go = (e, id) => {
    e.preventDefault()
    const el = bodyRef.current?.querySelector(`#${CSS.escape(id)}`)
    if (el) el.scrollIntoView({ block: 'start' })
  }

  return (
    <div className="page-body docs">
      <aside className="docs-toc" aria-label="Contents">
        <div className="docs-toc-head">
          <span className="lbl">Contents</span>
          <span className="docs-meta">{tree.length} chapters</span>
        </div>
        <nav>
          {tree.map((t) => (
            <div key={t.slug} className={`toc-grp${openTop === t.slug ? ' open' : ''}`}>
              <a
                href={`#${t.slug}`}
                onClick={(e) => go(e, t.slug)}
                className={`lvl1${active === t.slug ? ' on' : ''}`}
              >
                {t.text}
              </a>
              {openTop === t.slug && t.kids.map((k) => (
                <a
                  key={k.slug}
                  href={`#${k.slug}`}
                  onClick={(e) => go(e, k.slug)}
                  className={`lvl2${active === k.slug ? ' on' : ''}`}
                >
                  {k.text}
                </a>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* The source is a repo file we authored, not user input, so it is
          rendered as-is. If this ever renders anything fetched, sanitize. */}
      <article
        className="docs-body"
        ref={bodyRef}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
