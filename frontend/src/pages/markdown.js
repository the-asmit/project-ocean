import { marked } from 'marked'

// Markdown → HTML for the Docs and Roadmap pages.
//
// marked, not react-markdown: the source is our own repo file, not user input,
// and all this page needs is GFM tables (which PROJECT_DOCUMENTATION.md is
// mostly made of), fenced code and headings. One ~35 kB dependency instead of
// the four-package remark/rehype stack.
//
// MERMAID IS DELIBERATELY NOT RENDERED. The doc carries three diagrams and the
// mermaid runtime is ~1 MB — poor value on a reference page nobody profiles.
// marked turns a ```mermaid fence into a plain <pre><code>, which is exactly the
// wanted behaviour and needs no configuration.

// GitHub's heading-slug rules, so the anchors the document already links to
// internally ([§7.8](#78-isosurface-extraction--marching-tetrahedra)) resolve
// on this page without rewriting the document.
export function slug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')      // drop punctuation, keep word chars/space/hyphen
    .replace(/\s/g, '-')
}

// Headings for the table of contents, in document order.
//
// Fence-aware: PROJECT_DOCUMENTATION.md contains shell blocks whose comment
// lines start with `#`, and a naive scan would list "# create the environment"
// as a chapter.
export function scanHeadings(raw, maxLevel = 2) {
  const out = []
  let fenced = false
  for (const line of raw.split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue }
    if (fenced) continue
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(line)
    if (!m || m[1].length > maxLevel) continue
    const text = m[2].replace(/\s*#+\s*$/, '')
    out.push({ level: m[1].length, text, slug: slug(text) })
  }
  return out
}

// Render, then inject ids on the heading levels the TOC links to.
//
// marked dropped automatic heading ids in v5 (they moved to a plugin). Rather
// than take another dependency, the ids are stitched on afterwards: the scan
// above and marked's output walk the same headings in the same order, so index
// alignment holds.
export function renderMarkdown(raw, maxLevel = 2) {
  const heads = scanHeadings(raw, maxLevel)
  const html = marked.parse(raw)
  let i = 0
  const levels = `[1-${maxLevel}]`
  return html.replace(new RegExp(`<h(${levels})>`, 'g'), (whole, lvl) => {
    const h = heads[i]
    if (!h) return whole
    i++
    if (import.meta.env.DEV && h.level !== Number(lvl)) {
      console.warn('[docs] heading scan drifted from the rendered order', lvl, h)
    }
    return `<h${lvl} id="${h.slug}">`
  })
}

// One section of a document, from a heading to the next heading of the same or
// a higher level. Used so the Roadmap page quotes the operational spec's own
// §8 text rather than a paraphrase that can drift out of date.
export function section(raw, heading) {
  const lines = raw.split('\n')
  const start = lines.findIndex((l) => l.startsWith(heading))
  if (start === -1) return ''
  const level = (/^#+/.exec(lines[start]) || ['#'])[0].length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i])
    if (m && m[1].length <= level) { end = i; break }
  }
  return lines.slice(start + 1, end).join('\n').trim()
}
