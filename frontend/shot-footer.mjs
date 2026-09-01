// Footer line-count under every layer combination, at four widths.
import { chromium } from 'playwright'

const WIDTHS = [1280, 1366, 1440, 1600, 1920]
const b = await chromium.launch()

// One line is min-height 26 - padding 8 = 18px of text box; two lines ~ 37.
const lines = (h) => Math.max(1, Math.round((h - 8) / 15.2))

for (const w of WIDTHS) {
  const p = await b.newPage({ viewport: { width: w, height: 950 } })
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await p.waitForFunction(() => window.__store?.getState().dataset, undefined, { timeout: 60000 })
  await p.waitForTimeout(1800)

  const h = () => p.evaluate(() => document.querySelector('.appfoot').getBoundingClientRect().height)
  const rows = () => p.evaluate(() => {
    // count distinct top offsets among the footer's children = wrapped rows
    const tops = new Set()
    for (const el of document.querySelector('.appfoot').children) {
      if (el.offsetWidth === 0 && el.offsetHeight === 0) continue
      tops.add(Math.round(el.getBoundingClientRect().top))
    }
    return tops.size
  })

  const out = []
  out.push(['default', await h(), await rows()])

  await p.evaluate(() => window.__store.setState({ showIso: true }))
  await p.waitForTimeout(900)
  out.push(['+ isosurface', await h(), await rows()])

  await p.locator('.rail-btn[aria-label="Field"]').click()
  await p.waitForTimeout(400)
  await p.locator('.rail-panel .layer', { hasText: 'Current flow lines' }).click()
  await p.waitForFunction(() => window.__currentsReady || document.querySelector('.flow-chip'),
    undefined, { timeout: 120000 }).catch(() => {})
  await p.waitForTimeout(1500)
  out.push(['+ currents', await h(), await rows()])

  // the heaviest real case: the glider preset tile, every layer on
  await p.evaluate(() => window.__store.getState().applyPreset({
    id: 'g', region: 'bbox:85.0,90.0,5.0,10.0', date: '2016-07-08', layer: 'gliders',
  }))
  await p.waitForFunction(() => window.__store.getState().dataset?.meta.region.startsWith('bbox:85'),
    undefined, { timeout: 180000 }).catch(() => {})
  await p.waitForTimeout(3000)
  await p.evaluate(() => window.__store.setState({ showGliders: true, selectedGliderId: 'Bellatrix_368', showIso: true }))
  await p.waitForFunction(() => window.__oceanGlider?.built, undefined, { timeout: 180000 }).catch(() => {})
  await p.waitForTimeout(2000)
  out.push(['+ glider track', await h(), await rows()])

  await p.evaluate(() => window.__store.setState({ palette: 'viridis', customRange: [24, 30], logScale: true }))
  await p.waitForTimeout(800)
  out.push(['+ scale clauses', await h(), await rows()])

  console.log(`\n${w}px`)
  for (const [label, height, r] of out) {
    console.log(`   ${label.padEnd(17)} ${String(height.toFixed(1)).padStart(6)}px   ${r} row${r === 1 ? '' : 's'}`)
  }
  if (w === 1600) {
    const t = await p.evaluate(() => document.querySelector('.appfoot').innerText.replace(/[\s]+/g, ' ').trim())
    console.log('   worst-case text:', t.length, 'chars')
    for (const c of t.split(' · ')) console.log('      ' + String(c.length).padStart(4) + '  ' + c)
  }
  if (w === 1600 || w === 1280) {
    await p.screenshot({ path: `screenshots/footer-${w}-worst.png` })
  }
  await p.close()
}
await b.close()
