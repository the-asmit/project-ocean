import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
mkdirSync('screenshots', { recursive: true })

const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const page = await b.newPage({ viewport: { width: 1680, height: 950 } })
const errs = []
page.on('console', m => m.type() === 'error' && errs.push(m.text()))
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.scene-host canvas', { timeout: 40000 })
await page.waitForSelector('.mm-canvas', { timeout: 60000 })
await page.waitForTimeout(7000)
await page.screenshot({ path: 'screenshots/pick-1-default.png' })
console.log('1 default written')

// --- mid-drag on the basemap -------------------------------------------
const mm = await page.locator('.mm-canvas').boundingBox()
// basemap spans 68-98E / 0-26N. Draw ~ 84-90E, 13-19N (west Bay of Bengal).
const px = (lon) => mm.x + ((lon - 68) / 30) * mm.width
const py = (lat) => mm.y + (1 - (lat - 0) / 26) * mm.height
await page.mouse.move(px(86), py(19))
await page.mouse.down()
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(px(86 + i * 0.75), py(19 - i * 0.75))
  await page.waitForTimeout(60)
}
await page.waitForTimeout(500)
await page.screenshot({ path: 'screenshots/pick-2-dragging.png' })
console.log('2 drag written · label:', await page.locator('.mm-pick').textContent())

await page.mouse.up()
await page.waitForTimeout(1200)
await page.screenshot({ path: 'screenshots/pick-3-loading.png' })
console.log('3 loading written · busy:', await page.locator('.scene-busy .t').count())

// wait for the new tile (may hit Copernicus)
await page.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 600000 })
await page.waitForTimeout(6000)
await page.screenshot({ path: 'screenshots/pick-4-loaded.png' })

const st = await page.evaluate(() => ({
  region: document.querySelector('.appbar .ctx .cell:nth-child(3) .v')?.textContent,
  header: document.querySelector('.scene-panel .panel-head .sub')?.textContent,
  mapBounds: document.querySelector('.mm-legend span:last-child')?.textContent,
  transect: document.querySelector('.chart-transect .panel-head .sub')?.textContent,
  footer: document.querySelector('.appfoot .src')?.textContent?.trim().slice(0, 60),
}))
console.log('4 loaded:', JSON.stringify(st))

// hover/pin still work on the new tile
const h = await page.locator('.scene-host').boundingBox()
await page.mouse.move(h.x + h.width * 0.63, h.y + h.height * 0.60)
await page.waitForTimeout(900)
await page.mouse.down(); await page.mouse.up()
await page.waitForTimeout(2200)
await page.screenshot({ path: 'screenshots/pick-5-pinned.png' })
console.log('pin:', await page.locator('.readout .big').textContent().catch(() => 'none'),
            await page.locator('.readout .where').textContent().catch(() => ''))

console.log(errs.length ? 'ERRORS: ' + [...new Set(errs)].slice(0,5).join(' | ') : 'no console errors')
await b.close()
