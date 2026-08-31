import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4500)
const project = () => p.evaluate(() => {
  const cam = window.__oceanCamera
  const ap = (e,v) => { const w=1/(e[3]*v[0]+e[7]*v[1]+e[11]*v[2]+e[15])
    return [(e[0]*v[0]+e[4]*v[1]+e[8]*v[2]+e[12])*w,(e[1]*v[0]+e[5]*v[1]+e[9]*v[2]+e[13])*w,(e[2]*v[0]+e[6]*v[1]+e[10]*v[2]+e[14])*w] }
  const out=[]
  window.__oceanScene.traverse(n => {
    if (!n.userData || !n.userData.floatId) return
    n.updateWorldMatrix(true,false)
    const wp = new (n.position.constructor)(0,0,0).setFromMatrixPosition(n.matrixWorld)
    const q = ap(cam.projectionMatrix.elements, ap(cam.matrixWorldInverse.elements,[wp.x,wp.y,wp.z]))
    out.push({ id:n.userData.floatId, u:q[0]*0.5+0.5, v:-q[1]*0.5+0.5 })
  })
  return out
})
const h = await p.locator('.scene-host').boundingBox()
// zoom in a little so the markers are judgeable
await p.mouse.move(h.x+h.width/2, h.y+h.height/2)
for (let i=0;i<3;i++){ await p.mouse.wheel(0,-110); await p.waitForTimeout(120) }
await p.waitForTimeout(600)
await p.mouse.move(12,12); await p.waitForTimeout(600)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/argo-idle.png' })
// select one, then shoot again
const pts = await project()
console.log('floats on screen:', pts.length, pts.map(x=>x.u.toFixed(2)+','+x.v.toFixed(2)).join(' '))
const t = pts.find(x => x.u>0.15 && x.u<0.85 && x.v>0.15 && x.v<0.85)
await p.mouse.move(h.x+h.width*t.u, h.y+h.height*t.v); await p.waitForTimeout(250)
await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(1200)
await p.mouse.move(12,12); await p.waitForTimeout(700)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/argo-selected.png' })
await p.screenshot({ path: 'screenshots/argo-full.png' })
console.log('selected sub:', (await p.locator('.chart-profile .sub').textContent()).trim())
await b.close()
