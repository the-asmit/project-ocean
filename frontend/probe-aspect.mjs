import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas'); await p.waitForTimeout(7000)

const mm = await p.locator('.mm-canvas').boundingBox()
const px = lon => mm.x + ((lon - 68) / 30) * mm.width
const py = lat => mm.y + (1 - lat / 26) * mm.height

async function pick(lo0, lo1, la0, la1, tag) {
  await p.mouse.move(px(lo0), py(la1)); await p.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await p.mouse.move(px(lo0 + (lo1 - lo0) * i / 6), py(la1 + (la0 - la1) * i / 6))
    await p.waitForTimeout(50)
  }
  await p.mouse.up()
  await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 600000 })
  await p.waitForTimeout(4500)
  const r = await p.evaluate(() => {
    const o = window.__oceanBlock
    return { spanX: +o.spanX.toFixed(1), spanZ: +o.spanZ.toFixed(1),
             ratio: +(o.spanX / o.spanZ).toFixed(2), height: +o.height.toFixed(1),
             chamfer: +o.chamfer.toFixed(2), boxMaxY: +o.boxMaxY.toFixed(2) }
  })
  console.log(tag, JSON.stringify(r))
  // shallowest readable point on a cut face must still be ~0 m, proving the
  // bevel did not eat the top of the cross-section
  const h = await p.locator('.scene-host').boundingBox()
  let best = null
  for (let fy = 0.40; fy <= 0.80; fy += 0.02) {
    await p.mouse.move(h.x + h.width * 0.80, h.y + h.height * fy)
    await p.waitForTimeout(120)
    const t = await p.locator('.hud-card').first().textContent().catch(() => null)
    const m = t && t.match(/depth ([\d.]+) m/)
    if (m && (best === null || +m[1] < best)) best = +m[1]
  }
  console.log('   shallowest wall reading:', best, 'm')
  await p.locator('.scene-panel').screenshot({ path: `screenshots/shape-${tag.split(' ')[0].toLowerCase()}.png` })
  await p.screenshot({ path: `screenshots/shape-${tag.split(' ')[0].toLowerCase()}-full.png` })
  return r
}

await pick(82, 90, 14, 17, 'WIDE  8.0x3.0deg ->')
await pick(85, 88, 10, 19, 'TALL  3.0x9.0deg ->')
await b.close()
