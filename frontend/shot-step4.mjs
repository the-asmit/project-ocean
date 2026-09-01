// Step 4 verification: fullscreen gone, no duplicate control paths, Esc intact.
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

console.log('1. FULLSCREEN IS GONE')
console.log('   sceneExpanded in store :', 'sceneExpanded' in (await p.evaluate(() => window.__store.getState())))
console.log('   .scene-controls in dom :', (await p.$$('.scene-controls')).length)
console.log('   scene-panel classes    :', await p.$eval('.scene-panel', (n) => n.className))
console.log('   header tools           :', (await p.$$eval('.scene-panel > .panel-head .ibtn', (n) => n.map((x) => x.getAttribute('aria-label')))).join(', '))

console.log('')
console.log('2. NO DUPLICATE CONTROL PATHS')
const dupes = await p.evaluate(() => {
  const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
  const seen = new Set(); const dup = new Set()
  for (const i of ids) { if (seen.has(i)) dup.add(i); seen.add(i) }
  return [...dup]
})
console.log('   duplicate element ids  :', dupes.length ? dupes : 'none')
await p.click('.rail-btn[aria-label="Section"]'); await p.waitForTimeout(400)
console.log('   section sliders mounted:', await p.$$eval('input[type=range]', (n) => n.length), 'once')
console.log('   duplicate ids w/ panel :', (await p.evaluate(() => {
  const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
  const seen = new Set(); const dup = new Set()
  for (const i of ids) { if (seen.has(i)) dup.add(i); seen.add(i) }
  return [...dup]
})).length || 'none')

console.log('')
console.log('3. ARROW KEYS FIRE ONCE (the handler used to be doubled)')
const before = await p.evaluate(() => window.__store.getState().clipIndex)
await p.keyboard.press('ArrowRight')
await p.waitForTimeout(350)
const after = await p.evaluate(() => window.__store.getState().clipIndex)
console.log(`   clipIndex ${before} -> ${after}  (one press = one level)`)

console.log('')
console.log('4. ESC STILL CLEARS THE PIN (its capture-phase handler went with fullscreen)')
await p.click('.rail-btn[aria-label="Section"]'); await p.waitForTimeout(300)
const c = await box('.scene-host canvas')
await p.mouse.click(c.x + c.w * 0.5, c.y + c.h * 0.5)
await p.waitForTimeout(900)
console.log('   pinned                 :', !!(await p.evaluate(() => window.__store.getState().selected)))
console.log('   pinned controls in view:', (await p.$$('.pinned-controls')).length)
await p.keyboard.press('Escape')
await p.waitForTimeout(400)
console.log('   after Esc, pinned      :', !!(await p.evaluate(() => window.__store.getState().selected)))
console.log('   pinned controls gone   :', (await p.$$('.pinned-controls')).length === 0)

console.log('')
console.log('5. FOOTER, RESERVED')
console.log('   height, default        :', (await p.evaluate(() => document.querySelector('.appfoot').getBoundingClientRect().height)).toFixed(1) + 'px')
console.log('   min-height             :', await p.evaluate(() => getComputedStyle(document.querySelector('.appfoot')).minHeight))

console.log('')
console.log('6. EVERYTHING STILL MOUNTS')
console.log('   panels                 :', (await p.$$eval('.panel-head h2, .stats-head .lbl', (n) => n.map((x) => x.textContent))).join(', '))
console.log('   rail groups            :', (await p.$$eval('.rail-btn .rail-label', (n) => n.map((x) => x.textContent))).join(' '))
await p.screenshot({ path: 'screenshots/step4-final.png' })

console.log('')
console.log('errors:', errs.length ? errs : 'none')
await b.close()
