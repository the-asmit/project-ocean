import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)
const hb = await p.locator('.scene-host').boundingBox()
await p.mouse.move(hb.x + hb.width*0.34, hb.y + hb.height*0.56); await p.waitForTimeout(300)
await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(1500)

console.log('=== horizontal variation along the section, from the paint array ===')
const st = await p.evaluate(() => window.__oceanSection)
console.log('line:', JSON.stringify(st.a), '->', JSON.stringify(st.b), '| contours:', st.contours)
for (const r of st.rows) console.log(`  ${String(r.depthM).padStart(6)} m  n=${r.n}  ${r.min}..${r.max} °C  spread ${r.spreadC} °C  sd ${r.sdC}`)

console.log('=== hover readings ON the plane ===')
const h = await p.locator('.scene-host').boundingBox()
const seen = []
for (let fx = 0.30; fx <= 0.72; fx += 0.03) {
  for (const fy of [0.32, 0.36, 0.40, 0.44, 0.48]) {
    await p.mouse.move(h.x + h.width*fx, h.y + h.height*fy)
    await p.waitForTimeout(60)
    const t = await p.locator('.hud-card:not(.pinned)').first().textContent().catch(()=>null)
    if (!t) continue
    const kind = t.match(/section plane/) ? 'PLANE' : 'block'
    const v = t.match(/(-?[\d.]+)\s*°C/); const d = t.match(/depth ([\d.]+) m/)
    const lo = t.match(/lon ([\d.]+)/); const la = t.match(/lat ([\d.]+)/)
    if (kind === 'PLANE' && v && d && lo) seen.push({ fx:+fx.toFixed(2), lat:la?.[1], lon:lo[1], d:+d[1], v:+v[1] })
  }
}
const picked = [seen[0], seen[Math.floor(seen.length/2)], seen[seen.length-1]].filter(Boolean)
for (const s of picked) console.log(`  x=${s.fx}  ${s.lat}N ${s.lon}E  ${s.d} m  ->  ${s.v} °C`)
console.log(`  (${seen.length} plane hits total; value range ${Math.min(...seen.map(s=>s.v))}..${Math.max(...seen.map(s=>s.v))} °C)`)

await p.locator('.scene-panel').screenshot({ path: 'screenshots/plane-contours.png' })
await b.close()
