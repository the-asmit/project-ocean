// The mount-in: 600 ms, cubic ease-out, on a drawing that is already computed.
import { chromium } from 'playwright'

const EASE = (x) => 1 - Math.pow(1 - x, 3)
const b = await chromium.launch()

async function open(reducedMotion) {
  const p = await b.newPage({ viewport: { width: 1600, height: 950 }, reducedMotion })
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()) })
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await p.waitForFunction(() => window.__store?.getState().dataset, undefined, { timeout: 90000 })
  await p.waitForTimeout(2000)
  return p
}

const record = (p, ms) => p.evaluate((limit) => {
  window.__rec = []
  const t0 = performance.now()
  const tick = () => {
    const a = window.__oceanHeatAnim
    window.__rec.push([performance.now() - t0, a?.surf ?? null, a?.surfRaw ?? null,
      a?.field ?? null, a?.running ?? false])
    if (performance.now() - t0 < limit) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}, ms)

// ---------------------------------------------------------------------------
console.log('1. NORMAL MOTION — surface rises, field fades, both eased')
let p = await open('no-preference')
await record(p, 1400)
await p.evaluate(() => window.__store.setState({ showHeat: true }))
await p.waitForTimeout(170)
await p.screenshot({ path: 'screenshots/mount-1-early.png' })
await p.waitForTimeout(190)
await p.screenshot({ path: 'screenshots/mount-2-mid.png' })
await p.waitForTimeout(1400)
await p.screenshot({ path: 'screenshots/mount-3-rest.png' })

let rec = await p.evaluate(() => window.__rec)
// Frame-rate independent: the curve is checked against its OWN progress, and the
// duration against the wall clock. Headless renders this scene at ~10 fps, so a
// sample-time comparison would only be measuring the frame rate.
const moving = rec.filter((r) => r[2] !== null && r[2] > 0 && r[2] < 1)
console.log('   frames drawn during the mount-in:', moving.length,
  '(headless renders this scene slowly; the duration below is wall clock)')
console.log('    raw     surf      easeOut(raw)   field')
let worst = 0
for (const [, surf, raw, field] of moving) {
  const ideal = EASE(raw)
  worst = Math.max(worst, Math.abs(surf - ideal))
  console.log(`   ${raw.toFixed(3)}   ${surf.toFixed(3)}     ${ideal.toFixed(3)}`
    + `          ${field.toFixed(3)}`)
}
console.log('   worst |t - easeOut(raw)| :', worst.toExponential(1),
  worst < 1e-9 ? '(the curve IS cubic ease-out)' : '(NOT the stated curve)')
const iStart = rec.findIndex((r) => r[4])
const iEnd = rec.findIndex((r, i) => i > iStart && !r[4])
console.log('   wall-clock duration      :',
  iStart >= 0 && iEnd > 0 ? `${(rec[iEnd][0] - rec[iStart][0]).toFixed(0)} ms (target 600)` : 'n/a')
console.log('   at rest                  :', await p.evaluate(() => window.__oceanHeatAnim))

console.log('')
console.log('2. IT IS THE DRAWING THAT MOVES, NOT THE DATA')
console.log('   grids are computed before the first animated frame:')
const proof = await p.evaluate(() => {
  const h = window.__oceanHeat
  const g = window.__oceanHeatMesh.built
  return {
    computedMs: +h.ms.toFixed(1),
    d26Max: +h.stats.d26Max.toFixed(4),
    tchpMax: +h.stats.tchpMax.toFixed(4),
    surfaceTriangles: g.surface.userData.triangles,
    // the position buffer the animation never touches
    firstVertexY: +g.surface.attributes.position.array[1].toFixed(5),
  }
})
console.log('  ', JSON.stringify(proof))
console.log('   scale.y at rest:', await p.evaluate(() => {
  let v = null
  window.__oceanScene.traverse((o) => {
    if (o.type === 'Group' && o.children.some((c) => c.geometry?.userData?.triangles)) v = +o.scale.y.toFixed(4)
  })
  return v
}), '(vertExag 8 / BUILD_EXAG 8 = 1)')

console.log('')
console.log('3. THE CONTOUR WALKS')
await p.evaluate(() => window.__store.setState({ showHeat: false }))
await p.waitForTimeout(500)
await record(p, 1200)
await p.evaluate(() => window.__store.setState({ showHeat: true }))
const walk = []
for (let i = 0; i < 7; i++) {
  await p.waitForTimeout(90)
  walk.push(await p.evaluate(() => {
    let drawn = null, total = null
    window.__oceanScene.traverse((o) => {
      if (o.type === 'LineSegments' && o.geometry.userData.segments) {
        total = o.geometry.attributes.position.count
        drawn = o.geometry.drawRange.count
      }
    })
    return [drawn, total, +(window.__oceanHeatAnim?.surf ?? 1).toFixed(3)]
  }))
}
for (const [drawn, total, t] of walk) {
  console.log(`   t=${String(t).padEnd(5)}  drawRange ${String(drawn).padStart(4)} / ${total} vertices`
    + (drawn % 2 === 0 ? '' : '   ODD COUNT (BUG)'))
}
await p.close()

console.log('')
console.log('4. prefers-reduced-motion: reduce — straight to the final frame')
p = await open('reduce')
await record(p, 900)
await p.evaluate(() => window.__store.setState({ showHeat: true }))
await p.waitForTimeout(700)
rec = await p.evaluate(() => window.__rec)
const moved = rec.filter((r) => r[1] !== null && r[1] < 1).length
console.log('   frames below t=1 :', moved, moved === 0 ? '(none — no motion)' : '(MOTION LEAKED)')
console.log('   final            :', await p.evaluate(() => window.__oceanHeatAnim))
await p.screenshot({ path: 'screenshots/mount-4-reduced.png' })

console.log('')
console.log('5. UN-SLICING FADES THE LID BACK WITHOUT DROPPING THE SHEET')
await p.close()
p = await open('no-preference')
await p.evaluate(() => window.__store.setState({ showHeat: true }))
await p.waitForTimeout(1200)
await p.evaluate(() => window.__store.setState({ clipIndex: 14, depthClip: -0.6 }))
await p.waitForTimeout(900)
await record(p, 1200)
await p.evaluate(() => window.__store.setState({ clipIndex: 0, depthClip: 0 }))
await p.waitForTimeout(900)
rec = await p.evaluate(() => window.__rec)
const surfDipped = rec.some((r) => r[1] !== null && r[1] < 0.999)
const fieldFaded = rec.some((r) => r[3] !== null && r[3] < 0.999)
console.log('   D26 sheet re-animated :', surfDipped ? 'YES (BUG — it never left)' : 'no')
console.log('   TCHP lid faded back in:', fieldFaded ? 'yes' : 'NO (expected a fade)')

await p.close()
await b.close()
