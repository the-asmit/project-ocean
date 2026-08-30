import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(4000)
console.log(await p.evaluate(() => {
  const cam = window.__oceanCamera
  const cv = document.querySelector('.scene-host canvas')
  const r = {
    camType: cam?.type, camParent: cam?.parent?.type ?? null,
    canvasKeys: Object.keys(cv).filter(k => k.startsWith('__')),
  }
  const root = cv.__r3f
  if (root) {
    r.r3fKeys = Object.keys(root)
    const st = root.root?.getState?.() ?? root.store?.getState?.()
    if (st) { r.stateKeys = Object.keys(st).slice(0, 24); r.sceneType = st.scene?.type; r.sceneChildren = st.scene?.children?.length }
  }
  return JSON.stringify(r, null, 1)
}))
await b.close()
