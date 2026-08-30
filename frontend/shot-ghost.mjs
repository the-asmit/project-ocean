import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)

const lines = () => p.evaluate(() => {
  const out = []
  window.__oceanScene.traverse(n => { if (n.isLineSegments) out.push(n.geometry.attributes.position.count / 2) })
  return out
})
console.log('no slice  — line objects (segments each):', JSON.stringify(await lines()))
await p.locator('#sl-slice-from-west').fill('30'); await p.waitForTimeout(1400)
console.log('west slice— line objects (segments each):', JSON.stringify(await lines()))
await p.mouse.move(12,12); await p.waitForTimeout(700)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/ghost-west.png' })

await p.locator('#sl-slice-from-top').fill('18'); await p.waitForTimeout(1400)
console.log('both      — line objects (segments each):', JSON.stringify(await lines()))
await p.mouse.move(12,12); await p.waitForTimeout(700)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/ghost-both.png' })

await p.locator('#sl-slice-from-west').fill('0'); await p.locator('#sl-slice-from-top').fill('0'); await p.waitForTimeout(1400)
console.log('cleared   — line objects (segments each):', JSON.stringify(await lines()))
await b.close()
