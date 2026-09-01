// Verification for the colorbar editor. Run with the dev server up:
//   node verify-colorbar.mjs
import { chromium } from 'playwright'

const URL = 'http://localhost:5173/'
const W = (p, fn, ms = 60000) => p.waitForFunction(fn, undefined, { timeout: ms })
const log = (...a) => console.log(...a)

const browser = await chromium.launch()
const p = await browser.newPage({ viewport: { width: 1600, height: 900 } })
p.on('pageerror', (e) => console.log('  PAGEERROR', e.message))
p.on('console', (m) => { if (m.type() === 'error') console.log('  CONSOLE', m.text()) })

await p.goto(URL, { waitUntil: 'networkidle' })
await W(p, () => window.__store?.getState().dataset && window.__ramp && window.__oceanRamp)
await p.waitForTimeout(1200)

const set = async (patch) => { await p.evaluate((o) => window.__store.setState(o), patch); await p.waitForTimeout(450) }
const shot = (n) => p.screenshot({ path: `screenshots/${n}.png` })
const railShot = (n) => p.locator('.rail.right').screenshot({ path: `screenshots/${n}.png` })

// ---------------------------------------------------------------------------
log('\n=== 1. JS <-> GPU RAMP AGREEMENT, 256 POINTS, ALL 4 PALETTES ===')
// Not a construction argument: this renders a 256x1 quad on a real WebGL2
// context with the SAME texture parameters and the SAME texel-centre
// expression the block's fragment shader uses, then reads the pixels back.
const agree = await p.evaluate(() => {
  const { PALETTES, paletteRGB, paletteLUT } = window.__ramp
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 1
  const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false })
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s }
  const prog = gl.createProgram()
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
    in vec2 a; out vec2 uv; void main(){ uv = a * 0.5 + 0.5; gl_Position = vec4(a,0,1); }`))
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float; in vec2 uv; out vec4 o; uniform sampler2D uRamp;
    void main(){
      float p = floor(uv.x * 256.0) / 255.0;              // the 256 sample points
      o = vec4(texture(uRamp, vec2((0.5 + p * 255.0) / 256.0, 0.5)).rgb, 1.0);
    }`))
  gl.linkProgram(prog); gl.useProgram(prog)
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  const out = []
  for (const pal of PALETTES) {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteLUT(pal.id))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.viewport(0, 0, 256, 1); gl.drawArrays(gl.TRIANGLES, 0, 3)
    const px = new Uint8Array(256 * 4); gl.readPixels(0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    let worst = 0, at = -1
    for (let i = 0; i < 256; i++) {
      const js = paletteRGB(pal.id, i / 255)
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(px[i * 4 + k] - js[k])
        if (d > worst) { worst = d; at = i }
      }
    }
    out.push({ palette: pal.id, points: 256, worstByteDiff: worst, at })
  }
  return out
})
for (const r of agree) log(`  ${r.palette.padEnd(8)} 256/256 points, worst byte difference ${r.worstByteDiff}`)

// ---------------------------------------------------------------------------
log('\n=== 2. ONE PALETTE CHANGE MOVES EVERY CONSUMER ===')
await set({ showIso: true, showGliders: false, panelLayer: 'field' })
await W(p, () => window.__oceanIso?.built)
const probe = () => p.evaluate(() => {
  const iso = document.querySelector('.iso-swatch, .swatch')
  const g = window.__store.getState()
  const s = window.__ramp.makeScale({
    paletteId: g.palette, valueMin: window.__oceanRamp.scale.valueMin,
    valueMax: window.__oceanRamp.scale.valueMax, range: g.customRange, log: g.logScale,
  })
  return {
    palette: g.palette,
    colorbarBar: getComputedStyle(document.querySelector('.cbar .bar')).backgroundImage.slice(0, 60),
    isoMeshColor: (() => { const c = window.__oceanIso?.color; return c || null })(),
    scaleAt20: s.css(20),
    lutHead: Array.from(window.__oceanRamp.lut.slice(0, 3)),
    uRange: window.__oceanBlock?.uniforms.uRange.value.toArray(),
    uLog: window.__oceanBlock?.uniforms.uLog.value,
  }
})
for (const id of ['ocean', 'viridis', 'rdbu', 'mono']) {
  await set({ palette: id })
  const r = await probe()
  log(`  ${id.padEnd(8)} lut[0]=${JSON.stringify(r.lutHead)}  scale.css(20)=${r.scaleAt20}  bar=${r.colorbarBar.includes('gradient') ? 'gradient ok' : 'MISSING'}`)
  await shot(`cbar-pal-${id}`)
}
// the isosurface / ribbon / isoline strokes all come off scale.css, so read the
// DOM strokes that are actually painted rather than trusting the call site
const strokes = await p.evaluate(() => {
  const lines = [...document.querySelectorAll('.recharts-line-curve')].map((n) => n.getAttribute('stroke'))
  return { isolineStrokes: lines.slice(0, 6) }
})
log('  transect isoline strokes (mono):', JSON.stringify(strokes.isolineStrokes))
await set({ palette: 'ocean' })

// ---------------------------------------------------------------------------
log('\n=== 3. CUSTOM RANGE: NARROW, BADGE, RESET ===')
const readScale = () => p.evaluate(() => ({
  badge: [...document.querySelectorAll('.scale-mode .badge')].map((n) => n.textContent),
  ticks: [...document.querySelectorAll('.cbar .ticks span')].map((n) => n.textContent.trim()),
  note: document.querySelector('.scale-mode > span')?.textContent.trim().slice(0, 150),
  uRange: window.__oceanBlock?.uniforms.uRange.value.toArray(),
  custom: window.__store.getState().customRange,
}))
log('  default  ', JSON.stringify(await readScale()))
await railShot('cbar-default')
await set({ customRange: [24, 30] })
log('  narrowed ', JSON.stringify(await readScale()))
await railShot('cbar-custom')
await shot('cbar-custom-full')
await p.locator('.creset').click(); await p.waitForTimeout(400)
const after = await readScale()
log('  reset    ', JSON.stringify(after))

// contours must NOT move when the range narrows: they are computed in baked-t
const contour = await p.evaluate(() => window.__oceanBlock.uniforms.uContourStep.value)
log('  uContourStep after narrow+reset:', contour, '(baked-normalised, range-independent)')

// ---------------------------------------------------------------------------
log('\n=== 4. LOG VS LINEAR, BOTH VARIABLES ===')
for (const [vari, label] of [['thetao', 'Temperature'], ['so', 'Salinity']]) {
  await p.evaluate((v) => window.__store.getState().setVariable(v), vari)
  await W(p, (v) => window.__store.getState().dataset?.meta.volume.variable === v, 60000).catch(() => {})
  await p.evaluate((v) => v, vari)
  await p.waitForTimeout(1500)
  const r = await p.evaluate(() => {
    const v = window.__store.getState().dataset.meta.volume
    const mk = (log) => window.__ramp.makeScale({ paletteId: 'ocean', valueMin: v.valueMin, valueMax: v.valueMax, range: null, log })
    const lin = mk(false), lg = mk(true)
    const mid = (v.valueMin + v.valueMax) / 2
    return {
      variable: v.variable, range: [v.valueMin, v.valueMax],
      midValue: mid, linPos: lin.norm(mid), logPos: lg.norm(mid),
      logBlocked: lg.logBlocked,
      ticksLinear: [1, .75, .5, .25, 0].map((t) => +lin.valueAt(t).toFixed(3)),
      ticksLog: [1, .75, .5, .25, 0].map((t) => +lg.valueAt(t).toFixed(3)),
    }
  })
  log(`  ${label} baked [${r.range[0]}, ${r.range[1]}]`)
  log(`    midpoint ${r.midValue.toFixed(3)} -> linear ${r.linPos.toFixed(3)} | log ${r.logPos.toFixed(3)} | shift ${(r.logPos - r.linPos).toFixed(3)} of the bar`)
  log(`    tick values linear ${JSON.stringify(r.ticksLinear)}`)
  log(`    tick values log    ${JSON.stringify(r.ticksLog)}`)
  await set({ logScale: true })
  const hint = await p.evaluate(() => [...document.querySelectorAll('.cedit .hint')].pop()?.textContent.trim())
  const badges = await p.evaluate(() => [...document.querySelectorAll('.scale-mode .badge')].map((n) => n.textContent))
  log(`    panel says: ${hint}`)
  log(`    badges: ${JSON.stringify(badges)}`)
  await railShot(`cbar-log-${vari}`)
  await set({ logScale: false })
}

// sub-zero guard
const guard = await p.evaluate(() => {
  const s = window.__ramp.makeScale({ paletteId: 'ocean', valueMin: -2, valueMax: 12, range: null, log: true })
  return { lo: s.lo, log: s.log, logBlocked: s.logBlocked }
})
log('  polar guard (baked [-2, 12], log requested):', JSON.stringify(guard))

// ---------------------------------------------------------------------------
log('\n=== 5. NOTHING ELSE BROKE ===')
await p.evaluate(() => window.__store.getState().setVariable('thetao'))
await p.waitForTimeout(1800)
const final = await p.evaluate(() => ({
  iso: document.querySelector('.panel')?.textContent ? true : false,
  isoStats: window.__store.getState().isoStats,
  scalePanel: [...document.querySelectorAll('.panel')].map((n) => n.querySelector('h2')?.textContent).filter(Boolean),
  customRange: window.__store.getState().customRange,
  variable: window.__store.getState().variable,
}))
log('  panels:', JSON.stringify(final.scalePanel))
log('  isoStats:', JSON.stringify(final.isoStats), 'customRange after variable switch:', JSON.stringify(final.customRange))
await shot('cbar-final')

await browser.close()
