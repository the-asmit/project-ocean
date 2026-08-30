import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(3000)

const mm = await p.locator('.mm-canvas').boundingBox()
const px = lon => mm.x + ((lon - 68) / 30) * mm.width
const py = lat => mm.y + (1 - lat / 26) * mm.height

async function pick(lo0, lo1, la0, la1, slug) {
  await p.mouse.move(px(lo0), py(la1)); await p.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await p.mouse.move(px(lo0 + (lo1-lo0)*i/6), py(la1 + (la0-la1)*i/6)); await p.waitForTimeout(40)
  }
  await p.mouse.up()
  await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 600000 })
  await p.waitForTimeout(4000)
  // screenshots FIRST — they are what gets judged, and a slow scan must not block them
  await p.locator('.scene-panel').screenshot({ path: `screenshots/chunk-${slug}.png` })
  await p.screenshot({ path: `screenshots/chunk-${slug}-full.png` })
  const r = await p.evaluate(() => { const o = window.__oceanBlock
    return { spanX:+o.spanX.toFixed(1), spanZ:+o.spanZ.toFixed(1), ratio:+(o.spanX/o.spanZ).toFixed(2) } })
  // coarse scan: does the cut face still read real depths?
  const h = await p.locator('.scene-host').boundingBox()
  let lo=null, hi=null, hits=0
  for (let fx=0.40; fx<=0.44; fx+=0.04) for (let fy=0.50; fy<=0.62; fy+=0.06) {
    await p.mouse.move(h.x+h.width*fx, h.y+h.height*fy); await p.waitForTimeout(60)
    const t = await p.locator('.hud-card').first().textContent().catch(()=>null)
    const m = t && t.match(/depth ([\d.]+) m/); if (!m) continue
    hits++; const v=+m[1]; if(lo===null||v<lo)lo=v; if(hi===null||v>hi)hi=v
  }
  console.log(slug, JSON.stringify(r), `| pickable pts ${hits}, depths ${lo}..${hi} m`)
}
await pick(82, 90, 14, 17, 'wide')
await pick(85, 88, 10, 19, 'tall')
await b.close()
