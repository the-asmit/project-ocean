// Clean perf sweep. vsync ON (reliable). r3f frameloop="always" renders every
// rAF, so fps == render cadence. Pinned ~60 => under the 16.7ms budget with
// headroom we can't see. Below 60 => fps ~ 1000/frame-ms is meaningful.
// We also read drei's Stats overlay (min fps = worst frame) from the DOM.
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const BASE = process.argv[2] || 'http://localhost:4173/'
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
})

async function run(params, vp, shot) {
  const page = await browser.newPage({ viewport: vp })
  const errs = []
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto(BASE + '?' + params, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // continuously orbit so the raymarch re-runs every frame, measure rAF cadence
  const r = await page.evaluate(async () => {
    const cv = document.querySelector('canvas')
    const rect = cv.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let frames = 0
    let worst = 0
    let last = performance.now()
    const t0 = last
    await new Promise((res) => {
      function tick(now) {
        const dt = now - last
        last = now
        if (frames > 3) worst = Math.max(worst, dt)
        frames++
        // simulate a drag: dispatch pointermove with buttons=1
        const ang = frames * 0.01
        cv.dispatchEvent(new PointerEvent('pointermove', {
          clientX: cx + Math.cos(ang) * 3, clientY: cy + Math.sin(ang) * 3,
          buttons: 1, bubbles: true,
        }))
        if (now - t0 >= 4000) res()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const secs = (performance.now() - t0) / 1000
    return {
      avgFps: +(frames / secs).toFixed(1),
      worstFrameMs: +worst.toFixed(1),
    }
  })

  if (shot) writeFileSync(shot, await page.screenshot())
  const px = (vp.width * vp.height * (params.includes('dpr=2') ? 4 : Math.min(1.75, 1) ** 2)).toFixed(0)
  console.log(
    params.padEnd(40),
    `@${vp.width}x${vp.height}`.padEnd(12),
    `avg ${String(r.avgFps).padStart(5)}fps`,
    `worst ${String(r.worstFrameMs).padStart(5)}ms`,
    errs.length ? 'ERR:' + errs[0] : '',
  )
  await page.close()
}

const HD = { width: 1600, height: 900 }
const FHD = { width: 1920, height: 1080 }
const QHD = { width: 2560, height: 1440 }

console.log('AMD Radeon 740M (integrated iGPU), ANGLE/D3D11, vsync ON, 128x48x128 field, first-person frame')
console.log('worst-frame ms is the number that matters (avg is diluted by cheap frames)\n')
await run('steps=64', HD, null)
await run('steps=128', HD, 'shot-128.png')
await run('steps=192', HD, null)
await run('steps=256', HD, 'shot-256.png')
await run('steps=384', HD, null)
await run('steps=512', HD, 'shot-512.png')
console.log('')
await run('steps=128&dpr=2', FHD, null)
await run('steps=256&dpr=2', FHD, null)
await run('steps=128&dpr=2', QHD, null)
await run('steps=256&dpr=2', QHD, null)
console.log('')
await run('steps=192&clip=-1.6', HD, 'shot-cross.png')

await browser.close()
