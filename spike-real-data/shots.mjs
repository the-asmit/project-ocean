// Verification screenshots. `before` was captured from the pre-fix build; the
// `after` / isolation sets come from the current build.
//   node shots.mjs <baseUrl> before      (pre-fix build)
//   node shots.mjs <baseUrl> after       (post-fix build + A/B isolations)
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'

const BASE = process.argv[2] || 'http://localhost:4173/'
const MODE = process.argv[3] || 'after'
mkdirSync('screenshots', { recursive: true })

const SHELF = 'cam=22,-1.0,-6&tgt=46,-2.6,12'   // across the shelf break
const FLOOR = 'cam=30,-0.9,-4&tgt=40,-2.2,8'    // angled down at the seafloor
// long horizontal traverse over the broad <50 m shelf between India and Sri
// Lanka — the exact geometry that produced the neon ribbon
const RIBBON = 'cam=50,-0.80,-86&tgt=100,-0.55,-62'

// name -> query. `before` only gets the two same-camera comparisons.
const SETS = {
  before: {
    'before-shelf': SHELF,
    'before-scene': '',
  },
  after: {
    'after-shelf': SHELF,
    'after-scene': '',
    // Fix 2 isolated over the shallow shelf: thin=1 restores the old fixed
    // density (the ribbon), same camera
    'ab-ribbon-OFF-fixeddensity': `${RIBBON}&thin=1`,
    'ab-ribbon-ON-thicknessaware': RIBBON,
    // Fix 1 isolated: terrain with the water nearly transparent so the mesh is
    // actually visible; detail=0 is pure interpolated real data
    'ab-detail-OFF-realonly': `${FLOOR}&density=0.005&detail=0`,
    'ab-detail-ON-synthetic': `${FLOOR}&density=0.005&detail=1`,
    // stress: is the synthetic detail obviously fake if we exaggerate it?
    'ab-detail-4x-stress': `${FLOOR}&density=0.005&detail=4`,
  },
}

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
})

for (const [name, q] of Object.entries(SETS[MODE])) {
  const page = await b.newPage({ viewport: { width: 1440, height: 810 } })
  const errs = []
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto(`${BASE}?tile=coastal${q ? '&' + q : ''}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(3800)
  writeFileSync(`screenshots/${name}.png`, await page.screenshot())
  console.log(name.padEnd(26), errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no console errors')
  await page.close()
}
await b.close()
