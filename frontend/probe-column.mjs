import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(3500)

const h = await p.locator('.scene-host').boundingBox()
console.log('before pin, cursor present:', await p.locator('.probe').count())

// pin a point on the cut face (left side of the block, mid-height)
await p.mouse.move(h.x + h.width*0.34, h.y + h.height*0.56)
await p.waitForTimeout(300)
await p.mouse.down(); await p.mouse.up()
await p.waitForTimeout(900)
console.log('after pin, cursor present:', await p.locator('.probe').count())
console.log('pin readout   :', (await p.locator('.readout').textContent()).replace(/\s+/g,' ').trim())
console.log('cursor start  :', (await p.locator('.probe .num').textContent()).trim(),
            '=', (await p.locator('.probe-read').textContent()).replace(/\s+/g,' ').trim())

// walk the column with the keyboard from index 0
await p.locator('#sl-depth-cursor').fill('0'); await p.waitForTimeout(300)
const rows = []
for (const i of [0,4,8,12,16,20,24,28,30]) {
  await p.locator('#sl-depth-cursor').fill(String(i)); await p.waitForTimeout(180)
  rows.push(`${(await p.locator('.probe .num').textContent()).trim()} -> ${(await p.locator('.probe-read').textContent()).replace(/\s+/g,' ').trim()}`)
}
console.log('COLUMN:'); rows.forEach(r => console.log('  ', r))

// keyboard stepping from the canvas
await p.locator('#sl-depth-cursor').fill('10'); await p.waitForTimeout(200)
await p.locator('.scene-host canvas').click({ position: { x: 40, y: 40 } })
await p.waitForTimeout(400)
const before = (await p.locator('.probe .num').textContent()).trim()
for (let i=0;i<3;i++){ await p.keyboard.press('ArrowDown'); await p.waitForTimeout(120) }
console.log('ArrowDown x3  :', before, '->', (await p.locator('.probe .num').textContent()).trim())

await p.locator('#sl-depth-cursor').fill('22'); await p.waitForTimeout(600)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/probe-scene.png' })
await p.screenshot({ path: 'screenshots/probe-full.png' })
await b.close()
