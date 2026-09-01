// Fullscreen restored on the 3D panel — and only there.
import { chromium } from 'playwright'

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 950 } })
const errs = []
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()) })
const box = async (sel) => p.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
}, sel)

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForFunction(() => window.__store?.getState().dataset, undefined, { timeout: 60000 })
await p.waitForTimeout(2000)

console.log('1. THE BUTTON IS ON THE 3D PANEL ONLY')
console.log('   3D panel tools :', (await p.$$eval('.scene-panel > .panel-head .ibtn',
  (n) => n.map((x) => x.getAttribute('aria-label')))).join(' | '))
console.log('   map panel tools:', (await p.$$eval('.map-panel > .panel-head .ibtn',
  (n) => n.map((x) => x.getAttribute('aria-label')))).join(' | ') || 'none')

console.log('')
console.log('2. DOCKED')
console.log('   scene  :', JSON.stringify(await box('.scene-panel')))
console.log('   canvas :', JSON.stringify(await box('.scene-host canvas')))
await p.screenshot({ path: 'screenshots/fs-docked.png' })

console.log('')
console.log('3. EXPANDED')
await p.click('.scene-panel .ibtn[aria-label="Full view"]')
await p.waitForTimeout(900)
console.log('   store        :', await p.evaluate(() => window.__store.getState().sceneExpanded))
console.log('   scene        :', JSON.stringify(await box('.scene-panel')), '(viewport is 1600x950)')
console.log('   canvas       :', JSON.stringify(await box('.scene-host canvas')))
console.log('   rail present :', (await p.$$('.scene-rail')).length, 'strip,',
  (await p.$$eval('.rail-btn .rail-label', (n) => n.map((x) => x.textContent))).join(' '))
console.log('   duplicate ids:', (await p.evaluate(() => {
  const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
  const seen = new Set(); const dup = new Set()
  for (const i of ids) { if (seen.has(i)) dup.add(i); seen.add(i) }
  return [...dup]
})).length || 'none')
console.log('   button now   :', await p.$eval('.scene-panel .ibtn[aria-pressed="true"]',
  (n) => n.getAttribute('aria-label')))
await p.screenshot({ path: 'screenshots/fs-expanded.png' })

console.log('')
console.log('4. CONTROLS REACHABLE WHILE EXPANDED (they were not, before)')
await p.click('.rail-btn[aria-label="Scale"]'); await p.waitForTimeout(600)
console.log('   Scale panel  :', await p.$eval('.rail-panel .panel-head h2', (n) => n.textContent),
  '·', await p.$$eval('.rail-panel .pal', (n) => n.length), 'palettes')
await p.click('.rail-btn[aria-label="Section"]'); await p.waitForTimeout(500)
await p.evaluate(() => {
  const i = document.querySelector('#sl-slice-from-top')
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(i, '8'); i.dispatchEvent(new Event('input', { bubbles: true }))
})
await p.waitForTimeout(700)
console.log('   slice works  : clipIndex', await p.evaluate(() => window.__store.getState().clipIndex),
  '· badge', await p.$eval('.section-badge .d', (n) => n.textContent))
await p.click('.rail-btn[aria-label="Section"]'); await p.waitForTimeout(400)
await p.screenshot({ path: 'screenshots/fs-expanded-scale.png' })

console.log('')
console.log('5. PIN + DEPTH CURSOR STILL IN THE CANVAS')
const c = await box('.scene-host canvas')
await p.mouse.click(c.x + c.w * 0.55, c.y + c.h * 0.5)
await p.waitForTimeout(900)
console.log('   pinned       :', !!(await p.evaluate(() => window.__store.getState().selected)))
console.log('   controls     :', JSON.stringify(await box('.pinned-controls')))

console.log('')
console.log('6. ESC EXITS FULLSCREEN AND DOES NOT ALSO DROP THE PIN')
await p.keyboard.press('Escape')
await p.waitForTimeout(600)
console.log('   expanded     :', await p.evaluate(() => window.__store.getState().sceneExpanded))
console.log('   pin survives :', !!(await p.evaluate(() => window.__store.getState().selected)))
await p.keyboard.press('Escape')
await p.waitForTimeout(400)
console.log('   2nd Esc drops the pin :', !(await p.evaluate(() => window.__store.getState().selected)))
console.log('   scene back to:', JSON.stringify(await box('.scene-panel')))
console.log('   map visible  :', JSON.stringify(await box('.map-panel')))
await p.screenshot({ path: 'screenshots/fs-back.png' })

console.log('')
console.log('errors:', errs.length ? errs : 'none')
await b.close()
