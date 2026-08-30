import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)

// reproduce the reported condition exactly: 30x vertical exaggeration
await p.locator('#sl-vertical-exaggeration').fill('30')
await p.waitForTimeout(2000)

const dump = await p.evaluate(() => {
  const cam = window.__oceanCamera
  const scene = window.__oceanScene
  const out = { meshes: [], layout: null }
  const o = window.__oceanBlock
  out.layout = {
    spanX: +o.spanX.toFixed(2), spanZ: +o.spanZ.toFixed(2),
    boxMaxY: +o.boxMaxY.toFixed(3), boxMinY: +o.boxMinY.toFixed(3),
    wallTop: +o.wallTop.toFixed(3), geomTop: +o.geomTop.toFixed(3),
    geomBot: +o.geomBot.toFixed(3), centerY: +o.centerY.toFixed(3),
    height: +o.height.toFixed(3), chamfer: +o.chamfer.toFixed(3),
  }
  scene.traverse((n) => {
    if (!n.isMesh && !n.isLineSegments) return
    n.updateWorldMatrix(true, false)
    const g = n.geometry
    g.computeBoundingBox()
    const bb = g.boundingBox.clone().applyMatrix4(n.matrixWorld)
    const m = n.material
    out.meshes.push({
      type: n.isMesh ? 'Mesh' : 'Line',
      verts: g.attributes.position.count,
      tris: n.isMesh ? g.attributes.position.count / 3 : null,
      mat: m.type,
      depthTest: m.depthTest, transparent: m.transparent, side: m.side,
      hasMap: !!m.map,
      pickTarget: !!n.userData.pickTarget,
      parentPos: [+n.parent.position.x.toFixed(2), +n.parent.position.y.toFixed(2), +n.parent.position.z.toFixed(2)],
      min: [+bb.min.x.toFixed(2), +bb.min.y.toFixed(2), +bb.min.z.toFixed(2)],
      max: [+bb.max.x.toFixed(2), +bb.max.y.toFixed(2), +bb.max.z.toFixed(2)],
    })
  })
  return out
})

console.log('LAYOUT', JSON.stringify(dump.layout))
console.log(`SCENE MESHES/LINES: ${dump.meshes.length}`)
for (const m of dump.meshes) {
  console.log(` ${m.type.padEnd(5)} verts=${String(m.verts).padStart(6)} ${m.mat.padEnd(18)}`
    + ` depthTest=${String(m.depthTest).padEnd(5)} map=${String(m.hasMap).padEnd(5)} pick=${String(m.pickTarget).padEnd(5)}`
    + ` parentY=${m.parentPos[1]}`)
  console.log(`        world bbox  min=${JSON.stringify(m.min)}  max=${JSON.stringify(m.max)}`)
}
await b.close()
