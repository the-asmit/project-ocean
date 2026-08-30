// Headless render + shader-compile + FPS check for the spike.
// NOTE: headless Chromium here may fall back to SwiftShader (software GL).
// If so, the SCREENSHOT still answers "continuous vs slabs" (same GLSL runs),
// but the FPS number is a software-rasteriser number, not a GPU number.
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const URL = process.argv[2] || 'http://localhost:4173/'

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=d3d11',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
  ],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(3500) // let field build + first frames render

// GL renderer string
const glInfo = await page.evaluate(() => {
  const c = document.createElement('canvas')
  const gl = c.getContext('webgl2')
  if (!gl) return { webgl2: false }
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    webgl2: true,
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : '?',
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '?',
    max3D: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE),
  }
})

// FPS: sample rAF deltas for ~3s while nudging the camera each frame so the
// raymarch actually re-runs.
const fps = await page.evaluate(async () => {
  const canvas = document.querySelector('canvas')
  // dispatch small wheel events to force OrbitControls damping -> re-render
  let frames = 0
  const start = performance.now()
  return await new Promise((resolve) => {
    function tick() {
      frames++
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: frames % 2 ? 1 : -1, bubbles: true }))
      const el = performance.now() - start
      if (el >= 3000) resolve({ frames, seconds: el / 1000, fps: frames / (el / 1000) })
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
})

const shot = await page.screenshot()
writeFileSync('render.png', shot)

console.log('--- GL ---')
console.log(JSON.stringify(glInfo, null, 2))
console.log('--- FPS (default 160 steps, 1280x800, dpr up to 1.75) ---')
console.log(JSON.stringify(fps, null, 2))
console.log('--- console / errors ---')
console.log(logs.join('\n') || '(none)')

await browser.close()
