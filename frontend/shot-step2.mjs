// Step 2 verification: in-canvas icon rail, six panels, depth cursor in canvas.
import { chromium } from 'playwright'

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 950 } })
const errs = []
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()) })

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForFunction(() => window.__store?.getState().dataset, undefined, { timeout: 60000 })
await p.waitForTimeout(1800)

const open = () => p.evaluate(() => window.__store.getState().railPanel)
const box = async (sel) => p.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
}, sel)

console.log('\n1. COLLAPSED ON LOAD — canvas full-bleed')
console.log('   railPanel     :', await open(), '(null = collapsed)')
console.log('   rails present :', await p.$$eval('.rail', (n) => n.length), '(0 = both removed)')
console.log('   rail icons    :', (await p.$$eval('.rail-btn .rail-label', (n) => n.map((x) => x.textContent))).join(' '))
console.log('   panel mounted :', (await p.$$('.rail-panel')).length, '(0 when closed — unmounted, not hidden)')
console.log('   canvas        :', JSON.stringify(await box('.scene-host canvas')))
console.log('   outside canvas:', (await p.$$eval('.center > * , .charts > *', (n) => n.map((x) => x.className.split(' ')[0]))).join(', '))
await p.screenshot({ path: 'screenshots/step2-collapsed.png' })

console.log('\n2. EACH GROUP OPENS, ONE AT A TIME')
const groups = ['Field', 'Section', 'Operational', 'Scale', 'Tools']
for (const g of groups) {
  await p.click(`.rail-btn[aria-label="${g}"]`)
  await p.waitForTimeout(500)
  const panels = await p.$$('.rail-panel')
  const title = await p.$eval('.rail-panel .panel-head h2', (n) => n.textContent).catch(() => '(none)')
  const controls = await p.$$eval('.rail-panel button, .rail-panel input, .rail-panel select',
    (n) => n.length)
  console.log(`   ${g.padEnd(12)} open=${(await open() || '').padEnd(12)} panels=${panels.length} title="${title}" controls=${controls}`)
  await p.screenshot({ path: `screenshots/step2-${g.toLowerCase()}.png` })
}

console.log('\n2b. PANEL SCROLLS, AND OVERLAYS CLEAR IT')
await p.click('.rail-btn[aria-label="Field"]'); await p.waitForTimeout(500)
console.log('   panel scrollable:', await p.evaluate(() => {
  const el = document.querySelector('.rail-panel')
  return `${el.scrollHeight}px content in ${el.clientHeight}px -> ${el.scrollHeight > el.clientHeight + 2 ? 'scrolls' : 'fits'}`
}))
await p.evaluate(() => { document.querySelector('.rail-panel').scrollTo(0, 99999) })
await p.waitForTimeout(300)
console.log('   ORBIT hint x    :', await p.evaluate(() => Math.round(document.querySelector('.navhint').getBoundingClientRect().x)), '(panel right edge is 360)')
console.log('   hint text       :', (await p.$eval('.navhint', (n) => n.textContent.trim())).slice(0, 46))
await p.screenshot({ path: 'screenshots/step2-field-scrolled.png' })

console.log('\n3. CLICKING THE ACTIVE ICON CLOSES IT')
await p.click('.rail-btn[aria-label="Tools"]')
await p.waitForTimeout(400)
console.log('   after re-click :', await open(), '· panels:', (await p.$$('.rail-panel')).length)

console.log('\n4. CONTROLS STILL WORK THROUGH THE RAIL')
await p.click('.rail-btn[aria-label="Field"]'); await p.waitForTimeout(400)
await p.click('.rail-panel .layer:has-text("Salinity")').catch(() => {})
await p.waitForTimeout(2500)
console.log('   variable       :', await p.evaluate(() => window.__store.getState().variable))
console.log('   contour label  :', await p.evaluate(() => window.__store.getState().dataset?.meta.volume.contourStep))
await p.click('.rail-btn[aria-label="Field"]'); await p.waitForTimeout(300)
await p.click('.rail-btn[aria-label="Field"]'); await p.waitForTimeout(300)
await p.click('.rail-panel .layer:has-text("Temperature")').catch(() => {})
await p.waitForTimeout(2500)
console.log('   back to        :', await p.evaluate(() => window.__store.getState().variable))

await p.click('.rail-btn[aria-label="Section"]'); await p.waitForTimeout(400)
// React tracks the input's value, so a bare `i.value = x` is ignored — the
// native setter is what makes onChange fire, i.e. what a real drag does.
await p.evaluate(() => {
  const i = document.querySelector('#sl-slice-from-top')
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(i, '6')
  i.dispatchEvent(new Event('input', { bubbles: true }))
})
await p.waitForTimeout(700)
console.log('   clipIndex      :', await p.evaluate(() => window.__store.getState().clipIndex))
console.log('   section badge  :', await p.$eval('.section-badge .d', (n) => n.textContent).catch(() => 'none'))

console.log('\n5. OPERATIONAL — stubs seated, isosurface live')
await p.click('.rail-btn[aria-label="Operational"]'); await p.waitForTimeout(400)
console.log('   rows           :', JSON.stringify(await p.$$eval('.rail-panel .layer',
  (n) => n.map((x) => `${x.querySelector('.name').textContent}[${x.querySelector('.badge')?.textContent ?? ''}]${x.disabled ? ' disabled' : ''}`))))
await p.click('.rail-panel .layer:has-text("Isosurface")')
await p.waitForFunction(() => window.__oceanIso?.built, undefined, { timeout: 60000 })
await p.waitForTimeout(600)
console.log('   isovalue slider:', (await p.$$('.rail-panel #sl-isovalue')).length ? 'present' : 'MISSING')
console.log('   isoStats       :', JSON.stringify(await p.evaluate(() => window.__store.getState().isoStats)))
await p.screenshot({ path: 'screenshots/step2-operational-iso.png' })

console.log('\n6. SCALE — colorbar editor + anomaly stub')
await p.click('.rail-btn[aria-label="Scale"]'); await p.waitForTimeout(500)
console.log('   badge          :', await p.$eval('.rail-panel .scale-mode .badge', (n) => n.textContent))
console.log('   palettes       :', await p.$$eval('.rail-panel .pal', (n) => n.length))
console.log('   segs           :', JSON.stringify(await p.$$eval('.rail-panel .seg button',
  (n) => n.map((x) => `${x.textContent.trim()}${x.disabled ? '(disabled)' : ''}${x.classList.contains('on') ? '*' : ''}`))))
await p.screenshot({ path: 'screenshots/step2-scale.png' })

console.log('\n7. MAP IS A SIBLING PANEL, NOT A RAIL GROUP')
console.log('   map panel      :', JSON.stringify(await box('.map-panel')))
console.log('   left of scene  :', (await box('.map-panel')).x < (await box('.scene-panel')).x)
console.log('   map canvas     :', JSON.stringify(await box('.mm-canvas')))
console.log('   pick hint      :', await p.$eval('.mm-pick', (n) => n.textContent.trim()))
await p.screenshot({ path: 'screenshots/step2-region.png' })

console.log('\n8. PIN — depth cursor lives in the canvas')
const c = await box('.scene-host canvas')
await p.mouse.click(c.x + c.w * 0.55, c.y + c.h * 0.5)
await p.waitForTimeout(900)
const pinned = await p.evaluate(() => window.__store.getState().selected)
console.log('   pinned         :', pinned ? `${pinned.lat.toFixed(2)}°N ${pinned.lon.toFixed(2)}°E ${pinned.depthM.toFixed(0)} m` : 'nothing hit — retry')
console.log('   controls in canvas:', JSON.stringify(await box('.pinned-controls')))
console.log('   inside canvas? :', await p.evaluate(() => {
  const a = document.querySelector('.pinned-controls'); const h = document.querySelector('.scene-host')
  return !!a && !!h && h.contains(a)
}))
console.log('   depth readout  :', await p.$eval('.pinned-controls .num', (n) => n.textContent).catch(() => 'n/a'))
console.log('   value          :', await p.$eval('.pinned-controls .probe-read', (n) => n.textContent.trim()).catch(() => 'n/a'))
await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown')
await p.waitForTimeout(400)
console.log('   after ↓↓       :', await p.$eval('.pinned-controls .num', (n) => n.textContent).catch(() => 'n/a'))
await p.screenshot({ path: 'screenshots/step2-pinned.png' })

console.log('\n9. ORBIT STILL WORKS WHERE THE RAIL IS NOT')
const before = await p.evaluate(() => window.__oceanCamera && [...window.__oceanCamera.position.toArray()])
await p.mouse.move(c.x + c.w * 0.6, c.y + c.h * 0.45)
await p.mouse.down(); await p.mouse.move(c.x + c.w * 0.72, c.y + c.h * 0.45, { steps: 12 }); await p.mouse.up()
await p.waitForTimeout(500)
const after = await p.evaluate(() => window.__oceanCamera && [...window.__oceanCamera.position.toArray()])
const moved = before && after && Math.hypot(...before.map((v, i) => v - after[i]))
console.log('   camera moved   :', moved ? `${moved.toFixed(1)} world units` : 'NO')
await p.screenshot({ path: 'screenshots/step2-full.png' })

console.log('\nerrors:', errs.length ? errs : 'none')
await b.close()
