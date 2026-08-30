import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)

console.log('docked  — section sliders visible:', await p.locator('#sl-slice-from-top').count(), await p.locator('#sl-slice-from-west').count())
await p.locator('[aria-label="Full view"]').click()
await p.waitForTimeout(1500)
const inOverlay = async (id) => p.locator(`.scene-controls ${id}`).count()
console.log('expanded — inside .scene-controls:',
  'top=', await inOverlay('#sl-slice-from-top'),
  'west=', await inOverlay('#sl-slice-from-west'),
  'vertexag=', await inOverlay('#sl-vertical-exaggeration'),
  'contours=', await p.locator('.scene-controls .layer').count())

// drive BOTH sliders from the fullscreen overlay and confirm the block reacts
const geom = () => p.evaluate(() => {
  const o = window.__oceanBlock
  let m = null; window.__oceanScene.traverse(n => { if (n.isMesh && n.userData.pickTarget) m = n })
  m.geometry.computeBoundingBox()
  const bb = m.geometry.boundingBox
  return { verts: m.geometry.attributes.position.count, xWest: +o.xWest.toFixed(2),
           wallTop: +o.wallTop.toFixed(2), yMax: +bb.max.y.toFixed(2) }
})
console.log('  before:', JSON.stringify(await geom()))
await p.locator('.scene-controls #sl-slice-from-west').fill('30'); await p.waitForTimeout(1200)
await p.locator('.scene-controls #sl-slice-from-top').fill('18'); await p.waitForTimeout(1200)
console.log('  after :', JSON.stringify(await geom()))
console.log('  readouts:', (await p.locator('.scene-controls .num').allTextContents()).join(' | '))

// arrow key must step ONCE, not twice (both mounts are alive)
await p.locator('.scene-host canvas').click({ position: { x: 40, y: 40 } })
await p.waitForTimeout(400)
const before = await p.evaluate(() => window.__oceanBlock && document.querySelector('.scene-controls .num').textContent)
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(500)
const after = await p.evaluate(() => document.querySelector('.scene-controls .num').textContent)
console.log('  ArrowRight once:', before.trim(), '->', after.trim())

console.log('  duplicate ids in DOM:', await p.evaluate(() => ['sl-slice-from-top','sl-slice-from-west'].map(i => i + '=' + document.querySelectorAll('#'+CSS.escape(i)).length + '/' + document.getElementsByName?document.querySelectorAll('[id="'+i+'"]').length:0).join(' ')))
await p.mouse.move(12,12); await p.waitForTimeout(700)
await p.screenshot({ path: 'screenshots/fullscreen-controls.png' })
await b.close()
