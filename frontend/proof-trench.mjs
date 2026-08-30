import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)
await p.locator('#sl-vertical-exaggeration').fill('30'); await p.waitForTimeout(1800)

const dump = () => p.evaluate(() => {
  const s = window.__oceanScene, o = window.__oceanBlock
  const ms = []
  s.traverse((n) => {
    if (!n.isMesh && !n.isLineSegments) return
    n.updateWorldMatrix(true, false)
    const g = n.geometry; g.computeBoundingBox()
    const bb = g.boundingBox.clone().applyMatrix4(n.matrixWorld)
    const m = n.material
    ms.push({ kind: n.isMesh ? 'Mesh' : 'Line', verts: g.attributes.position.count,
      mat: m.type, wire: !!m.wireframe, depthTest: m.depthTest,
      nClip: (m.clippingPlanes||[]).length, hasMap: !!m.map, pick: !!n.userData.pickTarget,
      min: [+bb.min.x.toFixed(2), +bb.min.y.toFixed(2), +bb.min.z.toFixed(2)],
      max: [+bb.max.x.toFixed(2), +bb.max.y.toFixed(2), +bb.max.z.toFixed(2)] })
  })
  const cl = window.__oceanClip
  return { ms, halfX: +(o.spanX/2).toFixed(2), halfZ: +(o.spanZ/2).toFixed(2),
    boxMaxY: +o.boxMaxY.toFixed(2), boxMinY: +o.boxMinY.toFixed(2),
    clip: cl ? { active: cl.active, u: [+cl.uniform.x.toFixed(3), +cl.uniform.y.toFixed(3), +cl.uniform.z.toFixed(3), +cl.uniform.w.toFixed(2)],
      keep: [+cl.keep.normal.x.toFixed(3), +cl.keep.normal.z.toFixed(3), +cl.keep.constant.toFixed(2)],
      removed: [+cl.removed.normal.x.toFixed(3), +cl.removed.normal.z.toFixed(3), +cl.removed.constant.toFixed(2)] } : null }
})
const show = (t, d) => {
  console.log(`--- ${t} ---`)
  console.log(`  halfX=${d.halfX} halfZ=${d.halfZ} boxY=[${d.boxMinY}, ${d.boxMaxY}]  clip=${JSON.stringify(d.clip)}`)
  for (const m of d.ms) console.log(`  ${m.kind.padEnd(4)} v=${String(m.verts).padStart(5)} ${m.mat.padEnd(17)} wire=${String(m.wire).padEnd(5)} depthTest=${String(m.depthTest).padEnd(5)} clipPlanes=${m.nClip} map=${String(m.hasMap).padEnd(5)} pick=${String(m.pick).padEnd(5)} bbox=${JSON.stringify(m.min)}..${JSON.stringify(m.max)}`)
}
show('SECTION ON (trench)', await dump())
await p.locator('.scene-panel').screenshot({ path: 'screenshots/trench-on.png' })

await p.locator('.layer', { hasText: 'Vertical section' }).click(); await p.waitForTimeout(1200)
show('SECTION OFF (full block restored)', await dump())
await p.locator('.scene-panel').screenshot({ path: 'screenshots/trench-off.png' })

await p.locator('.layer', { hasText: 'Vertical section' }).click(); await p.waitForTimeout(1200)
await p.evaluate(() => window.__oceanScene.traverse(n => { if (n.isMesh && !n.material.map) { n.material.wireframe = true; n.material.needsUpdate = true } }))
await p.waitForTimeout(800)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/trench-wire.png' })
await b.close()
