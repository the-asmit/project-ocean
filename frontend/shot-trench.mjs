import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)
await p.locator('#sl-vertical-exaggeration').fill('30'); await p.waitForTimeout(1800)
console.log('ghost edge segments:', await p.evaluate(() => {
  let n = 0
  window.__oceanScene.traverse(o => { if (o.isLineSegments && o.material.clippingPlanes?.length) n = Math.max(n, o.geometry.attributes.position.count/2) })
  return n
}))
await p.mouse.move(12, 12); await p.waitForTimeout(800)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/trench-clean.png' })
await p.screenshot({ path: 'screenshots/trench-clean-full.png' })
await b.close()
