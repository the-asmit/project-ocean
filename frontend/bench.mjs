import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1680, height: 950 } })
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await p.waitForSelector('.scene-host canvas')
await p.waitForFunction(() => !document.querySelector('.scene-busy'), null, { timeout: 300000 })
await p.waitForTimeout(3500)
await p.getByRole('button', { name: /Isosurface/ }).click()
await p.waitForTimeout(1500)
console.log(await p.evaluate(async () => {
  const { isosurfaceGeometry } = await import('/src/scene/marchingCubes.js')
  const { blockLayout } = await import('/src/scene/blockLayout.js')
  const { dataset } = window.__oceanIso
  const B = blockLayout(dataset, 8, 0, 0)
  const runs = []
  for (let i = 0; i < 40; i++) {
    const iso = 14 + (i % 24) * 0.5
    const r = isosurfaceGeometry(dataset, { isoValue: iso, yOfDepthM: B.yOfDepthM })
    if (r) { runs.push(r.ms); r.geometry.dispose() }
  }
  runs.sort((a, c) => a - c)
  const q = (f) => +runs[Math.floor(runs.length * f)].toFixed(1)
  const v = dataset.meta.volume
  return { grid: `${v.W}x${v.levelsReal}x${v.D}`, runs: runs.length,
    minMs: q(0), medianMs: q(0.5), p90Ms: q(0.9), maxMs: +runs[runs.length-1].toFixed(1) }
}))
await b.close()
