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
const idle = async () => { await p.mouse.move(8,8); await p.waitForTimeout(650) }
const stat = () => p.evaluate(()=>{const I=window.__oceanIso; if(!I?.built) return {empty:true}
  const pos=I.built.geometry.attributes.position.array; let mn=1e9,mx=-1e9
  for(let v=0;v<pos.length/3;v++){const m=I.dataset.map.yToDepth(pos[v*3+1]/8); if(m<mn)mn=m; if(m>mx)mx=m}
  return {iso:I.isoValue, tris:I.built.triangles, ms:+I.built.ms.toFixed(1),
    shallowestM:+mn.toFixed(1), deepestM:+mx.toFixed(1),
    tile:`${I.dataset.map.lonMin.toFixed(1)}-${I.dataset.map.lonMax.toFixed(1)}E ${I.dataset.map.latMin.toFixed(1)}-${I.dataset.map.latMax.toFixed(1)}N`}})

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await ready()
await p.getByRole('button', { name: /Isosurface/ }).click()
await p.waitForTimeout(900)

// 1 - closed block: the ghost pass shows the buried surface through the tile
await idle()
await p.locator('.scene-panel').screenshot({ path: 'screenshots/iso-1-ghost.png' })
console.log('1 ghost      ', await stat())

// 2 - top slice dragged past it: the surface stands in open air
await set('#sl-slice-from-top', 26)
await p.waitForTimeout(1300); await idle()
await p.locator('.scene-panel').screenshot({ path: 'screenshots/iso-2-emerged.png' })
console.log('2 emerged 20 ', await stat())

// 3 - same view at 26 C: must sit SHALLOWER (warmer water is nearer the surface)
await set('#sl-isovalue', 26)
await p.waitForTimeout(1200); await idle()
await p.locator('.scene-panel').screenshot({ path: 'screenshots/iso-3-26deg.png' })
console.log('3 emerged 26 ', await stat())

// 4 - west cut too: the surface trims exactly at the block's new wall
await set('#sl-isovalue', 20); await set('#sl-slice-from-west', 24)
await p.waitForTimeout(1300); await idle()
await p.locator('.scene-panel').screenshot({ path: 'screenshots/iso-4-westcut.png' })
console.log('4 west cut   ', await stat(), await p.evaluate(()=>{
  const I=window.__oceanIso, L=window.__oceanBlock
  const pos=I.built.geometry.attributes.position.array; let mn=1e9
  for(let v=0;v<pos.length/3;v++) if(pos[v*3]<mn) mn=pos[v*3]
  return { surfaceMinX:+mn.toFixed(2), blockXWest:+L.xWest.toFixed(2) }}))

// 5 - full dashboard with the P3 footer
await p.screenshot({ path: 'screenshots/iso-5-full.png' })

// 6 - a DIFFERENTLY SHAPED tile, drawn on the minimap (wide and short)
const mm = await p.locator('.mm-canvas').boundingBox()
await p.mouse.move(mm.x + mm.width*0.16, mm.y + mm.height*0.46)
await p.mouse.down()
await p.mouse.move(mm.x + mm.width*0.78, mm.y + mm.height*0.60, { steps: 22 })
await p.mouse.up()
await ready()
await p.getByRole('button', { name: /Isosurface/ }).first().click().catch(()=>{})
await p.waitForTimeout(1200)
console.log('6 new tile   ', await stat())
await set('#sl-slice-from-top', 26)
await p.waitForTimeout(1400); await idle()
await p.locator('.scene-panel').screenshot({ path: 'screenshots/iso-6-tile2.png' })
console.log('6 sliced     ', await stat())
console.log('FOOTER:', (await p.locator('.appfoot').innerText()).replace(/\n/g,' | '))
await b.close()
