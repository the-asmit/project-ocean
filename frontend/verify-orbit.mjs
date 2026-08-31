import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
const cam = () => p.evaluate(() => window.__oceanCamera.position.toArray().map(v => +v.toFixed(3)))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)
console.log('docked hint :', (await p.locator('.navhint').innerText()).replace(/\s+/g,' '))
console.log('docked tools:', await p.locator('.scene-panel .panel-head button').count(), 'buttons')

await p.locator('.scene-panel .panel-head button[title*="Full view"]').first().click()
const entry = []
for (let i=0;i<8;i++){ entry.push(await cam()); await p.waitForTimeout(60) }
await p.waitForTimeout(1200)
console.log('expanded    :', !!(await p.locator('.scene-panel.expanded').count()))
console.log('fullscreen hint:', (await p.locator('.navhint').innerText()).replace(/\s+/g,' '))
console.log('fullscreen tools:', await p.locator('.scene-panel .panel-head button').count(), 'buttons (no nav toggle)')
console.log('entry dist  :', entry.map(c=>Math.round(Math.hypot(...c))).join(' -> '))

// keys that used to fly must do nothing now. Blur first: the expand button
// keeps focus after being clicked and Space activates a focused button, which
// is correct browser behaviour and would collapse the view mid-test.
await p.evaluate(() => document.activeElement?.blur())
const c0 = await cam()
for (const k of ['w','a','s','d','q','e',' ']) { await p.keyboard.down(k); await p.waitForTimeout(120); await p.keyboard.up(k) }
await p.keyboard.press('f'); await p.waitForTimeout(600)
const c1 = await cam()
console.log('still expanded after key mash:', !!(await p.locator('.scene-panel.expanded').count()))
console.log('WASDQE+Space+F moved camera by:', +Math.hypot(c1[0]-c0[0],c1[1]-c0[1],c1[2]-c0[2]).toFixed(4), '(must be 0)')

// orbit drag still works in fullscreen
const h = await p.locator('.scene-host').boundingBox()
await p.mouse.move(h.x+h.width*0.45, h.y+h.height*0.5)
await p.mouse.down(); await p.mouse.move(h.x+h.width*0.60, h.y+h.height*0.5, {steps:14}); await p.mouse.up()
await p.waitForTimeout(500)
const c2 = await cam()
console.log('orbit drag moved camera by:', +Math.hypot(c2[0]-c1[0],c2[1]-c1[1],c2[2]-c1[2]).toFixed(2), '(should be > 0)')

// controls in fullscreen
await p.evaluate(()=>{ const el=document.querySelector('#sl-slice-from-top')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'14')
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})) })
await p.waitForTimeout(800)
const b0 = (await p.locator('.section-badge').innerText()).replace(/\s+/g,' ')
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(600)
console.log('slice slider:', b0)
console.log('slice arrows:', (await p.locator('.section-badge').innerText()).replace(/\s+/g,' '))
await p.locator('.scene-controls button', { hasText: 'Isosurface' }).click()
await p.waitForTimeout(1800)
await p.locator('.scene-controls button', { hasText: 'Current flow lines' }).click()
await p.waitForFunction(() => window.__oceanCurrents != null, null, { timeout: 90000 })
await p.waitForTimeout(1000)
console.log('fullscreen panels:', await p.evaluate(() => ({
  sectionSliders: document.querySelectorAll('.scene-controls input[type=range]').length,
  toggles: document.querySelectorAll('.scene-controls [aria-pressed]').length,
  isoTris: window.__oceanIso?.built?.triangles ?? 0,
  currentsStrip: !!document.querySelector('.timeline'),
})))
// hover + pin in fullscreen
await p.mouse.move(h.x+h.width*0.45, h.y+h.height*0.55); await p.waitForTimeout(800)
console.log('hover  :', (await p.locator('.hud-card').first().innerText()).replace(/\s+/g,' '))
await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(800)
console.log('pinned :', (await p.locator('.hud-card.pinned').count()) ? 'yes' : 'no')
await p.mouse.move(8,8); await p.waitForTimeout(700)
await p.screenshot({ path: 'screenshots/fullscreen-orbit.png' })
await p.keyboard.press('Escape'); await p.waitForTimeout(900)
console.log('after Esc   : expanded =', !!(await p.locator('.scene-panel.expanded').count()))
await b.close()
