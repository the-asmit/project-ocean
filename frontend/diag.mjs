import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)
const h = await p.locator('.scene-host').boundingBox()
await p.mouse.move(h.x + h.width*0.34, h.y + h.height*0.56); await p.waitForTimeout(300)
await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(1800)
console.log('section line:', JSON.stringify(await p.evaluate(() => { const s=window.__oceanSection; return s?{a:s.a,b:s.b}:null })))
for (const fy of [0.30,0.34,0.38,0.42,0.46,0.50,0.55,0.60]) {
  const out = []
  for (const fx of [0.34,0.42,0.50,0.58,0.66]) {
    await p.mouse.move(h.x+h.width*fx, h.y+h.height*fy); await p.waitForTimeout(80)
    const t = await p.locator('.hud-card:not(.pinned)').first().textContent().catch(()=>null)
    out.push(t ? t.replace(/\s+/g,' ').trim().slice(0,58) : 'MISS')
  }
  console.log(fy.toFixed(2), '|', out.join(' || '))
}
await b.close()
