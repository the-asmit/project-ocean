import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
const set = (id, v) => p.evaluate(({id,v}) => { const el=document.querySelector(id); if(!el) throw new Error('no '+id)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(v))
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})) }, {id,v})
const ready = async () => { await p.waitForSelector('.scene-host canvas')
  await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
  await p.waitForTimeout(3800) }
const isoOn = async () => { const btn = p.getByRole('button', { name: /Isosurface/ })
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click(); await p.waitForTimeout(1100) }
const stat = () => p.evaluate(()=>{const I=window.__oceanIso; if(!I?.built) return {empty:true}
  const pos=I.built.geometry.attributes.position.array; let mn=1e9,mx=-1e9
  for(let v=0;v<pos.length/3;v++){const m=I.dataset.map.yToDepth(pos[v*3+1]/8); if(m<mn)mn=m; if(m>mx)mx=m}
  const v=I.dataset.meta.volume
  return {iso:I.isoValue, tris:I.built.triangles, ms:+I.built.ms.toFixed(1),
    grid:`${v.W}x${v.levelsReal}x${v.D}`, nanFrac:+v.nanFraction.toFixed(3),
    shallowestM:+mn.toFixed(1), deepestM:+mx.toFixed(1),
    tile:`${I.dataset.map.lonMin.toFixed(1)}-${I.dataset.map.lonMax.toFixed(1)}E ${I.dataset.map.latMin.toFixed(1)}-${I.dataset.map.latMax.toFixed(1)}N`}})

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await ready()
// draw a WIDE, SHORT tile -- 8 x 2.5 deg, aspect 3.2:1 vs the square default
const mm = await p.locator('.mm-canvas').boundingBox()
const bm = await p.evaluate(() => fetch('/api/bathymetry/meta?region=context').then(r=>r.json()))
console.log('basemap', bm.lonMin, bm.lonMax, bm.latMin, bm.latMax)
const px = (lon, lat) => ({
  x: mm.x + ((lon - bm.lonMin) / (bm.lonMax - bm.lonMin)) * mm.width,
  y: mm.y + ((bm.latMax - lat) / (bm.latMax - bm.latMin)) * mm.height,
})
const A = px(82.0, 17.5), B = px(90.0, 15.0)
await p.mouse.move(A.x, A.y)
await p.mouse.down()
await p.mouse.move((A.x+B.x)/2, (A.y+B.y)/2, { steps: 12 })
await p.mouse.move(B.x, B.y, { steps: 12 })
console.log('pick readout:', await p.locator('.mm-pick').innerText())
await p.mouse.up()
await ready()
await isoOn()
console.log('tile2', await stat())
await set('#sl-slice-from-top', 26)
await p.waitForTimeout(1500)
// drop the camera to a lower angle so the sheet's warp reads against the block
await p.waitForTimeout(400); await p.mouse.move(8,8); await p.waitForTimeout(800)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/iso-6-tile2.png' })
console.log('tile2 sliced', await stat())
console.log('FOOTER:', (await p.locator('.appfoot').innerText()).replace(/\n/g,' | '))
await b.close()
