import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)
const h = await p.locator('.scene-host').boundingBox()
const cx = h.x + h.width / 2, cy = h.y + h.height / 2
await p.locator('.scene-panel').screenshot({ path: 'screenshots/orbit-0.png' })
for (const [tag, dx] of [['90', 240], ['180', 240], ['270', 240]]) {
  await p.mouse.move(cx, cy); await p.mouse.down()
  for (let i = 1; i <= 12; i++) { await p.mouse.move(cx + dx * i / 12, cy); await p.waitForTimeout(20) }
  await p.mouse.up(); await p.waitForTimeout(900)
  await p.locator('.scene-panel').screenshot({ path: `screenshots/orbit-${tag}.png` })
}
await b.close()
console.log('ok')
