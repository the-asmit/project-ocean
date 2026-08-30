// Drives the interaction milestone headlessly: fly navigation, hover HUD,
// click-to-pin InfoPanel. Screenshots each step.
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'

const BASE = process.argv[2] || 'http://localhost:5173/'
mkdirSync('screenshots', { recursive: true })

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
page.on('pageerror', (e) => errs.push(e.message))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('canvas', { timeout: 30000 })
await page.waitForTimeout(5000)   // dataset fetch + 512² mesh build

const cv = page.locator('canvas').first()
const box = await cv.boundingBox()
const cx = box.x + box.width / 2
const cy = box.y + box.height / 2

const key = async (code, ms) => {
  await page.keyboard.down(code)
  await page.waitForTimeout(ms)
  await page.keyboard.up(code)
}
const look = async (dx, dy) => {
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(cx + (dx * i) / 12, cy + (dy * i) / 12)
  await page.mouse.up()
  await page.waitForTimeout(400)
}

// --- 1. fly navigation ---------------------------------------------------
await look(-150, -30)
await key('KeyW', 1400)
await page.waitForTimeout(600)
writeFileSync('screenshots/01-freefly.png', await page.screenshot())
console.log('01 fly  ', errs.length ? 'ERR ' + errs[0] : 'ok')

// --- 2. hover HUD --------------------------------------------------------
// sweep to find a spot where the readout resolves to a real value
let hoverAt = null
for (const [ox, oy] of [[0, 120], [-200, 90], [200, 140], [-90, 190], [140, 60], [0, 220]]) {
  await page.mouse.move(cx + ox, cy + oy)
  await page.waitForTimeout(320)
  const txt = await page.locator('.hud-card').first().innerText().catch(() => '')
  if (txt && /\d+\.\d+/.test(txt) && !/no data/.test(txt)) { hoverAt = [cx + ox, cy + oy]; break }
}
await page.waitForTimeout(400)
writeFileSync('screenshots/02-hover.png', await page.screenshot())
const hoverTxt = await page.locator('.hud-card').first().innerText().catch(() => '(none)')
console.log('02 hover', JSON.stringify(hoverTxt.replace(/\n/g, ' | ')), errs.length ? 'ERR' : 'ok')

// --- 3. click to pin -> InfoPanel ---------------------------------------
const clickAt = hoverAt || [cx, cy + 150]
await page.mouse.move(clickAt[0], clickAt[1])
await page.waitForTimeout(250)
await page.mouse.down(); await page.mouse.up()
await page.waitForTimeout(1800)   // let the /point server query resolve
writeFileSync('screenshots/03-selected.png', await page.screenshot())
const panelOpen = await page.locator('.infopanel.open').count()
const panelTxt = await page.locator('.infopanel').innerText().catch(() => '')
console.log('03 pin  ', panelOpen ? 'InfoPanel OPEN' : 'panel closed',
  '|', panelTxt.replace(/\n+/g, ' / ').slice(0, 190))

// --- 4. a control + orbit mode ------------------------------------------
await page.keyboard.press('KeyF')
await page.waitForTimeout(700)
writeFileSync('screenshots/04-orbit.png', await page.screenshot())

console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'NONE')
await b.close()
