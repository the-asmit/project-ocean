import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'

// Top-down orientation map.
//
// The coastline is REAL: it is the same GLORYS `deptho` NaN mask the terrain
// mesh and the shader's floor mask use — land is where there is no sounding.
// Nothing here is a stock basemap or a traced outline; at 1/12° (~9 km) it is
// as coarse as the rest of the data, which is honest.
//
// North is up, east is right — the map is NOT mirrored, matching the world
// mapping in dataset.js (lon -> +x, lat -> +z).

const SIZE = 178          // css px of the map square
const LAND = '#2c3440'
const LAND_EDGE = 'rgba(160,196,236,.55)'

// --- marching squares over a smoothed land field -> coastline segments -----
function coastline(land, W, D) {
  // light 3x3 blur so the contour reads as a coastline rather than staircase
  const b = new Float32Array(W * D)
  for (let j = 0; j < D; j++) {
    for (let i = 0; i < W; i++) {
      let s = 0, n = 0
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const jj = j + dj, ii = i + di
          if (jj < 0 || jj >= D || ii < 0 || ii >= W) continue
          s += land[jj * W + ii]; n++
        }
      }
      b[j * W + i] = s / n
    }
  }
  const T = 0.5
  const segs = []
  const lerp = (a, v0, v1) => (a + (T - v0) / (v1 - v0 || 1e-6))
  for (let j = 0; j < D - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const tl = b[j * W + i], tr = b[j * W + i + 1]
      const bl = b[(j + 1) * W + i], br = b[(j + 1) * W + i + 1]
      const code = (tl > T ? 8 : 0) | (tr > T ? 4 : 0) | (br > T ? 2 : 0) | (bl > T ? 1 : 0)
      if (code === 0 || code === 15) continue
      const top = [lerp(i, tl, tr), j]
      const bot = [lerp(i, bl, br), j + 1]
      const lft = [i, lerp(j, tl, bl)]
      const rgt = [i + 1, lerp(j, tr, br)]
      const push = (a, c) => segs.push([a, c])
      switch (code) {
        case 1: case 14: push(lft, bot); break
        case 2: case 13: push(bot, rgt); break
        case 3: case 12: push(lft, rgt); break
        case 4: case 11: push(top, rgt); break
        case 6: case 9: push(top, bot); break
        case 7: case 8: push(lft, top); break
        default: push(lft, top); push(bot, rgt); break   // saddles 5 / 10
      }
    }
  }
  return segs
}

export default function Minimap({ dataset, cameraRef }) {
  const canvasRef = useRef()
  const baseRef = useRef(null)      // cached static layer (coast + depth)
  const selected = useVisualizationState((s) => s.selected)
  const hover = useVisualizationState((s) => s.hover)

  const { bathy, meta, map } = dataset
  const W = meta.bathymetry.bathyW
  const D = meta.bathymetry.bathyD

  // --- build the static layer once ---------------------------------------
  useEffect(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const px = Math.round(SIZE * dpr)

    // depth/land raster at native grid res, north-up (row 0 = latMax)
    const off = document.createElement('canvas')
    off.width = W; off.height = D
    const g = off.getContext('2d')
    const img = g.createImageData(W, D)
    const land = new Float32Array(W * D)
    for (let py = 0; py < D; py++) {
      const j = D - 1 - py                      // flip: north at top
      for (let i = 0; i < W; i++) {
        const v = bathy[j * W + i]
        const o = (py * W + i) * 4
        const isLand = Number.isNaN(v)
        land[py * W + i] = isLand ? 1 : 0
        if (isLand) {
          img.data[o] = 0x2c; img.data[o + 1] = 0x34; img.data[o + 2] = 0x40
        } else {
          // shallow -> lighter; v is world-Y in [-boxDepth, 0]
          const t = Math.min(1, Math.max(0, 1 + v / meta.bathymetry.boxDepth))
          img.data[o] = 8 + t * 26
          img.data[o + 1] = 20 + t * 74
          img.data[o + 2] = 42 + t * 96
        }
        img.data[o + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)

    const base = document.createElement('canvas')
    base.width = px; base.height = px
    const c = base.getContext('2d')
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    c.drawImage(off, 0, 0, px, px)

    // crisp coastline on top of the smoothed raster
    const sx = px / (W - 1)
    const sy = px / (D - 1)
    c.strokeStyle = LAND_EDGE
    c.lineWidth = 1.15 * dpr
    c.lineJoin = 'round'
    c.beginPath()
    for (const [a, b2] of coastline(land, W, D)) {
      c.moveTo(a[0] * sx, a[1] * sy)
      c.lineTo(b2[0] * sx, b2[1] * sy)
    }
    c.stroke()

    baseRef.current = base
  }, [bathy, W, D, meta])

  // --- live layer: camera + markers, redrawn each frame ------------------
  useEffect(() => {
    let raf = 0
    const dir = new THREE.Vector3()

    const toMap = (x, z, px) => {
      const u = x / map.span + 0.5              // 0..1 west->east
      const v = z / map.span + 0.5              // 0..1 south->north
      return [u * px, (1 - v) * px]             // flip v: north at top
    }

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const cv = canvasRef.current
      const base = baseRef.current
      if (!cv || !base) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const px = Math.round(SIZE * dpr)
      if (cv.width !== px) { cv.width = px; cv.height = px }
      const c = cv.getContext('2d')
      c.clearRect(0, 0, px, px)
      c.drawImage(base, 0, 0)

      // hover point (faint)
      if (hover) {
        const [hx, hy] = toMap(hover.world[0], hover.world[2], px)
        c.fillStyle = 'rgba(88,212,255,.5)'
        c.beginPath(); c.arc(hx, hy, 2.2 * dpr, 0, Math.PI * 2); c.fill()
      }

      // camera position + facing wedge
      const cam = cameraRef?.current
      if (cam) {
        const [rawX, rawY] = toMap(cam.position.x, cam.position.z, px)
        cam.getWorldDirection(dir)
        // world +z is north (map -y), world +x is east (map +x)
        const ang = Math.atan2(dir.x, -dir.z)   // 0 = north/up, clockwise
        // If the pilot strays past the tile, pin the marker to the map edge so
        // there is ALWAYS a positional reference rather than a vanished dot.
        const m = 5 * dpr
        const cx = Math.min(px - m, Math.max(m, rawX))
        const cy = Math.min(px - m, Math.max(m, rawY))
        const inside = rawX === cx && rawY === cy

        c.save()
        c.translate(cx, cy)
        c.rotate(ang)
        // field-of-view wedge
        const R = 26 * dpr
        const half = THREE.MathUtils.degToRad((cam.fov || 60) * 0.5) * (16 / 9)
        const gr = c.createLinearGradient(0, 0, 0, -R)
        gr.addColorStop(0, 'rgba(88,212,255,.42)')
        gr.addColorStop(1, 'rgba(88,212,255,0)')
        c.fillStyle = gr
        c.beginPath()
        c.moveTo(0, 0)
        c.arc(0, 0, R, -Math.PI / 2 - half, -Math.PI / 2 + half)
        c.closePath()
        c.fill()
        // heading tick
        c.strokeStyle = 'rgba(88,212,255,.95)'
        c.lineWidth = 1.3 * dpr
        c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -9 * dpr); c.stroke()
        c.restore()

        c.fillStyle = inside ? '#58d4ff' : '#7b8fa8'
        c.strokeStyle = 'rgba(5,7,13,.9)'
        c.lineWidth = 1.6 * dpr
        c.beginPath(); c.arc(cx, cy, 3.4 * dpr, 0, Math.PI * 2)
        c.fill(); c.stroke()
      }

      // pinned point LAST so it is never hidden under the camera wedge
      if (selected) {
        const [sx2, sy2] = toMap(selected.world[0], selected.world[2], px)
        c.strokeStyle = 'rgba(5,7,13,.85)'
        c.lineWidth = 3.2 * dpr
        c.beginPath(); c.arc(sx2, sy2, 5.4 * dpr, 0, Math.PI * 2); c.stroke()
        c.strokeStyle = '#ffcf7a'
        c.lineWidth = 1.5 * dpr
        c.beginPath(); c.arc(sx2, sy2, 5.4 * dpr, 0, Math.PI * 2); c.stroke()
        c.beginPath(); c.moveTo(sx2 - 8 * dpr, sy2); c.lineTo(sx2 - 3 * dpr, sy2)
        c.moveTo(sx2 + 3 * dpr, sy2); c.lineTo(sx2 + 8 * dpr, sy2)
        c.moveTo(sx2, sy2 - 8 * dpr); c.lineTo(sx2, sy2 - 3 * dpr)
        c.moveTo(sx2, sy2 + 3 * dpr); c.lineTo(sx2, sy2 + 8 * dpr); c.stroke()
        c.fillStyle = '#ffcf7a'
        c.beginPath(); c.arc(sx2, sy2, 1.9 * dpr, 0, Math.PI * 2); c.fill()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [cameraRef, hover, selected, map])

  const b = meta.bbox
  return (
    <div className={`card overlay minimap${selected ? ' shifted' : ''}`}>
      <div className="mm-head">
        <span className="h-label">Orientation</span>
        <span className="h-label mm-n">N ↑</span>
      </div>
      <div className="mm-wrap" style={{ width: SIZE, height: SIZE }}>
        <canvas ref={canvasRef} style={{ width: SIZE, height: SIZE }} />
      </div>
      <div className="mm-foot h-label">
        {b.lat_min}–{b.lat_max}°N · {b.lon_min}–{b.lon_max}°E
      </div>
    </div>
  )
}
