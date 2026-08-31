import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
let pointCalls = 0
p.on('request', r => { if (r.url().includes('/api/point')) pointCalls++ })
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: /Isosurface/ }).click()
await p.waitForTimeout(1400)
await p.getByRole('button', { name: /Current flow lines/ }).click()
await p.waitForFunction(() => window.__oceanCurrents != null, null, { timeout: 60000 })
await p.waitForTimeout(1200)

console.log('--- GreaterDepth ghost pass')
console.log(await p.evaluate(() => {
  const out = []
  window.__oceanScene.traverse(n => {
    if (n.isLineSegments && n.geometry === window.__oceanCurrents.geometry) {
      out.push({ depthFunc: n.material.depthFunc, depthTest: n.material.depthTest,
        opacity: +n.material.opacity.toFixed(2), renderOrder: n.renderOrder,
        color: '#' + n.material.color.getHexString() })
    }
  })
  // three: NeverDepth 0, AlwaysDepth 1, LessDepth 2, LessEqualDepth 3,
  // EqualDepth 4, GreaterEqualDepth 5, GreaterDepth 6, NotEqualDepth 7
  return { passes: out, GreaterDepth: 6 }
}))

const snap = () => p.evaluate(() => {
  const C = window.__oceanCurrents, I = window.__oceanIso
  const a = C.geometry.attributes.position.array
  let h = 0
  for (let i = 0; i < a.length; i += 7) h = (h * 31 + Math.round(a[i] * 1000)) % 1e9
  return { frame: C.frame, depthM: +C.depthM.toFixed(1), hash: h,
    liveLines: [...C.live].reduce((s, x) => s + x, 0), seeds: C.live.length,
    isoGeom: I?.built?.geometry?.uuid ?? null }
})
const before = pointCalls
const seen = []
for (let i = 0; i < 5; i++) {
  await p.evaluate(() => document.querySelector('.tl-transport button:nth-child(3)').click())
  await p.waitForTimeout(420)
  seen.push(await snap())
}
console.log('\n--- frame stepping (real field)')
for (const s of seen) console.log(`  frame ${s.frame}  hash ${s.hash}  live lines ${s.liveLines}/${s.seeds}`)
console.log('  distinct buffers:', new Set(seen.map(s => s.hash)).size, '/', seen.length)
console.log('\n--- vertex displacement between consecutive real days')
console.log(await p.evaluate(async () => {
  const g = () => Float32Array.from(window.__oceanCurrents.geometry.attributes.position.array)
  const a = g()
  document.querySelector('.tl-transport button:nth-child(3)').click()
  await new Promise(r => setTimeout(r, 450))
  const c = g()
  let moved = 0, sum = 0, max = 0
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.hypot(a[i]-c[i], a[i+1]-c[i+1], a[i+2]-c[i+2])
    if (d > 1e-4) moved++
    sum += d; if (d > max) max = d
  }
  return { verts: a.length/3, pctMoved: +(100*moved/(a.length/3)).toFixed(1),
    meanMove: +(sum/(a.length/3)).toFixed(3), maxMove: +max.toFixed(3) }
}))
console.log('\n--- isolation')
console.log('  isosurface geometry stable:', new Set(seen.map(s => s.isoGeom)).size === 1)
console.log('  /api/point calls while stepping:', pointCalls - before)
console.log('\n--- disclosures')
console.log('  CHIP  :', (await p.locator('.flow-chip').innerText()).split('\n').join(' | '))
console.log('  STRIP :', (await p.locator('.timeline').innerText()).split('\n').join(' '))
console.log('  FOOTER:', (await p.locator('.appfoot').innerText()).split('\n').join(' | '))
console.log('  any SYNTHETIC left on currents?',
  await p.evaluate(() => {
    const t = [document.querySelector('.flow-chip')?.innerText,
      document.querySelector('.timeline')?.innerText].join(' ')
    return /SYNTHETIC|synthetic|fabricated|invented|T\+/.test(t) ? 'YES — ' + t : 'no'
  }))
await b.close()
