import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)
const h = await p.locator('.scene-host').boundingBox()
const cx = h.x + h.width/2, cy = h.y + h.height/2
// home framing, pin cleared: the canonical view, now with contours on
await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
await p.mouse.move(12, 12); await p.waitForTimeout(800)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/plane-contours.png' })
await b.close()
