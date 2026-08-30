import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)

const box = () => p.evaluate(() => {
  const o = window.__oceanBlock
  let m = null
  window.__oceanScene.traverse(n => { if (n.isMesh && n.userData.pickTarget) m = n })
  m.updateWorldMatrix(true, false); m.geometry.computeBoundingBox()
  const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)
  return { verts: m.geometry.attributes.position.count,
    halfX: +(o.spanX/2).toFixed(2), xWest: +o.xWest.toFixed(2), westCut: +o.westCut.toFixed(2),
    min: [+bb.min.x.toFixed(2), +bb.min.y.toFixed(2), +bb.min.z.toFixed(2)],
    max: [+bb.max.x.toFixed(2), +bb.max.y.toFixed(2), +bb.max.z.toFixed(2)] }
})
const foot = async () => (await p.locator('.appfoot').textContent()).replace(/\s+/g,' ').slice(0,150)

console.log('west OFF :', JSON.stringify(await box()))
await p.locator('#sl-slice-from-west').fill('26'); await p.waitForTimeout(1500)
console.log('west ON  :', JSON.stringify(await box()))
console.log('  slider :', (await p.locator('.srow .num').nth(1).textContent()).trim())
console.log('  footer :', await foot())
await p.mouse.move(12,12); await p.waitForTimeout(600)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/west-cut.png' })

// hover the NEW west face: it now faces -X, visible after orbiting round
const h = await p.locator('.scene-host').boundingBox()
const cx = h.x + h.width/2, cy = h.y + h.height/2
await p.mouse.move(cx, cy); await p.mouse.down()
for (let i=1;i<=12;i++){ await p.mouse.move(cx + 260*i/12, cy); await p.waitForTimeout(25) }
await p.mouse.up(); await p.waitForTimeout(900)
const hits = []
for (let fx=0.34; fx<=0.62; fx+=0.07) for (let fy=0.40; fy<=0.60; fy+=0.07) {
  await p.mouse.move(h.x+h.width*fx, h.y+h.height*fy); await p.waitForTimeout(90)
  const t = await p.locator('.hud-card:not(.pinned)').first().textContent().catch(()=>null)
  if (!t) continue
  const v=t.match(/(-?[\d.]+)\s*°C/), d=t.match(/depth (\d+) m/), lo=t.match(/lon ([\d.]+)/), la=t.match(/lat ([\d.]+)/)
  if (v&&d&&lo) hits.push(`${la[1]}N ${lo[1]}E @${d[1]}m = ${v[1]}C`)
}
console.log('hover on cut faces:'); hits.slice(0,6).forEach(x => console.log('   ', x))
await p.mouse.move(12,12); await p.waitForTimeout(500)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/west-cut-face.png' })

// both cuts at once
await p.locator('#sl-slice-from-top').fill('16'); await p.waitForTimeout(1500)
console.log('both ON  :', JSON.stringify(await box()))
console.log('  footer :', await foot())
await p.locator('.scene-panel').screenshot({ path: 'screenshots/west-and-top.png' })
await b.close()
