import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 950 } })
const errs = []
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()) })
const box = async (sel) => p.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
}, sel)

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForFunction(() => window.__store?.getState().dataset, undefined, { timeout: 60000 })
await p.waitForTimeout(2200)

console.log('1. CHARTS ROW — four columns')
console.log('   panels :', (await p.$$eval('.charts > *', (n) => n.map((x) => x.className.split(' ').filter((c) => c !== 'panel').join('')))).join(' | '))
for (const s of ['.stats', '.chart-profile', '.chart-transect', '.chart-compare']) {
  console.log('  ', s.padEnd(17), JSON.stringify(await box(s)))
}
console.log('')
console.log('2. STAT CARDS — unpinned')
console.log('   where  :', await p.$eval('.stats-where', (n) => n.textContent))
console.log('   cards  :', JSON.stringify(await p.$$eval('.stat', (n) => n.map((x) =>
  `${x.querySelector('.stat-label').textContent}=${x.querySelector('.stat-value').textContent}${x.classList.contains('soon') ? '(SOON)' : ''}`))))
console.log('')
console.log('3. COMPARISON PANEL — permanent, empty state')
console.log('   title  :', await p.$eval('.chart-compare .panel-head h2', (n) => n.textContent))
console.log('   empty  :', (await p.$eval('.chart-compare .empty', (n) => n.textContent.trim())).slice(0, 96) + '…')
console.log('   profile still model:', await p.$eval('.chart-profile .panel-head h2', (n) => n.textContent))
await p.screenshot({ path: 'screenshots/step3-unpinned.png' })

console.log('')
console.log('4. PIN — stats fill in, profile stays on the model')
const c = await box('.scene-host canvas')
await p.mouse.click(c.x + c.w * 0.5, c.y + c.h * 0.52)
await p.waitForTimeout(1600)
console.log('   where  :', await p.$eval('.stats-where', (n) => n.textContent))
console.log('   cards  :', JSON.stringify(await p.$$eval('.stat', (n) => n.map((x) =>
  `${x.querySelector('.stat-label').textContent}=${x.querySelector('.stat-value').textContent}`))))
console.log('   subs   :', JSON.stringify(await p.$$eval('.stat-sub', (n) => n.map((x) => x.textContent)).catch(() => [])))
await p.screenshot({ path: 'screenshots/step3-pinned.png' })

console.log('')
console.log('5. SELECT A FLOAT — comparison fills, profile does NOT swap')
const ids = await p.evaluate(() => (window.__oceanScene ? 1 : 0))
await p.evaluate(() => {
  const f = window.__store.getState()
  f.setSelectedFloat('2902772-231')
})
await p.waitForTimeout(3000)
console.log('   profile title  :', await p.$eval('.chart-profile .panel-head h2', (n) => n.textContent))
console.log('   compare title  :', await p.$eval('.chart-compare .panel-head h2', (n) => n.textContent))
console.log('   compare sub    :', await p.$eval('.chart-compare .panel-head .sub', (n) => n.textContent).catch(() => 'n/a'))
console.log('   compare foot   :', (await p.$eval('.chart-compare .cmp-foot', (n) => n.textContent.trim()).catch(() => 'n/a')).slice(0, 150))
console.log('   both charts drawn:', await p.$$eval('.chart-profile .recharts-line-curve, .chart-compare .recharts-line-curve', (n) => n.length), 'curves')
console.log('   pin cleared by float select:', await p.evaluate(() => window.__store.getState().selected) === null)
await p.screenshot({ path: 'screenshots/step3-compare.png' })
console.log('')
console.log('errors:', errs.length ? errs : 'none')
await b.close()
