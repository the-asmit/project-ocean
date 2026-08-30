import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(3500)

const sub = async () => (await p.locator('.chart-transect .sub').textContent()).trim()
// pin a point so lat/lon modes have an anchor
const h = await p.locator('.scene-host').boundingBox()
await p.mouse.move(h.x + h.width*0.34, h.y + h.height*0.56); await p.waitForTimeout(250)
await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(800)

console.log('lat mode :', await sub())
await p.locator('.scene-panel').screenshot({ path: 'screenshots/section-lat.png' })

await p.locator('.chart-transect .seg button', { hasText: 'S→N' }).click()
await p.waitForTimeout(1200)
console.log('lon mode :', await sub())
await p.locator('.scene-panel').screenshot({ path: 'screenshots/section-lon.png' })

// draw an A->B transect on the map
await p.locator('.mm-tool button', { hasText: 'Draw transect' }).click()
await p.waitForTimeout(300)
const mm = await p.locator('.mm-canvas').boundingBox()
const px = lon => mm.x + ((lon - 68) / 30) * mm.width
const py = lat => mm.y + (1 - lat / 26) * mm.height
await p.mouse.move(px(80.5), py(13.0)); await p.mouse.down()
for (let i=1;i<=6;i++){ await p.mouse.move(px(80.5+(84.5-80.5)*i/6), py(13.0+(17.2-13.0)*i/6)); await p.waitForTimeout(60) }
await p.mouse.up(); await p.waitForTimeout(1500)
console.log('free mode:', await sub())
console.log('AB state :', JSON.stringify(await p.evaluate(() => {
  const el = document.querySelector('.chart-transect .seg button[aria-pressed="true"]')
  return el ? el.textContent : null })))
await p.locator('.scene-panel').screenshot({ path: 'screenshots/section-free.png' })
await p.screenshot({ path: 'screenshots/section-full.png' })
await b.close()
