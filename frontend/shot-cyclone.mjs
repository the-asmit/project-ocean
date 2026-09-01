// The Cyclone Scenario preset — one click to a tile and a date where the
// 40 kJ/cm2 threshold has a line to draw.
//
// REF is backend/verify_tchp.py's "RG8 path" block for bengal 2019-05-01: the
// same algorithm in Python over the same 8-bit values the browser reads.
import { chromium } from 'playwright'

const REF = {
  water: 4049, warm: 4049, over: 3688, censored: 236,
  d26Min: 6.4406, d26Max: 122.4817,
  tchpMin: 6.3330, tchpMax: 172.8661,
}

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 950 } })
const errs = []
const loads = []
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()) })
p.on('request', (r) => { if (r.url().includes('/api/dataset?')) loads.push(r.url().split('/api/')[1]) })
const near = (a, r) => Math.abs(a - r) < 5e-3
const mark = (ok) => (ok ? 'OK  ' : 'FAIL')

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForFunction(() => window.__store?.getState().dataset, undefined, { timeout: 90000 })
await p.waitForTimeout(2000)

console.log('1. THE OFFER, BEFORE ANY LAYER IS ON')
await p.click('.rail-btn[aria-label="Operational"]')
await p.waitForTimeout(700)
const card = await p.$eval('.rail-panel .preset', (n) => ({
  go: n.querySelector('.preset-go')?.textContent,
  label: n.querySelector('.preset-label')?.textContent,
  sub: n.querySelector('.preset-sub')?.textContent,
  why: n.querySelector('.preset-why')?.textContent,
})).catch(() => null)
if (!card) { console.log('   MISSING'); } else {
  console.log('   ', card.go, '·', card.label)
  console.log('   ', card.sub)
  console.log('   ', card.why)
}
console.log('   heat layer on yet :', await p.evaluate(() => window.__store.getState().showHeat))
await p.screenshot({ path: 'screenshots/cyc-1-offer.png' })

console.log('')
console.log('2. ONE CLICK')
const n0 = loads.length
const before = await p.evaluate(() => {
  const s = window.__store.getState()
  return { region: s.region, date: s.date, variable: s.variable, vertExag: s.vertExag }
})
await p.click('.rail-panel .preset')
await p.waitForFunction(() => window.__store.getState().dataset?.meta.date === '2019-05-01',
  undefined, { timeout: 240000 })
await p.waitForTimeout(2500)
const after = await p.evaluate(() => {
  const s = window.__store.getState()
  return { region: s.region, date: s.date, variable: s.variable, vertExag: s.vertExag,
    showHeat: s.showHeat, d26: s.heatD26, field: s.heatField, clipIndex: s.clipIndex }
})
console.log('   before       :', JSON.stringify(before))
console.log('   after        :', JSON.stringify(after))
console.log('   tile loads   :', loads.length - n0, 'request(s):', loads.slice(n0).join(' | '))

console.log('')
console.log('3. THE FIELD IT LANDS ON — js vs python, same RG8 bytes')
const js = await p.evaluate(() => ({ ...window.__oceanHeat.stats, ms: window.__oceanHeat.ms }))
let bad = 0
for (const [k, label] of [['water', 'water columns'], ['warm', 'warm columns '],
  ['over', 'over 40      '], ['censored', 'censored     '],
  ['d26Min', 'd26 min      '], ['d26Max', 'd26 max      '],
  ['tchpMin', 'tchp min     '], ['tchpMax', 'tchp max     ']]) {
  const a = js[k], r = REF[k]
  const ok = Number.isInteger(r) ? a === r : near(a, r)
  if (!ok) bad++
  console.log(`   ${mark(ok)} ${label}  js ${a.toFixed(4).padStart(10)}   py ${r.toFixed(4).padStart(10)}`)
}
console.log(`   ${bad ? bad + ' MISMATCHES' : 'all eight agree'} · ${(js.overFraction * 100).toFixed(1)}% over threshold`
  + ` · ${(100 - js.overFraction * 100).toFixed(1)}% under it, which is what the contour follows`)

console.log('')
console.log('4. THE CONTOUR ACTUALLY DRAWS')
const mesh = await p.evaluate(() => {
  const m = window.__oceanHeatMesh?.built
  return m ? {
    surface: m.surface?.userData.triangles ?? 0, field: m.field?.userData.triangles ?? 0,
    draped: m.surfaceLine?.userData.segments ?? 0, flat: m.fieldLine?.userData.segments ?? 0,
  } : null
})
console.log('   sheets       :', mesh.surface.toLocaleString(), '+', mesh.field.toLocaleString(), 'triangles')
console.log('   40 kJ/cm2    :', mesh.draped, 'segments draped on D26 +', mesh.flat, 'flat')
await p.click('.rail-btn[aria-label="Operational"]')
await p.waitForTimeout(500)
await p.screenshot({ path: 'screenshots/cyc-2-landed.png' })

console.log('')
console.log('5. THE PANEL NOW SAYS YOU ARE HERE, NOT GO THERE')
await p.click('.rail-btn[aria-label="Operational"]')
await p.waitForTimeout(600)
console.log('   preset button:', (await p.$$('.rail-panel .preset')).length, '(expect 0)')
console.log('   note         :', await p.$eval('.rail-panel .hint', (n) => n.textContent.trim()))
await p.screenshot({ path: 'screenshots/cyc-3-panel.png' })
await p.click('.rail-btn[aria-label="Operational"]')
await p.waitForTimeout(400)

console.log('')
console.log('6. SLICE INTO IT — the warp at 14x')
await p.click('.rail-btn[aria-label="Section"]'); await p.waitForTimeout(400)
await p.evaluate(() => {
  const i = document.querySelector('#sl-slice-from-top')
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(i, '23'); i.dispatchEvent(new Event('input', { bubbles: true }))
})
await p.waitForTimeout(1100)
await p.click('.rail-btn[aria-label="Section"]'); await p.waitForTimeout(500)
console.log('   section      :', await p.$eval('.section-badge .d', (n) => n.textContent))
await p.screenshot({ path: 'screenshots/cyc-4-sliced.png' })

console.log('')
console.log('7. THE GLIDER EMPTY STATE DOES NOT OFFER A CYCLONE')
await p.evaluate(() => window.__store.setState({ showGliders: true, clipIndex: 0, depthClip: 0 }))
await p.click('.rail-btn[aria-label="Field"]').catch(() => {})
await p.waitForTimeout(2500)
const offered = await p.$$eval('.rail-panel .preset .preset-label', (n) => n.map((x) => x.textContent))
console.log('   offered there:', offered.length ? offered.join(' | ') : '(none yet — no empty state)')
console.log('   scenario in that list:', offered.some((x) => x.includes('Cyclone')) ? 'YES (BUG)' : 'no')

console.log('')
console.log('8. FOOTER')
const foot = await p.evaluate(() => {
  const f = document.querySelector('.appfoot')
  const tops = new Set()
  for (const el of f.children) {
    if (el.offsetWidth === 0 && el.offsetHeight === 0) continue
    tops.add(Math.round(el.getBoundingClientRect().top))
  }
  return { h: f.getBoundingClientRect().height, rows: tops.size }
})
console.log(`   ${foot.h.toFixed(1)}px · ${foot.rows} rows`)

console.log('')
console.log('errors:', errs.length ? errs : 'none')
await b.close()
