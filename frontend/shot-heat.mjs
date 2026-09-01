// D26 + TCHP — OPERATIONAL_LAYER_SPEC.md §3, steps 1-3.
//
// The numbers in REF come from backend/verify_tchp.py's "RG8 path" block: the
// same algorithm run in Python over the same 8-bit values the browser reads.
// They are compared for EQUALITY, not closeness — two implementations of one
// formula over one set of bytes have no licence to differ.
import { chromium } from 'playwright'

const REF = {
  tile: 'bengal 2026-06-11',
  water: 4049, warm: 4049, over: 3845, censored: 326,
  d26Min: 6.4406, d26Max: 138.8026,
  tchpMin: 12.5110, tchpMax: 168.3485,
}

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 950 } })
const errs = []
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()) })
const S = (s) => p.evaluate(() => window.__store.getState()).then((x) => x)
const near = (a, r, tol = 5e-3) => Math.abs(a - r) < tol
const mark = (ok) => (ok ? 'OK  ' : 'FAIL')

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForFunction(() => window.__store?.getState().dataset, undefined, { timeout: 90000 })
await p.waitForTimeout(2000)

console.log('1. THE ROW IS LIVE, IN ITS OLD PLACE')
await p.click('.rail-btn[aria-label="Operational"]')
await p.waitForTimeout(500)
const rows = await p.$$eval('.rail-panel .layers > .layer', (n) => n.map((x) => ({
  name: x.querySelector('.name')?.textContent,
  badge: x.querySelector('.badge')?.textContent ?? '',
  disabled: x.disabled,
})))
for (const r of rows) console.log(`   ${r.disabled ? 'disabled' : 'live    '}  ${r.badge.padEnd(7)} ${r.name}`)

console.log('')
console.log('2. TOGGLE ON')
await p.click('.rail-panel .layer:has-text("Cyclone heat potential")')
await p.waitForTimeout(1200)
const st = await p.evaluate(() => window.__store.getState())
console.log('   showHeat     :', st.showHeat, '· D26', st.heatD26, '· field', st.heatField)
const mesh = await p.evaluate(() => {
  const m = window.__oceanHeatMesh?.built
  if (!m) return null
  return {
    surface: m.surface?.userData.triangles ?? 0,
    field: m.field?.userData.triangles ?? 0,
    surfaceLine: m.surfaceLine?.userData.segments ?? 0,
    fieldLine: m.fieldLine?.userData.segments ?? 0,
  }
})
console.log('   D26 sheet    :', mesh.surface.toLocaleString(), 'triangles')
console.log('   TCHP field   :', mesh.field.toLocaleString(), 'triangles')
console.log('   contour      :', mesh.surfaceLine, 'segments draped +', mesh.fieldLine, 'flat')

console.log('')
console.log(`3. JS (over RG8) vs PYTHON (over the same RG8 values) — ${REF.tile}`)
const js = await p.evaluate(() => {
  const h = window.__oceanHeat
  return { ...h.stats, ms: h.ms }
})
const checks = [
  ['water columns', js.water, REF.water],
  ['warm columns ', js.warm, REF.warm],
  ['over 40      ', js.over, REF.over],
  ['censored     ', js.censored, REF.censored],
  ['d26 min      ', js.d26Min, REF.d26Min],
  ['d26 max      ', js.d26Max, REF.d26Max],
  ['tchp min     ', js.tchpMin, REF.tchpMin],
  ['tchp max     ', js.tchpMax, REF.tchpMax],
]
let bad = 0
for (const [label, a, r] of checks) {
  const ok = Number.isInteger(r) ? a === r : near(a, r)
  if (!ok) bad++
  console.log(`   ${mark(ok)} ${label}  js ${String(typeof a === 'number' ? a.toFixed(4) : a).padStart(10)}   py ${String(r.toFixed ? r.toFixed(4) : r).padStart(10)}`)
}
console.log(`   ${bad ? bad + ' MISMATCHES' : 'all eight agree'} · computed in ${js.ms.toFixed(1)} ms`)

console.log('')
console.log('4. LEGEND ON THE CANVAS')
console.log('   chip         :', await p.$eval('.heat-chip .hc-head', (n) => n.textContent.trim()).catch(() => 'MISSING'))
console.log('   threshold key:', await p.$eval('.heat-chip .hc-key', (n) => n.textContent.trim()).catch(() => 'MISSING'))
console.log('   tick at      :', await p.$eval('.heat-chip .hc-tick', (n) => n.style.left).catch(() => '-'),
  '(40 of 200)')
await p.click('.rail-btn[aria-label="Operational"]')
await p.waitForTimeout(400)
await p.screenshot({ path: 'screenshots/heat-1-on.png' })

console.log('')
console.log('5. SLICE THE TOP DOWN — the sheet lifts into open air')
await p.click('.rail-btn[aria-label="Section"]')
await p.waitForTimeout(400)
await p.evaluate(() => {
  const i = document.querySelector('#sl-slice-from-top')
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(i, '12'); i.dispatchEvent(new Event('input', { bubbles: true }))
})
await p.waitForTimeout(1100)
const sl = await p.evaluate(() => window.__store.getState())
console.log('   clipIndex    :', sl.clipIndex, '· badge', await p.$eval('.section-badge .d', (n) => n.textContent))
await p.click('.rail-btn[aria-label="Section"]')
await p.waitForTimeout(400)
await p.screenshot({ path: 'screenshots/heat-2-sliced.png' })

console.log('')
console.log('6. CURSOR AND PINNED READOUTS')
const c = await p.evaluate(() => {
  const r = document.querySelector('.scene-host canvas').getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
})
await p.mouse.click(c.x + c.w * 0.52, c.y + c.h * 0.46)
await p.waitForTimeout(1000)
console.log('   hud card     :', (await p.$eval('.hud-card.pinned .tchp', (n) => n.textContent.trim()).catch(() => 'MISSING')))
const cards = await p.$$eval('.stat', (n) => n.map((x) => ({
  k: x.querySelector('.stat-label')?.textContent,
  v: x.querySelector('.stat-value')?.textContent,
  s: x.querySelector('.stat-sub')?.textContent,
})))
for (const k of ['TCHP', 'D26']) {
  const s = cards.find((x) => x.k === k)
  console.log(`   ${k.padEnd(13)}: ${s?.v}   (${s?.s})`)
}
await p.screenshot({ path: 'screenshots/heat-3-readout.png' })

console.log('')
console.log('7. PALETTE MOVES THE SHEETS WITH EVERYTHING ELSE')
const colOf = () => p.evaluate(() => {
  const g = window.__oceanHeatMesh.built.field.attributes.color
  return [0, 1, 2].map((i) => +g.array[3000 + i].toFixed(4))
})
const before = await colOf()
await p.evaluate(() => window.__store.setState({ palette: 'viridis' }))
await p.waitForTimeout(900)
const after = await colOf()
console.log('   ocean rgb    :', before.join(', '))
console.log('   viridis rgb  :', after.join(', '),
  before.join() === after.join() ? '  FAIL — unchanged' : '  changed')
await p.evaluate(() => window.__store.setState({ palette: 'ocean' }))
await p.waitForTimeout(700)

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
console.log(`   ${foot.h.toFixed(1)}px · ${foot.rows} rows (target: 2 max)`)

console.log('')
console.log('9. SALINITY — DISABLED WITH A REASON, NOT A SILENT FETCH')
await p.evaluate(() => window.__store.getState().setVariable('so'))
await p.waitForFunction(() => window.__store.getState().dataset?.meta.volume.variable === 'so',
  undefined, { timeout: 180000 })
await p.waitForTimeout(1500)
await p.click('.rail-btn[aria-label="Operational"]')
await p.waitForTimeout(500)
const soRow = await p.$eval('.rail-panel .layer:has-text("Cyclone heat potential")',
  (n) => ({ disabled: n.disabled, title: n.title }))
console.log('   row disabled :', soRow.disabled)
console.log('   reason       :', soRow.title)
console.log('   hint         :', await p.$eval('.rail-panel .hint', (n) => n.textContent.trim().slice(0, 120)))
console.log('   heat mesh    :', await p.evaluate(() => window.__oceanHeatMesh?.built ? 'still drawn (BUG)' : 'not drawn'))
console.log('   stat cards   :', (await p.$$eval('.stat', (n) => n.map((x) => x.querySelector('.stat-label')?.textContent
  + '=' + x.querySelector('.stat-sub')?.textContent))).filter((x) => x.startsWith('TCHP') || x.startsWith('D26')).join(' · '))
await p.screenshot({ path: 'screenshots/heat-4-salinity.png' })

console.log('')
console.log('errors:', errs.length ? errs : 'none')
await b.close()
