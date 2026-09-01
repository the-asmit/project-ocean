// Confirmation of the two pre-step-3 fixes: scene proportion, permanent map.
import { chromium } from 'playwright'

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 950 } })
const errs = []
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()) })

const box = async (sel) => p.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
}, sel)

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForFunction(() => window.__store?.getState().dataset, undefined, { timeout: 60000 })
await p.waitForTimeout(2200)

console.log('FIX 1 — SCENE PROPORTION')
const scene = await box('.scene-panel')
const charts = await box('.charts')
console.log('   scene  :', JSON.stringify(scene))
console.log('   charts :', JSON.stringify(charts))
console.log('   ratio  :', (scene.h / charts.h).toFixed(3), '(was 1.700, original dashboard 1.420)')
console.log('   canvas :', JSON.stringify(await box('.scene-host canvas')))

console.log('')
console.log('FIX 2 — MAP IS PERMANENT, NOT BEHIND A TOGGLE')
console.log('   rail icons     :', (await p.$$eval('.rail-btn .rail-label', (n) => n.map((x) => x.textContent))).join(' '))
console.log('   REGION gone    :', (await p.$$('.rail-btn[aria-label="Region"]')).length === 0)
console.log('   map mounted    :', (await p.$$('.mm-thumb')).length, 'instance(s), railPanel =', await p.evaluate(() => window.__store.getState().railPanel))
console.log('   map box        :', JSON.stringify(await box('.mm-thumb')))
console.log('   map canvas     :', JSON.stringify(await box('.mm-thumb .mm-canvas')))
console.log('   inside scene?  :', await p.evaluate(() => document.querySelector('.scene-host').contains(document.querySelector('.mm-thumb'))))
console.log('   legend below   :', JSON.stringify(await box('.scene-legend')))
const mm = await box('.mm-thumb'); const lg = await box('.scene-legend')
console.log('   no overlap     :', lg.y >= mm.y + mm.h)
console.log('   pick hint      :', await p.$eval('.mm-thumb .mm-pick', (n) => n.textContent.trim()))
await p.screenshot({ path: 'screenshots/fix-default.png' })

console.log('')
console.log('   TOOLS carries region select:')
await p.click('.rail-btn[aria-label="Tools"]'); await p.waitForTimeout(500)
console.log('   rows  :', JSON.stringify(await p.$$eval('.rail-panel .layer',
  (n) => n.map((x) => `${x.querySelector('.name').textContent}[${x.querySelector('.badge')?.textContent ?? ''}]`))))
console.log('   select title:', (await p.$eval('.rail-panel .layer', (n) => n.title)).slice(0, 70) + '…')
await p.click('.rail-btn[aria-label="Tools"]'); await p.waitForTimeout(400)

console.log('')
console.log('   DRAG-SELECT STILL LOADS A TILE FROM THE THUMBNAIL')
const before = await p.evaluate(() => window.__store.getState().region)
const c = await box('.mm-thumb .mm-canvas')
// a box well inside the 1.5-10 deg limits, over open water east of the peninsula
await p.mouse.move(c.x + c.w * 0.52, c.y + c.h * 0.36)
await p.mouse.down()
await p.mouse.move(c.x + c.w * 0.70, c.y + c.h * 0.56, { steps: 14 })
console.log('   while dragging :', await p.$eval('.mm-thumb .mm-pick', (n) => n.textContent.trim()))
await p.screenshot({ path: 'screenshots/fix-dragging.png' })
await p.mouse.up()
await p.waitForTimeout(1200)
const after = await p.evaluate(() => window.__store.getState().region)
console.log('   region         :', before, '->', after, after !== before ? 'CHANGED' : 'unchanged')
await p.waitForFunction((r) => window.__store.getState().dataset?.meta.region === r,
  after, { timeout: 180000 }).catch(() => console.log('   (tile still loading — cold Copernicus fetch)'))
await p.waitForTimeout(1500)
console.log('   loaded tile    :', await p.evaluate(() => window.__store.getState().dataset?.meta.regionLabel))
await p.screenshot({ path: 'screenshots/fix-loaded.png' })

console.log('')
console.log('errors:', errs.length ? errs : 'none')
await b.close()
