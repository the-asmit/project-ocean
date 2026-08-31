import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE', m.text().slice(0,200)) })
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4500)

// floats placed + their hit targets present in the scene
const info = await p.evaluate(() => {
  let hits = 0, groups = 0
  window.__oceanScene.traverse(n => {
    if (n.userData && n.userData.floatId) hits++
    if (n.isGroup) groups++
  })
  return { hitTargets: hits }
})
console.log('float hit targets in scene:', info.hitTargets)
console.log('footer:', (await p.locator('.appfoot').textContent()).replace(/\s+/g,' ').slice(0,190))

// project each float to screen and click one
const pts = await p.evaluate(() => {
  const cam = window.__oceanCamera
  const ap = (e, v) => { const w = 1/(e[3]*v[0]+e[7]*v[1]+e[11]*v[2]+e[15])
    return [(e[0]*v[0]+e[4]*v[1]+e[8]*v[2]+e[12])*w,(e[1]*v[0]+e[5]*v[1]+e[9]*v[2]+e[13])*w,(e[2]*v[0]+e[6]*v[1]+e[10]*v[2]+e[14])*w] }
  const out = []
  window.__oceanScene.traverse(n => {
    if (!n.userData || !n.userData.floatId) return
    n.updateWorldMatrix(true, false)
    const wp = new (n.position.constructor)(0,0,0).setFromMatrixPosition(n.matrixWorld)
    const q = ap(cam.projectionMatrix.elements, ap(cam.matrixWorldInverse.elements, [wp.x, wp.y, wp.z]))
    out.push({ id: n.userData.floatId, u: q[0]*0.5+0.5, v: -q[1]*0.5+0.5 })
  })
  return out
})
console.log('floats projected:', pts.length, pts.slice(0,3).map(x=>`${x.id}@${x.u.toFixed(2)},${x.v.toFixed(2)}`).join(' '))
await p.locator('.scene-panel').screenshot({ path: 'screenshots/argo-markers.png' })

const h = await p.locator('.scene-host').boundingBox()
const t = pts.find(x => x.u>0.08 && x.u<0.92 && x.v>0.08 && x.v<0.92)
await p.mouse.move(h.x + h.width*t.u, h.y + h.height*t.v); await p.waitForTimeout(250)
await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(1500)

console.log('panel title:', (await p.locator('.chart-profile .panel-head h2').textContent()).trim())
console.log('panel sub  :', (await p.locator('.chart-profile .sub').textContent()).trim())
console.log('footer bar :', (await p.locator('.cmp-foot').textContent()).replace(/\s+/g,' ').trim())
const series = await p.evaluate(() => {
  const paths = [...document.querySelectorAll('.chart-profile .recharts-line-curve')]
  return paths.map(p => ({ stroke: p.getAttribute('stroke'), pts: (p.getAttribute('d')||'').split(/[LM]/).length - 1 }))
})
console.log('curves drawn:', JSON.stringify(series))
await p.screenshot({ path: 'screenshots/argo-compare.png' })
await b.close()
