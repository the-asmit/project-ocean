import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(3000)

const sl = p.locator('#sl-slice-from-top')
const read = async () => (await p.locator('.srow .num').first().textContent()).trim()
const badge = async () => (await p.locator('.section-badge').textContent().catch(() => '(none)')).replace(/\s+/g,' ').trim()
const foot = async () => (await p.locator('.appfoot').textContent()).replace(/\s+/g,' ').trim()

console.log('unsliced badge :', await badge())
console.log('unsliced foot  :', (await foot()).slice(0, 150))

// step to a mid-water level with the keyboard, from the canvas (not the slider)
await p.locator('.scene-host canvas').click({ position: { x: 60, y: 60 } })
for (let i = 0; i < 14; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(60) }
await p.waitForTimeout(1200)
console.log('after 14 x ArrowRight ->', await read(), '|', await badge())
console.log(JSON.stringify(await p.evaluate(() => { const o = window.__oceanBlock
  return { sliced:o.uniforms.uSliced.value, clipDepthM:+o.clipDepthM.toFixed(1) } })))
console.log('foot:', (await foot()).slice(0, 170))
await p.locator('.scene-panel').screenshot({ path: 'screenshots/slice-level.png' })

// does the cap read REAL values? sweep the top cap
const h = await p.locator('.scene-host').boundingBox()
const vals = []
for (let fx = 0.36; fx <= 0.60; fx += 0.06) for (let fy = 0.38; fy <= 0.50; fy += 0.06) {
  await p.mouse.move(h.x + h.width*fx, h.y + h.height*fy); await p.waitForTimeout(70)
  const t = await p.locator('.hud-card').first().textContent().catch(()=>null)
  const m = t && t.match(/(-?[\d.]+)\s*°C/); const d = t && t.match(/depth ([\d.]+) m/)
  if (m && d) vals.push(`${d[1]}m=${m[1]}C`)
}
console.log('cap readings:', vals.slice(0, 6).join('  '))

// last real level, then one past it into the opt-in zone
await p.locator('#sl-slice-from-top').fill('31'); await p.waitForTimeout(900)
console.log('level 31       :', await read(), '|', await badge())
await p.locator('.layer[aria-pressed]').filter({ hasText: 'Extend' }).click()
await p.waitForTimeout(400)
await p.locator('#sl-slice-from-top').fill('40'); await p.waitForTimeout(1200)
console.log('extended       :', await read(), '|', await badge())
await p.locator('.scene-panel').screenshot({ path: 'screenshots/slice-void.png' })
await b.close()
