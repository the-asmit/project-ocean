import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
const idle = async () => { await p.mouse.move(8,8); await p.waitForTimeout(650) }
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: /Current flow lines/ }).click()
await p.waitForFunction(() => window.__oceanCurrents != null, null, { timeout: 60000 })
await p.waitForTimeout(1200); await idle()
await p.locator('.scene-panel').screenshot({ path: 'screenshots/cur-day1.png' })
// step to a later day
for (let i=0;i<4;i++){ await p.evaluate(()=>document.querySelector('.tl-transport button:nth-child(3)').click()); await p.waitForTimeout(160) }
await p.waitForTimeout(500); await idle()
await p.locator('.scene-panel').screenshot({ path: 'screenshots/cur-day5.png' })
// the GreaterDepth ghost: slice the block open so both passes are visible
await p.evaluate(()=>{ const el=document.querySelector('#sl-slice-from-top')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'22')
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})) })
await p.evaluate(()=>document.querySelectorAll('.tl-levels button')[1].click())
await p.waitForTimeout(1400); await idle()
await p.locator('.scene-panel').screenshot({ path: 'screenshots/cur-92m-sliced.png' })
console.log('CHIP:', (await p.locator('.flow-chip').innerText()).split('\n').join(' | '))
await p.screenshot({ path: 'screenshots/cur-full.png' })
await b.close()
