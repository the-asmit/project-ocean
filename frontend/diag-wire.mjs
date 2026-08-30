import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)
await p.locator('#sl-vertical-exaggeration').fill('30'); await p.waitForTimeout(1800)

const setMode = (mode) => p.evaluate((mode) => {
  const s = window.__oceanScene
  s.traverse((n) => {
    if (!n.isMesh) return
    const isPlane = !!n.material.map
    if (mode === 'wire-block-only') { n.material.wireframe = !isPlane; n.visible = !isPlane }
    if (mode === 'wire-both')       { n.material.wireframe = true; n.visible = true }
    if (mode === 'plane-depthtest') { n.material.wireframe = false; n.visible = true; if (isPlane) n.material.depthTest = true }
    n.material.needsUpdate = true
  })
}, mode)

await setMode('wire-block-only'); await p.waitForTimeout(900)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/proof-wire-block.png' })

await setMode('wire-both'); await p.waitForTimeout(900)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/proof-wire-both.png' })

// the hypothesis test: same scene, plane's depthTest flipped ON, nothing else changed
await setMode('plane-depthtest'); await p.waitForTimeout(900)
await p.locator('.scene-panel').screenshot({ path: 'screenshots/proof-depthtest-on.png' })
console.log('ok')
await b.close()
