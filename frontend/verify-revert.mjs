import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE', m.text().slice(0,200)) })
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)

const graph = () => p.evaluate(() => {
  const ms = []
  window.__oceanScene.traverse(n => {
    if (!n.isMesh && !n.isLineSegments) return
    const g = n.geometry
    ms.push({ kind: n.isMesh ? 'Mesh' : 'Line', verts: g.attributes.position.count,
      mat: n.material.type, nClip: (n.material.clippingPlanes||[]).length, map: !!n.material.map })
  })
  return { ms, clipGlobal: !!window.__oceanClip, section: !!window.__oceanSection }
})
console.log('--- default view ---')
let g = await graph()
for (const m of g.ms) console.log(`  ${m.kind.padEnd(4)} v=${String(m.verts).padStart(5)} ${m.mat.padEnd(18)} clipPlanes=${m.nClip} map=${m.map}`)
console.log('  section globals present:', g.clipGlobal, g.section)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/reverted-block.png' })

// slice-from-top still live?
await p.locator('#sl-slice-from-top').fill('14'); await p.waitForTimeout(1200)
console.log('slice:', (await p.locator('.probe, .srow .num').first().textContent()).trim(),
            '| badge:', (await p.locator('.section-badge').textContent().catch(()=>'none')).replace(/\s+/g,' ').trim())
await p.locator('#sl-slice-from-top').fill('0'); await p.waitForTimeout(800)

// depth probe still live?
const h = await p.locator('.scene-host').boundingBox()
await p.mouse.move(h.x + h.width*0.34, h.y + h.height*0.56); await p.waitForTimeout(300)
await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(1200)
await p.locator('#sl-depth-cursor').fill('20'); await p.waitForTimeout(400)
console.log('depth cursor:', (await p.locator('.probe .num').textContent()).trim(),
            '->', (await p.locator('.probe-read').textContent()).replace(/\s+/g,' ').trim())
console.log('transect:', (await p.locator('.chart-transect .sub').textContent()).trim())
await p.mouse.move(12,12); await p.waitForTimeout(600)
await p.screenshot({ path: 'screenshots/reverted-full.png' })
await b.close()
