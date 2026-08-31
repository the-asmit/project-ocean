import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
// count real /point calls: stepping frames must never refire the query
let pointCalls = 0
p.on('request', r => { if (r.url().includes('/api/point')) pointCalls++ })
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(3500)

// turn on the isosurface FIRST, so we can prove stepping does not rebuild it
await p.getByRole('button', { name: /Isosurface/ }).click()
await p.waitForTimeout(1500)
await p.getByRole('button', { name: /Current flow lines/ }).click()
await p.waitForTimeout(1200)

const snap = () => p.evaluate(() => {
  const S = window.__oceanSpike, I = window.__oceanIso
  const a = S.geometry.attributes.position.array
  // hash of the whole buffer + a few raw samples
  let h = 0
  for (let i = 0; i < a.length; i += 7) h = (h * 31 + Math.round(a[i] * 1000)) % 1e9
  return { frame: S.frame, hash: h, n: a.length / 3,
    sample: [a[300], a[302], a[9000], a[9002]].map(x => +x.toFixed(3)),
    isoTris: I?.built?.triangles ?? null, isoGeomId: I?.built?.geometry?.uuid ?? null }
})
const pointsBefore = pointCalls
const seen = []
for (let f = 0; f < 5; f++) {
  await p.evaluate(() => document.querySelector('.tl-transport button:nth-child(3)').click())
  await p.waitForTimeout(450)
  seen.push(await snap())
}
console.log('--- frame-to-frame buffer')
for (const s of seen) console.log(`  frame ${s.frame}  hash ${s.hash}  sample ${s.sample.join(' ')}`)
const hashes = seen.map(s => s.hash)
console.log('distinct buffers across 5 steps:', new Set(hashes).size, '/', hashes.length)
// how much did vertices actually move, frame to frame?
console.log('--- vertex displacement between two frames')
console.log(await p.evaluate(async () => {
  const grab = () => Float32Array.from(window.__oceanSpike.geometry.attributes.position.array)
  const a = grab()
  document.querySelector('.tl-transport button:nth-child(3)').click()
  await new Promise(r => setTimeout(r, 400))
  const c = grab()
  let moved = 0, sum = 0, max = 0
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.hypot(a[i]-c[i], a[i+1]-c[i+1], a[i+2]-c[i+2])
    if (d > 1e-4) moved++
    sum += d; if (d > max) max = d
  }
  return { verts: a.length/3, movedVerts: moved,
    pctMoved: +(100*moved/(a.length/3)).toFixed(1),
    meanMove: +(sum/(a.length/3)).toFixed(3), maxMove: +max.toFixed(3) }
}))
console.log('--- isolation')
console.log('  isosurface geometry uuid stable across steps:',
  new Set(seen.map(s => s.isoGeomId)).size === 1, `(${seen[0].isoTris} tris)`)
console.log('  /api/point calls during stepping:', pointCalls - pointsBefore)
await b.close()
