// Batched inspection round for the dashboard rebuild: default state, pinned
// state, expanded 3D, and a narrow viewport — one browser, one pass.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.argv[2] || 'http://localhost:5173/'
mkdirSync('screenshots', { recursive: true })

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await b.newPage({ viewport: { width: 1680, height: 950 }, deviceScaleFactor: 1 })
const errs = []
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.scene-host canvas', { timeout: 40000 })
await page.waitForTimeout(6000)

const shot = async (n) => {
  await page.screenshot({ path: `screenshots/dash-${n}.png` })
  console.log(`  wrote screenshots/dash-${n}.png`)
}

await shot('1-default')

// --- hover + click-to-pin inside the bounded 3D panel --------------------
const host = await page.locator('.scene-host').boundingBox()
const px = host.x + host.width * 0.45
const py = host.y + host.height * 0.66
await page.mouse.move(px, py)
await page.waitForTimeout(900)
await page.mouse.down(); await page.mouse.up()
await page.waitForTimeout(2200)
await shot('2-pinned')

// --- charts read from the pin: confirm they actually re-sampled ----------
const state = await page.evaluate(() => ({
  transect: document.querySelector('.chart-transect .panel-head .sub')?.textContent,
  profile: document.querySelector('.chart-profile .panel-head .sub')?.textContent,
  pinValue: document.querySelector('.readout .big')?.textContent,
  isoLines: document.querySelectorAll('.chart-transect .recharts-line').length,
  region: document.querySelector('.appbar .ctx .cell:nth-child(3) .v')?.textContent,
  ruler: document.querySelectorAll('.depth-ruler .tick').length,
  profilePts: document.querySelectorAll('.chart-profile .recharts-line-dots circle').length,
  hud: !!document.querySelector('.hud-card'),
}))
console.log('  state:', JSON.stringify(state))

// --- expanded 3D deep-dive ----------------------------------------------
await page.click('.scene-panel .panel-head .tools .ibtn:last-child')
await page.waitForTimeout(1600)
await shot('3-expanded')
await page.keyboard.press('Escape')
await page.waitForTimeout(900)

// --- sliced block: the depth clip cuts the diorama down -----------------
const sl = await page.locator('#sl-slice-from-top').boundingBox()
await page.mouse.click(sl.x + sl.width * 0.40, sl.y + sl.height / 2)
await page.waitForTimeout(1500)
await shot('5-sliced')
console.log('  slice:', await page.locator('.srow .num').first().textContent())
await page.mouse.click(sl.x + sl.width, sl.y + sl.height / 2)
await page.waitForTimeout(900)

// --- narrow viewport: structural collapse -------------------------------
await page.setViewportSize({ width: 1150, height: 800 })
await page.waitForTimeout(1600)
await shot('4-narrow')

console.log(errs.length ? `\nCONSOLE ERRORS (${errs.length}):` : '\nno console errors')
for (const e of [...new Set(errs)].slice(0, 12)) console.log('  -', e)
await b.close()
