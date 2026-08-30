import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)
const h = await p.locator('.scene-host').boundingBox()
await p.mouse.move(h.x + h.width*0.34, h.y + h.height*0.56); await p.waitForTimeout(300)
await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(1800)

const screenAt = async (lon, depthM) => p.evaluate(([lon, depthM]) => {
  const s = window.__oceanSection, o = window.__oceanBlock, cam = window.__oceanCamera
  const x = ((lon - s.lonMin) / (s.lonMax - s.lonMin) - 0.5) * o.spanX
  const z = ((s.a.lat - s.latMin) / (s.latMax - s.latMin) - 0.5) * o.spanZ
  const y = o.yOfDepthM(depthM)
  const ap = (e, v) => {                       // three's applyMatrix4, by hand
    const w = 1 / (e[3]*v[0] + e[7]*v[1] + e[11]*v[2] + e[15])
    return [(e[0]*v[0] + e[4]*v[1] + e[8]*v[2] + e[12]) * w,
            (e[1]*v[0] + e[5]*v[1] + e[9]*v[2] + e[13]) * w,
            (e[2]*v[0] + e[6]*v[1] + e[10]*v[2] + e[14]) * w]
  }
  const q = ap(cam.projectionMatrix.elements, ap(cam.matrixWorldInverse.elements, [x, y, z]))
  return [q[0] * 0.5 + 0.5, -q[1] * 0.5 + 0.5]
}, [lon, depthM])

console.log('=== hover readings at EXACT points along the plane ===')
for (const depthM of [30, 120]) {
  const out = []
  for (const lon of [80.5, 81.8, 83.1, 84.4]) {
    const [u, v] = await screenAt(lon, depthM)
    if (u < 0.02 || u > 0.98 || v < 0.02 || v > 0.98) { out.push(`${lon}E:offscreen`); continue }
    await p.mouse.move(h.x + h.width*u, h.y + h.height*v); await p.waitForTimeout(160)
    const t = await p.locator('.hud-card:not(.pinned)').first().textContent().catch(()=>null)
    if (!t) { out.push(`${lon}E:MISS`); continue }
    const val = t.match(/(-?[\d.]+)\s*°C/), d = t.match(/depth (\d+) m/)
    out.push(`${lon}E @${d?d[1]:'?'}m ${val?val[1]:'?'}C${/section plane/.test(t) ? '' : ' (BLOCK)'}`)
  }
  console.log(`  target ${String(depthM).padStart(3)} m:`, out.join('  |  '))
}
await p.mouse.move(10, 10); await p.waitForTimeout(700)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/plane-contours.png' })
await b.close()
