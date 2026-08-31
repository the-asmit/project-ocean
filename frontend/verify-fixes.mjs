import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)

// --- 1. the View panel copy
const view = [...await p.locator('.panel').all()]
for (const el of view) {
  const head = (await el.locator('.panel-head').first().innerText().catch(()=>'')).trim()
  if (/^View/i.test(head)) {
    console.log('VIEW panel hint :', (await el.locator('.hint').innerText()).replace(/\s+/g,' '))
    console.log('  mentions free-fly?', /free-?fly/i.test(await el.innerText()) ? 'YES' : 'no')
  }
}

// --- 2. float -> clear spot
const h = await p.locator('.scene-host').boundingBox()
const chart = async () => (await p.locator('.chart-profile .panel-head').innerText()).replace(/\s+/g,' ')
const info = async () => p.evaluate(() => {
  const el = [...document.querySelectorAll('.panel')].find(e => /pinned point/i.test(e.querySelector('.panel-head')?.textContent || ''))
  return /nothing pinned/i.test(el?.textContent || '') ? 'NOT PINNED' : 'PINNED'
})
const floats = await p.evaluate(() => {
  const cam = window.__oceanCamera, out = []
  const ap=(e,v)=>{const w=1/(e[3]*v[0]+e[7]*v[1]+e[11]*v[2]+e[15])
    return [(e[0]*v[0]+e[4]*v[1]+e[8]*v[2]+e[12])*w,(e[1]*v[0]+e[5]*v[1]+e[9]*v[2]+e[13])*w,(e[2]*v[0]+e[6]*v[1]+e[10]*v[2]+e[14])*w]}
  window.__oceanScene.traverse(n => {
    if (!n.userData?.floatId) return
    n.updateWorldMatrix(true,false)
    const wp = new (n.position.constructor)(0,0,0).setFromMatrixPosition(n.matrixWorld)
    const q = ap(cam.projectionMatrix.elements, ap(cam.matrixWorldInverse.elements,[wp.x,wp.y,wp.z]))
    out.push({ u:q[0]*0.5+0.5, v:-q[1]*0.5+0.5 })
  })
  return out
})
const t = floats.find(f => f.u>0.2 && f.u<0.8 && f.v>0.2 && f.v<0.8)
await p.mouse.move(h.x+h.width*t.u, h.y+h.height*t.v); await p.waitForTimeout(500)
await p.mouse.down(); await p.waitForTimeout(50); await p.mouse.up(); await p.waitForTimeout(1000)
console.log('\nstep 1 — clicked a float')
console.log('  chart :', await chart())
console.log('  pin   :', await info())
// a spot away from every float AND over water — the previous search maximised
// float distance alone and landed on the shelf, where "no column here" is the
// correct answer but makes a confusing screenshot
const cands = []
for (let u=0.30; u<=0.72; u+=0.04) for (let v=0.38; v<=0.66; v+=0.04) {
  cands.push({ u, v, d: Math.min(...floats.map(f => Math.hypot(f.u-u, f.v-v))) })
}
cands.sort((a, c) => c.d - a.d)
let best = cands[0]
for (const c of cands.slice(0, 24)) {
  if (c.d < 0.12) continue
  await p.mouse.move(h.x+h.width*c.u, h.y+h.height*c.v)
  await p.waitForTimeout(260)
  const txt = await p.locator('.hud-card').first().innerText().catch(() => '')
  if (txt && !/land|below seafloor|no data/i.test(txt)) { best = c; break }
}
await p.mouse.move(h.x+h.width*best.u, h.y+h.height*best.v); await p.waitForTimeout(500)
await p.mouse.down(); await p.waitForTimeout(50); await p.mouse.up(); await p.waitForTimeout(1000)
console.log('step 2 — clicked a clear spot')
console.log('  chart :', await chart())
console.log('  pin   :', await info())
await p.mouse.move(8,8); await p.waitForTimeout(800)
await p.screenshot({ path: 'screenshots/fixes-pin.png' })
await b.close()
